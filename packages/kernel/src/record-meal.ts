import { capabilityRegistry, executionResultSchema, universalCommandEnvelopeSchema, type ExecutionResult, type RecordMealCommand, type UniversalCommandEnvelope } from "@shadow/contracts";
import { conflict, notFound, permissionDenied } from "./errors.js";
import type { Clock, Fingerprinter, IdGenerator, RequestContext, StoredOperation, UnitOfWork } from "./ports.js";

export interface KernelDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly fingerprinter: Fingerprinter;
}

export class CommandExecutor {
  constructor(private readonly dependencies: KernelDependencies) {}

  async execute(context: RequestContext, untrusted: unknown): Promise<ExecutionResult> {
    const command = universalCommandEnvelopeSchema.parse(untrusted);
    const effects=capabilityRegistry[command.capability].resolveEffects(command.input);
    for (const effect of effects) {
      if (!context.effects.has(effect)) throw permissionDenied(effect);
    }
    if (command.input && typeof command.input === "object" && "source" in command.input && command.input.source !== undefined && !context.effects.has("library.source.link")) throw permissionDenied("library.source.link");
    if (command.capability === "life.record_meal") return this.recordMeal(context, command as RecordMealCommand,effects);
    return this.executeDomain(context, command,effects);
  }

  private async executeDomain(context: RequestContext, command: UniversalCommandEnvelope,effects:readonly string[]): Promise<ExecutionResult> {
    const fingerprint = this.dependencies.fingerprinter.fingerprint({ capability: command.capability, input: command.input });
    return this.dependencies.unitOfWork.transaction(async (store) => {
      await store.lockCommand(context.subjectId, command.command_id);
      const existing = await store.findOperation(context.subjectId, command.command_id);
      if (existing) {
        if (!operationFingerprintMatches(existing,fingerprint,command.capability,command.input,this.dependencies.fingerprinter)) throw conflict("command_id was already used with different facts");
        return executionResultSchema.parse({ ...existing.result, replayed: true });
      }
      if(context.agentRun)await store.assertAgentRun(context.subjectId,context.agentRun.runId,context.agentRun.ownerId);
      await store.assertWriteDomains(writeDomains(effects),context.writeEpochs);
      const executionId = this.dependencies.ids.next("exec");
      const written = await store.executeDomainWrite({ subjectId: context.subjectId, command, nextId: (type) => this.dependencies.ids.next(type as Parameters<IdGenerator["next"]>[0]) });
      const result = executionResultSchema.parse({ protocol: "shadow.execution-result", capability: command.capability, command_id: command.command_id, execution_id: executionId, status: "committed", result_kind: command.capability.includes("budget") || command.capability.includes("plan") ? "plan" : "record", resources: written.resources, actual_values: written.actualValues, warnings: written.warnings ?? [], replayed: false });
      await store.insertOperation({...(context.agentRun?{agentRunId:context.agentRun.runId,agentToolCallId:context.agentRun.toolCallId}:{}), executionId, subjectId: context.subjectId, commandId: command.command_id, capability: command.capability, fingerprint, result });
      const aggregateId = written.resources[0]!.id;
      await store.insertOutbox({ id: this.dependencies.ids.next("event"), subjectId: context.subjectId, eventType: `${command.capability}.committed`, aggregateId, payload: { execution_id: executionId, resources: written.resources, actual_values:written.actualValues } });
      return result;
    });
  }

  async getOperation(context: RequestContext, executionId: string): Promise<ExecutionResult> {
    if (!context.effects.has("operations.read")) throw permissionDenied("operations.read");
    const operation = await this.dependencies.unitOfWork.read((store) => store.getOperationByExecutionId(context.subjectId, executionId));
    if (operation === undefined) throw notFound("Operation was not found or is no longer visible.");
    return operation.result;
  }

  async findOperationByCommand(context:RequestContext,commandId:string):Promise<ExecutionResult>{if(!context.effects.has("operations.read"))throw permissionDenied("operations.read");const operation=await this.dependencies.unitOfWork.read(store=>store.findOperation(context.subjectId,commandId));if(operation===undefined)throw notFound("Operation was not found or is no longer visible.");return operation.result;}

  private async recordMeal(context: RequestContext, command: RecordMealCommand,effects:readonly string[]): Promise<ExecutionResult> {
    const fingerprint = this.dependencies.fingerprinter.fingerprint({
      capability: command.capability,
      input: command.input
    });
    return this.dependencies.unitOfWork.transaction(async (store) => {
      await store.lockCommand(context.subjectId, command.command_id);
      const existing = await store.findOperation(context.subjectId, command.command_id);
      if (existing !== undefined) {
        if (!operationFingerprintMatches(existing,fingerprint,command.capability,command.input,this.dependencies.fingerprinter)) throw conflict("command_id was already used with different facts");
        return executionResultSchema.parse({ ...existing.result, replayed: true });
      }
      if(context.agentRun)await store.assertAgentRun(context.subjectId,context.agentRun.runId,context.agentRun.ownerId);
      await store.assertWriteDomains(writeDomains(effects),context.writeEpochs);

      const mealId = this.dependencies.ids.next("meal");
      let sourceId: string | undefined;
      const moneyEntryId = command.input.payment === undefined ? undefined : this.dependencies.ids.next("money");
      const executionId = this.dependencies.ids.next("exec");

      if (command.input.source !== undefined) {
        sourceId = await store.resolveSource({ proposedId: this.dependencies.ids.next("source"), subjectId: context.subjectId, source: command.input.source });
      }
      await store.insertMeal({ id: mealId, subjectId: context.subjectId, input: command.input });
      const itemIds: string[] = [];
      for (const [position, item] of command.input.items.entries()) {
        const id = this.dependencies.ids.next("intake");
        itemIds.push(id);
        await store.insertIntakeItem({ id, subjectId: context.subjectId, mealId, position, item });
      }
      if (moneyEntryId !== undefined && command.input.payment !== undefined) {
        const occurredAt = command.input.payment.occurred_at;
        await store.insertMoneyEntry({
          id: moneyEntryId,
          subjectId: context.subjectId,
          mealId,
          payment: command.input.payment,
          occurredOn: command.input.payment.occurred_on,
          ...(occurredAt === undefined ? {} : { occurredAt }),
          timeZone: command.input.payment.time_zone
        });
      }
      if (sourceId !== undefined) await store.linkMealSource(mealId, sourceId);

      const warnings = command.input.items.some((item) => item.estimate) ? ["部分营养值为估算，已保留依据。"] : [];
      const result = executionResultSchema.parse({
        protocol: "shadow.execution-result",
        capability: "life.record_meal",
        command_id: command.command_id,
        execution_id: executionId,
        status: "committed",
        result_kind: "record",
        resources: [
          { type: "meal", id: mealId, revision: 1 },
          ...itemIds.map((id) => ({ type: "intake_item" as const, id, revision: 1 })),
          ...(moneyEntryId === undefined ? [] : [{ type: "consumption_record" as const, id:`record_${moneyEntryId}`, revision:1 }]),
          ...(moneyEntryId === undefined ? [] : [{ type: "money_entry" as const, id: moneyEntryId, revision: 1 }]),
          ...(sourceId === undefined ? [] : [{ type: "source" as const, id: sourceId, revision: 1 }])
        ],
        actual_values: {
          meal_id: mealId,
          ...(moneyEntryId === undefined ? {} : { record_id:`record_${moneyEntryId}` }),
          ...(moneyEntryId === undefined ? {} : { money_entry_id: moneyEntryId }),
          ...(command.input.payment === undefined ? {} : { amount: command.input.payment.amount, currency: command.input.payment.currency })
        },
        warnings,
        replayed: false
      });
      const operation: StoredOperation = {
        ...(context.agentRun?{agentRunId:context.agentRun.runId,agentToolCallId:context.agentRun.toolCallId}:{}),
        executionId,
        subjectId: context.subjectId,
        commandId: command.command_id,
        capability: command.capability,
        fingerprint,
        result
      };
      await store.insertOperation(operation);
      await store.insertOutbox({
        id: this.dependencies.ids.next("event"),
        subjectId: context.subjectId,
        eventType: "life.meal.recorded",
        aggregateId: mealId,
        payload: { execution_id: executionId, meal_id: mealId }
      });
      return result;
    });
  }
}

function writeDomains(effects:readonly string[]):readonly ("health"|"ledger")[]{const domains=new Set<"health"|"ledger">();for(const effect of effects){if(effect.startsWith("health.")||effect==="life.meal.write")domains.add("health");if(effect.startsWith("money.")||effect==="life.purchase.write")domains.add("ledger");}return[...domains].sort();}

function operationFingerprintMatches(existing:StoredOperation,current:string,capability:string,input:unknown,fingerprinter:Fingerprinter):boolean{
  if(existing.fingerprint===current)return true;
  if(existing.legacyCapabilityVersion===undefined)return false;
  const legacyVersionKey=["capability","version"].join("_");
  return existing.fingerprint===fingerprinter.fingerprint({capability,[legacyVersionKey]:existing.legacyCapabilityVersion,input});
}

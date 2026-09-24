import assert from "node:assert/strict";
import test from "node:test";
import { CommandExecutor, KernelError, sha256Fingerprinter, type Clock, type IdGenerator, type StoredOperation, type TransactionStore, type UnitOfWork } from "../src/index.js";

class MemoryUnitOfWork implements UnitOfWork {
  state = { operations: [] as StoredOperation[], meals: [] as string[], money: [] as string[], sources: [] as string[], items: [] as string[], outbox: [] as string[] };
  failAt?: string;
  async transaction<T>(work: (store: TransactionStore) => Promise<T>): Promise<T> {
    const draft = structuredClone(this.state);
    const touch = (name: keyof typeof draft, id: string) => { if (this.failAt === name) throw new Error(`injected ${name}`); (draft[name] as string[]).push(id); };
    const store: TransactionStore = {
      assertAgentRun:async()=>undefined,
      lockCommand: async () => undefined,
      assertWriteDomains:async()=>undefined,
      findOperation: async (subjectId, commandId) => draft.operations.find((item) => item.subjectId === subjectId && item.commandId === commandId),
      resolveSource: async ({ proposedId }) => { touch("sources", proposedId); return proposedId; },
      insertMeal: async ({ id }) => touch("meals", id),
      insertIntakeItem: async ({ id }) => touch("items", id),
      insertMoneyEntry: async ({ id }) => touch("money", id),
      linkMealSource: async () => undefined,
      insertOperation: async (value) => { if (this.failAt === "operations") throw new Error("injected operations"); draft.operations.push(value); },
      insertOutbox: async ({ id }) => touch("outbox", id),
      getOperationByExecutionId: async (subjectId, executionId) => draft.operations.find((item) => item.subjectId === subjectId && item.executionId === executionId),
      listMeals: async () => ({items:[],hasMore:false,asOf:new Date().toISOString()}),
      foodCatalog:async()=>({foods:[],recipes:[],as_of:new Date().toISOString()}),
      summarizeMoney: async () => ({ currency: "CNY", expense_total: "0.00", entries: 0, as_of:"2026-09-08T00:00:00Z",totals:[] }),
      executeDomainWrite: async () => { throw new Error("not used"); },
      listDomain: async () => ({items:[],hasMore:false,asOf:"2026-09-09T00:00:00.000Z"}),
      healthReleaseHistory:async()=>({}),
      healthTrend:async()=>({metric_key:"weight",points:[],coverage:{from:null,to:null,points:0,truncated:false},as_of:new Date().toISOString()}),
      healthSleepNights:async()=>[],
      healthSources:async()=>({items:[],as_of:new Date().toISOString()}),
      lifeToday:async(_subjectId,date)=>({date,domains:{},as_of:new Date().toISOString()}),
      dailyRecordCheck:async()=>({meals:[],purchases:{records:0,with_payment:0},money:{entries:0,expenses:0,income:0,refunds:0},health:{facts:0,by_kind:[],steps:null,sleep_target_on:"2026-09-07",sleep_sessions:0},sources:[],as_of:new Date().toISOString()}),
      lifeTimeline:async()=>({items:[],hasMore:false,asOf:new Date().toISOString()}),
      lifeSearch:async()=>({items:[],hasMore:false,asOf:new Date().toISOString()}),
      consumptionStatsData:async()=>({purchases:[],meals:[],intakes:[],aliases:[],asOf:new Date().toISOString()}),
      lifeRecord:async()=>undefined,moneyPlanning:async()=>({}),serviceCards:async()=>({items:[],next_after_id:null,as_of:new Date().toISOString()}),moneyImportReview:async()=>undefined,moneyImportMonth:async()=>({period:"2026-09",batches:[],totals:{unconfirmed:0,duplicates:0,uncategorized:0,refunds_unlinked:0},as_of:new Date().toISOString()}),healthDaily:async()=>undefined,healthRecord:async()=>undefined,travelTrip:async()=>undefined,travelWorkspace:async()=>({}),travelExportData:async()=>undefined,libraryItem:async()=>undefined,libraryProcessingQueue:async()=>({items:[]}),agentContextPack:async()=>undefined,agentMemories:async()=>({items:[],asOf:new Date().toISOString()}),notifications:async()=>({items:[]}),ownedItems:async()=>({items:[]}),lifeReviews:async()=>({items:[]}),lifeProjects:async()=>({items:[]}),planningAgenda:async()=>({items:[],truncated:false,asOf:new Date().toISOString()}),mealPlanning:async()=>({meal_plans:[],shopping_lists:[]}),purchaseItems:async()=>({items:[]}),foreignEntries:async()=>({items:[]}),agentPersonalContext:async()=>({aliases:[],mealTemplates:[]})
    };
    const result = await work(store);
    this.state = draft;
    return result;
  }
  read<T>(work: (store: TransactionStore) => Promise<T>): Promise<T> { return this.transaction(work); }
}

let sequence = 0;
const ids: IdGenerator = { next: (prefix) => `${prefix}_${String(++sequence).padStart(8, "0")}` };
const clock: Clock = { now: () => new Date("2026-09-08T04:00:00+00:00") };
const command = {
  protocol: "shadow.command",
  capability: "life.record_meal",
  command_id: "cmd_network_0001",
  input: {
    occurred_on: "2026-09-08", time_zone: "Asia/Shanghai", meal_type: "lunch",
    items: [{ name: "牛肉面", quantity: "1", unit: "碗", estimate: false }],
    payment: { amount: "35.00", currency: "CNY", occurred_on: "2026-09-08", time_zone: "Asia/Shanghai" },
    source: { kind: "text", captured_at: "2026-09-08T12:00:00+08:00", time_zone: "Asia/Shanghai", original_text: "午饭牛肉面 35 元" }
  }
} as const;
const context = { actorId: "actor_test", subjectId: "subject_test", clientId: "client_test", traceId: "trace_test", effects: new Set(["life.meal.write", "money.entry.write", "library.source.link", "operations.read"]) };

test("one command commits meal, payment, source, operation and outbox", async () => {
  const unitOfWork = new MemoryUnitOfWork();
  const executor = new CommandExecutor({ unitOfWork, ids, clock, fingerprinter: sha256Fingerprinter });
  const result = await executor.execute(context, command);
  assert.equal(result.status, "committed");
  assert.equal(result.actual_values.amount, "35.00");
  assert.deepEqual(Object.fromEntries(Object.entries(unitOfWork.state).map(([key, value]) => [key, value.length])), { operations: 1, meals: 1, money: 1, sources: 1, items: 1, outbox: 1 });
});

test("same command and facts replay; changed facts conflict", async () => {
  const unitOfWork = new MemoryUnitOfWork();
  const executor = new CommandExecutor({ unitOfWork, ids, clock, fingerprinter: sha256Fingerprinter });
  const first = await executor.execute(context, command);
  const replay = await executor.execute(context, command);
  assert.equal(replay.execution_id, first.execution_id);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => executor.execute(context, { ...command, input: { ...command.input, note: "changed" } }), (error: unknown) => error instanceof KernelError && error.status === 409);
});

test("missing money permission blocks the whole command", async () => {
  const unitOfWork = new MemoryUnitOfWork();
  const executor = new CommandExecutor({ unitOfWork, ids, clock, fingerprinter: sha256Fingerprinter });
  await assert.rejects(() => executor.execute({ ...context, effects: new Set(["life.meal.write", "library.source.link"]) }, command), (error: unknown) => error instanceof KernelError && error.status === 403);
  assert.equal(unitOfWork.state.meals.length, 0);
});

test("failure at every write stage leaves no partial facts", async () => {
  for (const stage of ["sources", "meals", "items", "money", "operations", "outbox"]) {
    const unitOfWork = new MemoryUnitOfWork(); unitOfWork.failAt = stage;
    const executor = new CommandExecutor({ unitOfWork, ids, clock, fingerprinter: sha256Fingerprinter });
    await assert.rejects(() => executor.execute(context, { ...command, command_id: `cmd_failure_${stage}` }));
    assert.deepEqual(Object.values(unitOfWork.state).map((items) => items.length), [0, 0, 0, 0, 0, 0]);
  }
});

test("command-id receipt recovery is subject-bound and requires operation read authority", async () => {
  const unitOfWork = new MemoryUnitOfWork();
  const executor = new CommandExecutor({ unitOfWork, ids, clock, fingerprinter: sha256Fingerprinter });
  const committed = await executor.execute(context, command);
  assert.deepEqual(await executor.findOperationByCommand(context, command.command_id), committed);
  await assert.rejects(executor.findOperationByCommand({ ...context, subjectId: "subject_other" }, command.command_id), (error: unknown) => error instanceof KernelError && error.status === 404);
  await assert.rejects(executor.findOperationByCommand({ ...context, effects: new Set() }, command.command_id), (error: unknown) => error instanceof KernelError && error.status === 403);
  assert.equal(unitOfWork.state.meals.length, 1);
});

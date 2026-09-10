import type { ExecutionResult, LifeOverviewDomain, LifeTimelineItem, MealView, MoneySummary, RecordMealInput, UniversalCommandEnvelope } from "@shadow/contracts";

export interface RequestContext {
  readonly actorId: string;
  readonly subjectId: string;
  readonly clientId: string;
  readonly effects: ReadonlySet<string>;
  readonly traceId: string;
  readonly writeEpochs?: Readonly<Partial<Record<"health" | "ledger", number>>>;
}

export interface StoredOperation {
  readonly executionId: string;
  readonly subjectId: string;
  readonly commandId: string;
  readonly capability: string;
  readonly legacyCapabilityVersion?: number;
  readonly fingerprint: string;
  readonly result: ExecutionResult;
}

export interface TransactionStore {
  lockCommand(subjectId: string, commandId: string): Promise<void>;
  assertWriteDomains(domains:readonly ("health"|"ledger")[],expected?:Readonly<Partial<Record<"health"|"ledger",number>>>):Promise<void>;
  findOperation(subjectId: string, commandId: string): Promise<StoredOperation | undefined>;
  resolveSource(value: { proposedId: string; subjectId: string; source: NonNullable<RecordMealInput["source"]> }): Promise<string>;
  insertMeal(value: { id: string; subjectId: string; input: RecordMealInput }): Promise<void>;
  insertIntakeItem(value: { id: string; subjectId: string; mealId: string; position: number; item: RecordMealInput["items"][number] }): Promise<void>;
  insertMoneyEntry(value: { id: string; subjectId: string; mealId: string; payment: { amount:string; currency:"CNY"; payment_method?:string|undefined; note?:string|undefined }; occurredOn: string; occurredAt?: string; timeZone: string }): Promise<void>;
  linkMealSource(mealId: string, sourceId: string): Promise<void>;
  insertOperation(value: StoredOperation): Promise<void>;
  insertOutbox(value: { id: string; subjectId: string; eventType: string; aggregateId: string; payload: unknown }): Promise<void>;
  getOperationByExecutionId(subjectId: string, executionId: string): Promise<StoredOperation | undefined>;
  listMeals(subjectId: string, limit: number, includeMoney: boolean): Promise<readonly MealView[]>;
  summarizeMoney(subjectId: string): Promise<MoneySummary>;
  executeDomainWrite(value: { subjectId: string; command: UniversalCommandEnvelope; nextId(type: string): string }): Promise<{ resources: ExecutionResult["resources"]; actualValues: ExecutionResult["actual_values"]; warnings?: string[] }>;
  listDomain(subjectId:string,domain:"money"|"health"|"travel"|"library",options:{query?:string;limit:number;asOf?:string;before?:{at:string;kind:string;id:string}}):Promise<{items:readonly Record<string,unknown>[];hasMore:boolean;asOf:string}>;
  healthTrend(subjectId:string,input:{metric_key:string;from?:string|undefined;to?:string|undefined;limit:number}):Promise<unknown>;
  healthSources(subjectId:string):Promise<unknown>;
  lifeToday(subjectId:string,date:string,timeZone:string,domains:readonly LifeOverviewDomain[]):Promise<unknown>;
  lifeTimeline(subjectId:string,domains:readonly LifeOverviewDomain[],options:{limit:number;asOf?:string;before?:{at:string;domain:LifeOverviewDomain;kind:string;id:string}}):Promise<{items:readonly LifeTimelineItem[];hasMore:boolean;asOf:string}>;
  lifeRecord(subjectId:string,id:string,sections:readonly ("meal"|"purchase"|"money"|"sources")[]):Promise<unknown|undefined>;
  moneyPlanning(subjectId:string,period:string):Promise<unknown>;
  healthDaily(subjectId:string,date:string):Promise<unknown|undefined>;
  travelTrip(subjectId:string,id:string):Promise<unknown|undefined>;
  libraryItem(subjectId:string,id:string):Promise<unknown|undefined>;
  agentPersonalContext(subjectId:string,aliasKinds:readonly string[],includeMealTemplates:boolean):Promise<{aliases:readonly Record<string,unknown>[];mealTemplates:readonly Record<string,unknown>[]}>;
}

export interface UnitOfWork {
  transaction<T>(work: (store: TransactionStore) => Promise<T>): Promise<T>;
  read<T>(work: (store: TransactionStore) => Promise<T>): Promise<T>;
}

export interface IdGenerator { next(prefix: "meal" | "template" | "intake" | "money" | "record" | "source" | "source_instance" | "raw" | "exec" | "event" | "purchase" | "purchase_item" | "refund" | "budget" | "plan" | "health" | "trip" | "reservation" | "visit" | "library" | "thread" | "message" | "run"): string; }
export interface Clock { now(): Date; }
export interface Fingerprinter { fingerprint(value: unknown): string; }

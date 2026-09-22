import type { DomainRecordSummary, ExecutionResult, LifeOverviewDomain, LifeTimelineItem, MealView, MoneySummary, PlanningAgendaItem, RecordMealInput, UniversalCommandEnvelope } from "@shadow/contracts";
import type { DailyRecordCheckRawData } from "./daily-record-check.js";

export type DomainRecordPageItem=DomainRecordSummary&{readonly _page_at:string};

export interface RequestContext {
  readonly actorId: string;
  readonly subjectId: string;
  readonly oidcSubject?: string;
  readonly clientId: string;
  readonly issuer?: string;
  readonly environmentId?: string;
  readonly displayName?: string;
  readonly authorizationRevision?: number;
  readonly effects: ReadonlySet<string>;
  readonly traceId: string;
  readonly agentRun?:{readonly runId:string;readonly ownerId:string;readonly toolCallId:string};
  readonly writeEpochs?: Readonly<Partial<Record<"health" | "ledger", number>>>;
}

export interface StoredOperation {
  readonly agentRunId?:string;
  readonly agentToolCallId?:string;
  readonly executionId: string;
  readonly subjectId: string;
  readonly commandId: string;
  readonly capability: string;
  readonly legacyCapabilityVersion?: number;
  readonly fingerprint: string;
  readonly result: ExecutionResult;
}

export interface TransactionStore {
  assertAgentRun(subjectId:string,runId:string,ownerId:string):Promise<void>;
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
  listMeals(subjectId:string,options:{limit:number;includeMoney:boolean;asOf?:string;before?:{on:string;at:string;id:string}}):Promise<{items:readonly (MealView&{_page_at:string})[];hasMore:boolean;asOf:string}>;
  foodCatalog(subjectId:string,query:string|undefined,limit:number):Promise<unknown>;
  summarizeMoney(subjectId: string): Promise<MoneySummary>;
  executeDomainWrite(value: { subjectId: string; command: UniversalCommandEnvelope; nextId(type: string): string }): Promise<{ resources: ExecutionResult["resources"]; actualValues: ExecutionResult["actual_values"]; warnings?: string[] }>;
  listDomain(subjectId:string,domain:"money"|"health"|"travel"|"library",options:{includePurchase?:boolean;query?:string;limit:number;asOf?:string;before?:{at:string;kind:string;id:string}}):Promise<{items:readonly DomainRecordPageItem[];hasMore:boolean;asOf:string}>;
  healthReleaseHistory(subjectId:string,input:{from:string;to:string;limit:number}):Promise<unknown>;
  healthTrend(subjectId:string,input:{metric_key:string;from?:string|undefined;to?:string|undefined;limit:number}):Promise<unknown>;
  healthSources(subjectId:string):Promise<unknown>;
  lifeToday(subjectId:string,date:string,timeZone:string,domains:readonly LifeOverviewDomain[]):Promise<unknown>;
  dailyRecordCheck(subjectId:string,date:string,timeZone:string):Promise<DailyRecordCheckRawData>;
  lifeTimeline(subjectId:string,domains:readonly LifeOverviewDomain[],options:{includePurchase?:boolean;limit:number;asOf?:string;before?:{at:string;domain:LifeOverviewDomain;kind:string;id:string}}):Promise<{items:readonly LifeTimelineItem[];hasMore:boolean;asOf:string}>;
  lifeSearch(subjectId:string,domains:readonly LifeOverviewDomain[],options:{includePurchase?:boolean;query:string;fromOn?:string;toOnExclusive?:string;limit:number;asOf?:string;before?:{on:string;domain:LifeOverviewDomain;kind:string;id:string}}):Promise<{items:readonly import("@shadow/contracts").LifeSearchItem[];hasMore:boolean;asOf:string}>;
  consumptionStatsData(subjectId:string,input:{fromOn:string;toOnExclusive:string;timeZone:string;includeMoney:boolean}):Promise<import("./consumption-stats.js").ConsumptionStatsRawData>;
  lifeRecord(subjectId:string,id:string,sections:readonly ("meal"|"purchase"|"money"|"sources")[],includeTravel?:boolean):Promise<unknown|undefined>;
  moneyPlanning(subjectId:string,period:string):Promise<unknown>;
  serviceCards(subjectId:string,input:import("@shadow/contracts").ServiceCardsInput):Promise<unknown>;
  moneyImportReview(subjectId:string,batchId:string):Promise<unknown|undefined>;
  healthDaily(subjectId:string,date:string):Promise<unknown|undefined>;
  healthRecord(subjectId:string,id:string):Promise<unknown|undefined>;
  travelTrip(subjectId:string,id:string):Promise<unknown|undefined>;
  travelWorkspace(subjectId:string,tripId?:string):Promise<unknown|undefined>;
  travelExportData(subjectId:string,tripId:string):Promise<unknown|undefined>;
  libraryItem(subjectId:string,id:string):Promise<unknown|undefined>;
  libraryProcessingQueue(subjectId:string,kind:string|undefined,limit:number):Promise<unknown>;
  agentContextPack(subjectId:string,id:string,threadId?:string):Promise<unknown|undefined>;
  agentMemories(subjectId:string,category:string|undefined,limit:number):Promise<{items:readonly Record<string,unknown>[];asOf:string}>;
  notifications(subjectId:string,options:{limit:number;asOf?:string|undefined;before?:{at:string;id:string}|undefined}):Promise<unknown>;
  ownedItems(subjectId:string,state:string|undefined,limit:number,visibility:{purchase:boolean;library:boolean;money:boolean},id?:string):Promise<unknown>;
  lifeReviews(subjectId:string,limit:number,authorizedDomains:readonly string[],id?:string):Promise<unknown>;
  lifeProjects(subjectId:string,state:string|undefined,limit:number,authorizedKinds:readonly string[],id?:string):Promise<unknown>;
  planningAgenda(subjectId:string,input:{fromOn:string;toOnExclusive:string;timeZone:string;limit:number;includeProjects:boolean;includeMoney:boolean;includeHealth:boolean}):Promise<{items:readonly PlanningAgendaItem[];truncated:boolean;asOf:string}>;
  mealPlanning(subjectId:string,limit:number):Promise<unknown>;
  purchaseItems(subjectId:string,query:string|undefined,limit:number):Promise<unknown>;
  foreignEntries(subjectId:string,tripId:string|undefined,limit:number,includeTrip:boolean):Promise<unknown>;
  agentPersonalContext(subjectId:string,aliasKinds:readonly string[],includeMealTemplates:boolean):Promise<{aliases:readonly Record<string,unknown>[];mealTemplates:readonly Record<string,unknown>[]}>;
}

export interface UnitOfWork {
  transaction<T>(work: (store: TransactionStore) => Promise<T>): Promise<T>;
  read<T>(work: (store: TransactionStore) => Promise<T>): Promise<T>;
}

export interface IdGenerator { next(prefix: "meal" | "template" | "intake" | "money" | "record" | "source" | "source_instance" | "raw" | "exec" | "event" | "purchase" | "purchase_item" | "refund" | "budget" | "plan" | "health" | "trip" | "reservation" | "visit" | "library" | "thread" | "message" | "run"): string; }
export interface Clock { now(): Date; }
export interface Fingerprinter { fingerprint(value: unknown): string; }

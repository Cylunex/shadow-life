import { healthSourcesResultSchema, healthTrendResultSchema, mealViewSchema, moneySummarySchema, type MealView, type MoneySummary } from "@shadow/contracts";
import { invalidInput, notFound, permissionDenied } from "./errors.js";
import type { RequestContext, UnitOfWork } from "./ports.js";

type Domain="money"|"health"|"travel"|"library";
type Cursor={domain:Domain;query:string;at:string;kind:string;id:string;as_of:string};
type LifeRecordSection="meal"|"purchase"|"money"|"sources";

export class QueryService {
  constructor(private readonly unitOfWork:UnitOfWork) {}
  async listMeals(context:RequestContext,limit=20):Promise<readonly MealView[]>{if(!context.effects.has("life.meal.read"))throw permissionDenied("life.meal.read");if(!Number.isInteger(limit)||limit<1||limit>100)throw invalidInput("limit must be between 1 and 100",["limit"]);return mealViewSchema.array().parse(await this.unitOfWork.read(store=>store.listMeals(context.subjectId,limit,context.effects.has("money.entry.read"))));}
  async summarizeMoney(context:RequestContext):Promise<MoneySummary>{if(!context.effects.has("money.summary.read"))throw permissionDenied("money.summary.read");return moneySummarySchema.parse(await this.unitOfWork.read(store=>store.summarizeMoney(context.subjectId)));}
  async listDomain(context:RequestContext,domain:Domain,options:{query?:string|undefined;limit?:number|undefined;cursor?:string|undefined}={}):Promise<{items:readonly Record<string,unknown>[];next_cursor:string|null;as_of:string}>{
    const effect=`${domain}.${domain==="library"?"item":domain==="health"?"measurement":domain==="travel"?"trip":"entry"}.read`;if(!context.effects.has(effect))throw permissionDenied(effect);
    const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw invalidInput("limit must be between 1 and 100",["limit"]);const query=options.query?.trim().toLocaleLowerCase()??"";let asOf:string|undefined,before:Cursor|undefined;
    if(options.cursor){try{before=JSON.parse(Buffer.from(options.cursor,"base64url").toString("utf8")) as Cursor;}catch{throw invalidInput("cursor is invalid",["cursor"]);}if(before.domain!==domain||before.query!==query||!before.at||!before.kind||!before.id||!before.as_of)throw invalidInput("cursor does not match this query",["cursor"]);asOf=before.as_of;}
    const page=await this.unitOfWork.read(store=>store.listDomain(context.subjectId,domain,{...(query?{query}:{}),limit,...(asOf?{asOf}:{}),...(before?{before:{at:before.at,kind:before.kind,id:before.id}}:{})}));asOf=page.asOf;const items=page.items.map(({_page_at,...item})=>item);const last=page.items.at(-1),next=page.hasMore&&last?Buffer.from(JSON.stringify({domain,query,at:String(last._page_at),kind:String(last.kind),id:String(last.id),as_of:asOf} satisfies Cursor)).toString("base64url"):null;return{items,next_cursor:next,as_of:asOf};
  }
  async healthTrend(context:RequestContext,input:{metric_key:string;from?:string|undefined;to?:string|undefined;limit:number}){if(!context.effects.has("health.measurement.read"))throw permissionDenied("health.measurement.read");return healthTrendResultSchema.parse(await this.unitOfWork.read(store=>store.healthTrend(context.subjectId,input)));}
  async healthSources(context:RequestContext){if(!context.effects.has("health.measurement.read"))throw permissionDenied("health.measurement.read");return healthSourcesResultSchema.parse(await this.unitOfWork.read(store=>store.healthSources(context.subjectId)));}
  async lifeRecord(context:RequestContext,id:string,requested?:readonly LifeRecordSection[]){
    const sections=[...new Set(requested??[...(context.effects.has("life.meal.read")?["meal","purchase","sources"] as const:[]),...(context.effects.has("money.entry.read")?["money"] as const:[])])];
    if(!sections.length)throw permissionDenied("life.meal.read");
    if(sections.some(section=>section!=="money")&&!context.effects.has("life.meal.read"))throw permissionDenied("life.meal.read");
    if(sections.includes("money")&&!context.effects.has("money.entry.read"))throw permissionDenied("money.entry.read");
    const value=await this.unitOfWork.read(store=>store.lifeRecord(context.subjectId,id,sections));if(value===undefined)throw notFound("life record was not found");return value;
  }
  async moneyPlanning(context:RequestContext,period:string){if(!context.effects.has("money.entry.read"))throw permissionDenied("money.entry.read");if(!/^\d{4}-(0[1-9]|1[0-2])$/u.test(period))throw invalidInput("period must be a valid YYYY-MM",["period"]);return this.unitOfWork.read(store=>store.moneyPlanning(context.subjectId,period));}
  async healthDaily(context:RequestContext,date:string){if(!context.effects.has("health.measurement.read"))throw permissionDenied("health.measurement.read");const value=await this.unitOfWork.read(store=>store.healthDaily(context.subjectId,date));if(value===undefined)throw notFound("health day was not found");return value;}
  async travelTrip(context:RequestContext,id:string){if(!context.effects.has("travel.trip.read"))throw permissionDenied("travel.trip.read");const value=await this.unitOfWork.read(store=>store.travelTrip(context.subjectId,id));if(value===undefined)throw notFound("trip was not found");return value;}
  async libraryItem(context:RequestContext,id:string){if(!context.effects.has("library.item.read"))throw permissionDenied("library.item.read");const value=await this.unitOfWork.read(store=>store.libraryItem(context.subjectId,id));if(value===undefined)throw notFound("library item was not found");return value;}
  async agentPersonalContext(context:RequestContext){const aliasKinds=[...(context.effects.has("life.meal.read")?["food","meal_template"]:[]),...(context.effects.has("money.entry.read")?["merchant","payment_method"]:[])],includeMealTemplates=context.effects.has("life.meal.read");if(!aliasKinds.length&&!includeMealTemplates)return{aliases:[],mealTemplates:[]};return this.unitOfWork.read(store=>store.agentPersonalContext(context.subjectId,aliasKinds,includeMealTemplates));}
}

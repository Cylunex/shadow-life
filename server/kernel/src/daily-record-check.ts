import { dailyRecordCheckResultSchema, type DailyRecordCheckInput, type DailyRecordCheckResult } from "@shadow/contracts";

type MealType="breakfast"|"lunch"|"dinner"|"snack"|"other";
type Period="morning"|"midday"|"afternoon"|"evening"|"late_night"|"unknown";
type HealthKind="measurement"|"observation"|"wellbeing"|"sleep"|"workout"|"activity"|"habit";

export interface DailyRecordCheckRawData {
  meals:Array<{meal_type:MealType;local_hour:number|null}>;
  purchases:{records:number;with_payment:number};
  money:{entries:number;expenses:number;income:number;refunds:number};
  health:{facts:number;by_kind:Array<{kind:HealthKind;count:number}>;steps:number|null;sleep_target_on:string;sleep_sessions:number};
  sources:Array<{source_type:string;instance_key:string;permission_state:string;cursor_states:string[];last_sync_at:string|null}>;
  as_of:string;
}

const periods:Period[]=["morning","midday","afternoon","evening","late_night","unknown"];
const mealTypes:MealType[]=["breakfast","lunch","dinner","snack","other"];
const healthKinds:HealthKind[]=["measurement","observation","wellbeing","sleep","workout","activity","habit"];
function periodFor(hour:number|null):Period{if(hour===null||!Number.isFinite(hour))return"unknown";if(hour>=5&&hour<11)return"morning";if(hour>=11&&hour<14)return"midday";if(hour>=14&&hour<17)return"afternoon";if(hour>=17&&hour<22)return"evening";return"late_night";}
function expectationStatus(expected:number,actual:number):"met"|"missing"|"not_configured"{return expected===0?"not_configured":actual>=expected?"met":"missing";}

export function buildDailyRecordCheck(raw:DailyRecordCheckRawData,input:DailyRecordCheckInput):DailyRecordCheckResult{
  const expectations=input.expectations,periodCounts=new Map(periods.map(period=>[period,0])),typeCounts=new Map(mealTypes.map(type=>[type,0]));
  for(const meal of raw.meals){const period=periodFor(meal.local_hour);periodCounts.set(period,periodCounts.get(period)!+1);typeCounts.set(meal.meal_type,typeCounts.get(meal.meal_type)!+1);}
  const confirmed:Array<{code:"meal_records_below_minimum"|"expected_meal_type_missing"|"purchase_records_below_minimum"|"money_entries_below_minimum";domain:"meals"|"purchases"|"money";message:string}>=[];
  const missingTypes=expectations.expected_meal_types.filter(type=>(typeCounts.get(type)??0)===0);
  if(missingTypes.length)confirmed.push({code:"expected_meal_type_missing",domain:"meals",message:`按已配置的餐次期望，${missingTypes.join("、")}尚无记录。`});
  if(raw.meals.length<expectations.minimum_meal_records)confirmed.push({code:"meal_records_below_minimum",domain:"meals",message:`当天已记录 ${raw.meals.length} 条用餐，低于配置的 ${expectations.minimum_meal_records} 条最低记录期望；请核对是否有未记用餐，无法仅凭数量判断具体餐次。`});
  if(raw.purchases.records<expectations.minimum_purchase_records)confirmed.push({code:"purchase_records_below_minimum",domain:"purchases",message:`当天已记录 ${raw.purchases.records} 条购买，低于配置的 ${expectations.minimum_purchase_records} 条最低记录期望。`});
  if(raw.money.entries<expectations.minimum_money_entries)confirmed.push({code:"money_entries_below_minimum",domain:"money",message:`当天已记录 ${raw.money.entries} 笔收支，低于配置的 ${expectations.minimum_money_entries} 笔最低记录期望。`});
  const sources=raw.sources.map(source=>{const issue=source.permission_state!=="granted"||source.cursor_states.some(state=>state!=="active");return{...source,status:issue?"issue" as const:"ok" as const};}),syncIssues=sources.filter(source=>source.status==="issue");
  const actionable=[...confirmed.map(item=>item.message)];
  if(syncIssues.length)actionable.push(`健康同步状态异常：${syncIssues.map(source=>`${source.source_type}/${source.instance_key}`).join("、")}；请在设备同步页检查权限或重试。`);
  const sleepStatus=raw.health.sleep_sessions>0?"recorded":syncIssues.length?"sync_issue":"awaiting_sync";
  return dailyRecordCheckResultSchema.parse({
    date:input.date,time_zone:input.time_zone,expectations,
    meals:{count:raw.meals.length,by_period:periods.map(period=>({period,count:periodCounts.get(period)!})),by_type:mealTypes.map(meal_type=>({meal_type,count:typeCounts.get(meal_type)!})),expectation_status:expectations.minimum_meal_records===0&&expectations.expected_meal_types.length===0?"not_configured":raw.meals.length<expectations.minimum_meal_records||missingTypes.length>0?"missing":"met"},
    purchases:{...raw.purchases,expectation_status:expectationStatus(expectations.minimum_purchase_records,raw.purchases.records)},
    money:{entries:raw.money.entries,by_type:[{entry_type:"expense",count:raw.money.expenses},{entry_type:"income",count:raw.money.income},{entry_type:"refund",count:raw.money.refunds}],expectation_status:expectationStatus(expectations.minimum_money_entries,raw.money.entries)},
    health:{facts:raw.health.facts,by_kind:healthKinds.map(kind=>({kind,count:raw.health.by_kind.find(item=>item.kind===kind)?.count??0})),steps:raw.health.steps,sources,sleep_check:{wake_date:raw.health.sleep_target_on,sessions:raw.health.sleep_sessions,status:sleepStatus},goal_expectations_applied:false,goal_gaps:[]},
    confirmed_omissions:confirmed,actionable_messages:actionable.slice(0,3),as_of:raw.as_of
  });
}

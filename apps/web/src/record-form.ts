import type { WriteCapabilityName } from "@shadow/contracts";

export type RecordKind="expense"|"income"|"meal"|"health";
export type PlanKind="budget"|"habit"|"goal"|"workout";
export type MealType="breakfast"|"lunch"|"dinner"|"snack"|"other";
export type HealthMetric="weight"|"body_fat"|"heart_rate"|"blood_pressure_systolic"|"blood_pressure_diastolic"|"temperature"|"sleep_duration"|"steps"|"custom";
export interface RecordFormFields { title:string; amount:string; note:string; category:string; paymentMethod:string; kind:RecordKind; planKind:PlanKind; scheduleDays:string; occurredOn:string; paymentOn:string; timeZone:string; mealType:MealType; healthMetric:HealthMetric; unit:string; }
export interface BuiltFormCommand { capability:WriteCapabilityName; input:unknown; }

export const healthMetricUnits:Record<HealthMetric,string>={weight:"kg",body_fat:"%",heart_rate:"bpm",blood_pressure_systolic:"mmHg",blood_pressure_diastolic:"mmHg",temperature:"°C",sleep_duration:"min",steps:"count",custom:"unit"};

export function initialRecordFields(date:string,timeZone:string):RecordFormFields{return{title:"",amount:"",note:"",category:"",paymentMethod:"",kind:"expense",planKind:"budget",scheduleDays:"1,3,5",occurredOn:date,paymentOn:date,timeZone,mealType:"other",healthMetric:"weight",unit:"kg"};}

export function buildFormCommand(tab:"record"|"plan"|"library",fields:RecordFormFields):BuiltFormCommand{
  const note=optional(fields.note),title=optional(fields.title),category=optional(fields.category),timeZone=fields.timeZone;
  if(tab==="library")return{capability:"library.capture",input:{title:fields.title.trim(),item_type:"note",text:fields.note,tags:splitTags(fields.category)}};
  if(tab==="plan"){
    if(fields.planKind==="budget")return{capability:"money.set_budget",input:{period:fields.occurredOn.slice(0,7),category:fields.category.trim(),amount:cny(fields.amount),currency:"CNY"}};
    if(fields.planKind==="goal")return{capability:"health.set_plan",input:{kind:"goal",name:fields.title.trim(),state:"active",metric_key:fields.healthMetric,target_value:decimal(fields.amount),unit:fields.unit.trim(),...(fields.occurredOn?{due_on:fields.occurredOn}:{})}};
    return{capability:"health.set_plan",input:{kind:fields.planKind,name:fields.title.trim(),state:"active",schedule:{days:scheduleDays(fields.scheduleDays)},...(fields.planKind==="workout"&&note?{detail:{note}}:{})}};
  }
  if(fields.kind==="meal")return{capability:"life.record_meal",input:{occurred_on:fields.occurredOn,time_zone:timeZone,meal_type:fields.mealType,...(note?{note}:{}),items:[{name:fields.title.trim(),estimate:false}],...(fields.amount.trim()?{payment:{amount:cny(fields.amount),currency:"CNY",occurred_on:fields.paymentOn,time_zone:timeZone,...(fields.paymentMethod?{payment_method:fields.paymentMethod}:{})}}:{})}};
  if(fields.kind==="health")return{capability:"health.record_measurement",input:{metric:fields.healthMetric,...(title?{label:title}:{}),value:fields.amount.trim(),unit:fields.unit.trim(),occurred_on:fields.occurredOn,time_zone:timeZone,...(note?{note}:{})}};
  return{capability:"money.record_entry",input:{entry_type:fields.kind,amount:cny(fields.amount),currency:"CNY",occurred_on:fields.occurredOn,time_zone:timeZone,...(title?{counterparty:title}:{}),...(note?{note}:{}),...(category?{category}:{}),...(fields.paymentMethod?{payment_method:fields.paymentMethod}:{})}};
}

function optional(value:string):string|undefined{return value.trim()||undefined;}
function splitTags(value:string):string[]{return value.split(/[,，]/u).map(item=>item.trim()).filter(Boolean);}
function cny(value:string):string{const match=/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u.exec(value.trim());if(!match)throw new Error("金额最多保留两位小数");return`${match[1]}.${(match[2]??"").padEnd(2,"0")}`;}
function decimal(value:string):string{const result=value.trim();if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(result))throw new Error("目标值必须是普通十进制数字");return result;}
function scheduleDays(value:string):number[]{const parts=value.split(/[,，\s]+/u).filter(Boolean),days=parts.map(Number);if(days.length===0||days.some(day=>!Number.isInteger(day)||day<1||day>7))throw new Error("执行日请填写 1 到 7，用逗号分隔");return[...new Set(days)].sort((left,right)=>left-right);}

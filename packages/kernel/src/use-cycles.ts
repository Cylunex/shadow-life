export type UseCycleUnit="g"|"ml"|"count";
export type UseCycleMatchMode="none"|"exact_name"|"food_ref";

export interface UseCycleRaw extends Record<string,unknown> {
  id:string;purchase_record_id:string|null;purchase_item_id:string|null;item_name:string;started_on:string;ended_on:string|null;
  state:"active"|"completed"|"discarded"|"replenished";revision:number;
  initial_quantity:string|null;quantity_unit:UseCycleUnit|null;expected_daily_usage:string|null;
  replenish_threshold:string|null;replenish_lead_days:number|null;time_zone:string;
  match_mode:UseCycleMatchMode;match_value:string|null;reminder_enabled:boolean;
}

export interface UseCycleIntakeRaw extends Record<string,unknown> {
  id:string;name:string;food_ref_id:string|null;quantity:string|null;unit:string|null;amount_g:string|null;consumed_fraction:string|null;
}

const scale=1_000_000n;
function decimal(value:string|null|undefined):bigint|null{
  if(value===null||value===undefined)return null;
  const match=/^(\d+)(?:\.(\d{1,6}))?$/u.exec(value);if(!match)return null;
  return BigInt(match[1]!)*scale+BigInt((match[2]??"").padEnd(6,"0"));
}
function decimalText(value:bigint):string{const whole=value/scale,fraction=(value%scale).toString().padStart(6,"0").replace(/0+$/u,"");return`${whole}${fraction?`.${fraction}`:""}`;}
function normalized(value:string):string{return value.normalize("NFKC").trim().replace(/\s+/gu," ").toLocaleLowerCase();}
function quantity(value:string|null,unit:string|null,amountG:string|null,target:UseCycleUnit):{value:bigint|null;unit:string|null}{
  if(target==="g"&&amountG){const parsed=decimal(amountG);if(parsed!==null)return{value:parsed,unit:"g"};}
  const parsed=decimal(value);if(parsed===null||!unit)return{value:null,unit:unit?normalized(unit):null};const key=normalized(unit);
  if(target==="g"){if(["g","克"].includes(key))return{value:parsed,unit:"g"};if(["kg","千克","公斤"].includes(key))return{value:parsed*1000n,unit:"g"};}
  if(target==="ml"){if(["ml","毫升"].includes(key))return{value:parsed,unit:"ml"};if(["l","升"].includes(key))return{value:parsed*1000n,unit:"ml"};}
  if(target==="count"&&["count","个","件"].includes(key))return{value:parsed,unit:"count"};
  return{value:null,unit:key};
}
function localDate(instant:string,timeZone:string):string{const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(instant)),part=(type:string)=>parts.find(item=>item.type===type)?.value??"";return`${part("year")}-${part("month")}-${part("day")}`;}
function addDays(value:string,days:number):string{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}

export function buildUseCycleStatus(cycle:UseCycleRaw,intakes:readonly UseCycleIntakeRaw[],asOf:string){
  const selected=new Map<string,UseCycleIntakeRaw>();
  for(const intake of intakes){const matches=cycle.match_mode==="exact_name"&&normalized(intake.name)===normalized(cycle.match_value??"")||cycle.match_mode==="food_ref"&&intake.food_ref_id===cycle.match_value;if(matches&&!selected.has(intake.id))selected.set(intake.id,intake);}
  let consumed=0n,matched=0,ignored=0;const incompatible=new Set<string>();
  if(cycle.quantity_unit)for(const intake of selected.values()){
    const normalizedQuantity=quantity(intake.quantity,intake.unit,intake.amount_g,cycle.quantity_unit);
    if(normalizedQuantity.value===null){ignored++;if(normalizedQuantity.unit)incompatible.add(normalizedQuantity.unit);continue;}
    const fraction=decimal(intake.consumed_fraction)??scale;consumed+=normalizedQuantity.value*fraction/scale;matched++;
  }
  const initial=decimal(cycle.initial_quantity),remaining=initial===null?null:(initial-consumed>0n?initial-consumed:0n),daily=decimal(cycle.expected_daily_usage);
  const today=localDate(asOf,cycle.time_zone),days=remaining!==null&&daily!==null&&daily>0n?Number((remaining+daily-1n)/daily):null,projected=days===null?null:addDays(today,days);
  const threshold=decimal(cycle.replenish_threshold),thresholdReached=remaining!==null&&threshold!==null&&remaining<=threshold;
  const leadReached=projected!==null&&cycle.replenish_lead_days!==null&&projected<=addDays(today,cycle.replenish_lead_days);
  let balanceStatus:"tracking_only"|"needs_specification"|"monitoring"|"replenish_now"|"depleted"|"completed"|"discarded"|"replenished";
  if(cycle.state!=="active")balanceStatus=cycle.state;
  else if(initial===null||cycle.quantity_unit===null)balanceStatus="needs_specification";
  else if(remaining===0n)balanceStatus="depleted";
  else if(!cycle.reminder_enabled)balanceStatus="tracking_only";
  else if(thresholdReached||leadReached)balanceStatus="replenish_now";
  else balanceStatus="monitoring";
  return{...cycle,consumed_quantity:cycle.quantity_unit?decimalText(consumed):null,remaining_quantity:remaining===null?null:decimalText(remaining),projected_depletion_on:projected,balance_status:balanceStatus,matched_intakes:matched,ignored_incompatible_intakes:ignored,incompatible_units:[...incompatible].sort()};
}

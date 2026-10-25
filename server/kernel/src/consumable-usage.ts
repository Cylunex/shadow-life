import { conflict } from "./errors.js";
export function quantityMicros(value:string):bigint {
  const [whole,fraction=""]=value.split(".");return BigInt(whole!)*1_000_000n+BigInt(fraction.padEnd(6,"0"));
}
export function assertConsumableUsage(cycle:{usage_state?:string|undefined;state:string;match_mode:string;started_on:string;ended_on?:string|undefined|null;initial_quantity?:string|undefined|null;quantity_unit?:string|undefined|null},usage:{quantity:string;first_on:string|null;last_on:string|null}){
  if(!usage.first_on)return;
  if(cycle.usage_state==="pending"||cycle.match_mode!=="none"||!cycle.quantity_unit)throw conflict("实际消耗需要已启用且有单位的手动使用周期，不能与饮食自动扣减混用");
  if(usage.first_on<cycle.started_on||cycle.ended_on&&usage.last_on!>cycle.ended_on)throw conflict("使用日期不在该周期内");
  if(cycle.initial_quantity&&quantityMicros(usage.quantity)>quantityMicros(cycle.initial_quantity))throw conflict("使用数量超过本批次总数量");
}

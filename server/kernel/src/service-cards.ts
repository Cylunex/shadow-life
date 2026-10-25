import { conflict } from "./errors.js";

export type ServiceCardFacts={total_units:number;started_on:string;expires_on:string|null;state:"active"|"closed"};
export type ServiceCardUsage={used_units:number;first_on:string|null;last_on:string|null};

/** Actual uses are the only source of the balance; closing/expiry never erases them. */
export function assertServiceCardUsage(card:ServiceCardFacts,usage:ServiceCardUsage):void{
  if(usage.used_units>card.total_units)throw conflict("使用次数超过次卡总次数，请核对总次数或已有使用记录");
  if(usage.first_on&&usage.first_on<card.started_on)throw conflict("使用日期早于次卡开始日期");
  if(usage.last_on&&card.expires_on&&usage.last_on>card.expires_on)throw conflict("使用日期超过次卡有效期");
}

export function assertServiceCardUseDate(card:ServiceCardFacts,occurredOn:string,today:string,isNew:boolean):void{
  if(isNew&&card.state!=="active")throw conflict("次卡已关闭；请先核对并重新开启");
  if(occurredOn>today)throw conflict("只能记录已发生的用卡，不能提前扣减未来次数");
}

export function serviceCardBalance(card:ServiceCardFacts,usedUnits:number,today:string){
  return{used_units:usedUnits,remaining_units:card.total_units-usedUnits,
    balance_status:card.state==="closed"?"closed":card.expires_on&&card.expires_on<today?"expired":usedUnits===card.total_units?"depleted":"active"};
}

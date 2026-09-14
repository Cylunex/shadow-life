import type { ConsumptionStatsResult } from "@shadow/contracts";

export type ConsumptionStatsFilters={months:1|3|6|12;scope:string;category:string;merchantRankBy:"orders"|"gross_spend"|"net_spend";itemRankBy:"purchased_orders"|"confirmed_consumptions"|"line_spend";currency:string};

export function consumptionStatsWindow(now:Date,months:number,timeZone:string):{fromOn:string;toOnExclusive:string}{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const year=Number(parts.find(part=>part.type==="year")?.value),month=Number(parts.find(part=>part.type==="month")?.value);
  const from=new Date(Date.UTC(year,month-months,1)),to=new Date(Date.UTC(year,month,1));
  return{fromOn:from.toISOString().slice(0,10),toOnExclusive:to.toISOString().slice(0,10)};
}

export async function loadConsumptionStats(fetcher:typeof fetch,headers:HeadersInit,filters:ConsumptionStatsFilters,timeZone:string,now=new Date()):Promise<ConsumptionStatsResult>{
  const window=consumptionStatsWindow(now,filters.months,timeZone),query=new URLSearchParams({from_on:window.fromOn,to_on_exclusive:window.toOnExclusive,time_zone:timeZone,merchant_rank_by:filters.merchantRankBy,item_rank_by:filters.itemRankBy,currency:filters.currency,limit:"20"});
  if(filters.scope)query.set("scopes",filters.scope);if(filters.category)query.set("categories",filters.category);
  const response=await fetcher(`/api/life/consumption-stats?${query}`,{headers});
  if(!response.ok)throw new Error(response.status===403?"当前账号没有查看这部分统计的权限":`消费统计读取失败（HTTP ${response.status}）`);
  return response.json() as Promise<ConsumptionStatsResult>;
}

export function coveragePercent(known:number,total:number):number{return total===0?100:Math.round(known/total*100);}

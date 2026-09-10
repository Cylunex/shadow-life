export type DashboardDomain="meals"|"money"|"health"|"travel"|"library";
export interface TodayDomainMetric{count?:number;entries?:number;facts?:number;visits?:number;captured?:number;freshness:string|null;totals?:unknown[];}
export interface TodayOverview{date:string;domains:Partial<Record<DashboardDomain,TodayDomainMetric>>;as_of:string;}
export interface TimelineItem{domain:DashboardDomain;kind:string;id:string;happened_at:string;title:string;amount?:string;currency?:string;record_id?:string;}
export interface DashboardLoad { data:Partial<Record<DashboardDomain,unknown[]>>; today?:TodayOverview; timeline?:{items:TimelineItem[];next_cursor:string|null;as_of:string}; errors:Partial<Record<DashboardDomain|"today"|"timeline",string>>; epochHeader:string; }

const domainCapabilities:Record<DashboardDomain,string>={meals:"life.list_meals",money:"money.records",health:"health.records",travel:"travel.records",library:"library.records"};
const domainEndpoints:Record<DashboardDomain,string>={meals:"/api/meals",money:"/api/money",health:"/api/health",travel:"/api/travel",library:"/api/library"};

export async function loadDashboard(fetcher:typeof fetch,headers:HeadersInit,options:{date?:string;timeZone?:string}={}):Promise<DashboardLoad>{
  const [epochResponse,capabilityResponse]=await Promise.all([fetcher("/api/write-epochs",{headers}),fetcher("/api/capabilities",{headers})]);
  if(!capabilityResponse.ok)throw new Error(capabilityResponse.status===401?"登录已失效，请重新登录。":`读取授权能力失败（HTTP ${capabilityResponse.status}）`);
  const capabilityBody=await capabilityResponse.json() as {capabilities?:Array<{name?:unknown}>},visible=new Set((capabilityBody.capabilities??[]).flatMap(item=>typeof item.name==="string"?[item.name]:[]));
  let epochHeader="";if(epochResponse.ok){const body=await epochResponse.json() as {items?:Array<{domain?:unknown;epoch?:unknown}>};epochHeader=(body.items??[]).filter((item):item is {domain:string;epoch:number}=>typeof item.domain==="string"&&Number.isSafeInteger(item.epoch)).map(item=>`${item.domain}=${item.epoch}`).join(",");}
  const data:Partial<Record<DashboardDomain,unknown[]>>={},errors:Partial<Record<DashboardDomain|"today"|"timeline",string>>={};
  await Promise.all((Object.keys(domainCapabilities) as DashboardDomain[]).filter(domain=>visible.has(domainCapabilities[domain])).map(async domain=>{try{const response=await fetcher(domainEndpoints[domain],{headers});if(!response.ok)throw new Error(response.status===401?"登录已失效，请重新登录。":`HTTP ${response.status}`);const body=await response.json() as {items?:unknown};if(!Array.isArray(body.items))throw new Error("响应格式无效");data[domain]=body.items;}catch(error){errors[domain]=error instanceof Error?error.message:"读取失败";}}));
  const date=options.date??new Intl.DateTimeFormat("en-CA").format(new Date()),timeZone=options.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
  let today:TodayOverview|undefined,timeline:DashboardLoad["timeline"];
  await Promise.all([
    visible.has("life.today")?(async()=>{try{const response=await fetcher(`/api/today?date=${encodeURIComponent(date)}&time_zone=${encodeURIComponent(timeZone)}`,{headers});if(!response.ok)throw new Error(`HTTP ${response.status}`);today=await response.json() as TodayOverview;}catch(error){errors.today=error instanceof Error?error.message:"读取失败";}})():Promise.resolve(),
    visible.has("life.timeline")?(async()=>{try{const response=await fetcher("/api/timeline?limit=30",{headers});if(!response.ok)throw new Error(`HTTP ${response.status}`);timeline=await response.json() as DashboardLoad["timeline"];}catch(error){errors.timeline=error instanceof Error?error.message:"读取失败";}})():Promise.resolve()
  ]);
  return{data,...(today?{today}:{}),...(timeline?{timeline}:{}),errors,epochHeader};
}

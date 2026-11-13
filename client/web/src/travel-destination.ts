import {destinationsResultSchema,type Destinations} from "@shadow/contracts";

export async function fetchDestinations(trip:string,headers:HeadersInit,on?:string,signal?:AbortSignal){
  const query=new URLSearchParams({trip_id:trip,...(on?{on}:{})});
  const response=await fetch(`/api/travel/destinations?${query}`,{headers,...(signal?{signal}:{})});
  if(!response.ok)throw new Error("目的地卡读取失败");
  return destinationsResultSchema.parse(await response.json());
}
const escape=(s:string)=>s.replace(/[&<>"']/gu,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function driverHtml(row:Destinations["items"][number]){
  return [row.local_name,row.name,row.address,row.entrance].filter((s,i,a):s is string=>!!s&&a.indexOf(s)===i).map(s=>`<p>${escape(s)}</p>`).join("");
}
export function offlineDriverCard(row:Destinations["items"][number],asOf:string){
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>目的地卡</title><style>body{margin:8vw;font:600 clamp(28px,7vw,64px)/1.35 system-ui;overflow-wrap:anywhere}footer{font:14px system-ui}</style><main>${driverHtml(row)}</main><footer>保存于 ${escape(asOf)}</footer></html>`;
}

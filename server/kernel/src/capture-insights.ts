export type CaptureInterval={id:string;kind:string;title:string;started_at:string;ended_at:string;app_package:string|null;behavior:string;life_domain:string;project_id:string|null};
export function calendarCaptureRange(date:string,period:string){const start=new Date(date+'T00:00:00Z');if(period==='week')start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);if(period==='month')start.setUTCDate(1);const from=start.toISOString().slice(0,10);if(period==='month')start.setUTCMonth(start.getUTCMonth()+1);else start.setUTCDate(start.getUTCDate()+(period==='week'?7:1));return{from_on:from,to_on_exclusive:start.toISOString().slice(0,10)};}
export function capturedUnionSeconds(items:Array<{started_at:string;ended_at:string}>){const intervals=items.map(r=>[Date.parse(r.started_at),Date.parse(r.ended_at)]).filter(v=>v[1]!>v[0]!).sort((a,b)=>a[0]!-b[0]!);let total=0,start=0,end=0;for(const [a,b] of intervals){if(a!>end){total+=end-start;start=a!;end=b!;}else end=Math.max(end,b!);}return Math.floor((total+end-start)/1000);}
export function summarizeCaptureIntervals(rows:CaptureInterval[]){
 const groups=new Map<string,CaptureInterval[]>(),apps=new Map<string,CaptureInterval[]>();
 for(const r of rows){const key=r.behavior+':'+r.life_domain;groups.set(key,[...(groups.get(key)??[]),r]);if(r.kind==='app_usage'&&r.app_package)apps.set(r.app_package,[...(apps.get(r.app_package)??[]),r]);}
 return {observed_seconds:capturedUnionSeconds(rows),app_usage_seconds:capturedUnionSeconds(rows.filter(r=>r.kind==='app_usage')),source_count:rows.length,groups:[...groups].map(([,values])=>({behavior:values[0]!.behavior,life_domain:values[0]!.life_domain,seconds:capturedUnionSeconds(values),count:values.length})),apps:[...apps].map(([package_name,values])=>({package_name,title:values[0]!.title,seconds:capturedUnionSeconds(values),intervals:values.length})).sort((a,b)=>b.seconds-a.seconds)};
}
export function classifyCapture(kind:string,appCategory:string|undefined,text:string|undefined){
 if(kind==='screen_text'&&/(订单号|交易单号|实付金额|订单编号)/u.test(text??''))return{behavior:'shopping',life_domain:'life',origin:'content_suggestion'};
 const byApp:Record<string,[string,string]>={productivity:['work','work'],news:['reading','growth'],social:['communication','relationships'],audio:['media','leisure'],video:['media','leisure'],game:['media','leisure'],maps:['travel','life']};
 const matched=appCategory?byApp[appCategory]:undefined;if(matched)return{behavior:matched[0],life_domain:matched[1],origin:'app_category'};
 return{behavior:'unknown',life_domain:'unknown',origin:'unknown'};
}

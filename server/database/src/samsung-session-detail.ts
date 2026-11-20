import { inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema.js";

type ObjectRow=Record<string,unknown>;
const object=(value:unknown):ObjectRow =>
  value!==null&&typeof value==="object"&&!Array.isArray(value)?value as ObjectRow:{};
const rows=(value:unknown):ObjectRow[]=>Array.isArray(value)?value.map(object):[];
const finite=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value);
function instant(value:unknown){
  if(typeof value!=="string"||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/u.test(value))return;
  const time=Date.parse(value);
  if(Number.isFinite(time))return new Date(time).toISOString();
}
function within(value:unknown,session:ObjectRow){
  const time=instant(value),start=instant(session.start_time),end=instant(session.end_time);
  if(time&&start&&end&&time>=start&&time<=end)return time;
}
// Keep both endpoints when thinning long recordings for a phone screen.
function plotSamples<T extends {at:string}>(points:T[],limit=1200){
  points.sort((a,b)=>a.at.localeCompare(b.at));
  if(points.length<=limit)return points;
  return Array.from({length:limit},(_,index)=>points[Math.round(index*(points.length-1)/(limit-1))]!);
}

function sessionFields(type:string,fields:ObjectRow){
  const sessions=rows(fields.sessions);
  if(type==="sleep"){
    const stages=sessions.flatMap(session=>rows(session.stages).flatMap(segment=>{
      const start=within(segment.start_time,session),end=within(segment.end_time,session);
      const stage=String(segment.stage).toLowerCase();
      return start&&end&&end>start&&["awake","rem","light","deep"].includes(stage)?[{start,end,stage}]:[];
    })).sort((a,b)=>a.start.localeCompare(b.start));
    const score=fields.sleep_score;
    return {
      ...(stages.length&&stages.length<=4096&&stages.every((row,i)=>i===0||row.start>=stages[i-1]!.end)?{stage_intervals:stages}:{}),
      ...(finite(score)&&Number.isInteger(score)&&score>=0&&score<=100?{provider_sleep_score:score}:{})
    };
  }
  // SamsungSync uses the first exercise session for the normalized workout's metrics.
  const session=sessions[0];
  if(!session)return {};
  const route=plotSamples(rows(session.route).flatMap(row=>{
    const at=within(row.timestamp,session),{latitude,longitude}=row;
    return at&&finite(latitude)&&Math.abs(latitude)<=90&&finite(longitude)&&Math.abs(longitude)<=180?[{at,latitude,longitude}]:[];
  }));
  type ExerciseSample={at:string;heart_rate?:number;speed_mps?:number};
  const readings=new Map<string,ExerciseSample>();
  for(const row of rows(session.log)){
    const at=within(row.timestamp,session);
    if(!at)continue;
    const sample=readings.get(at)??{at};
    if(finite(row.heart_rate)&&row.heart_rate>0)sample.heart_rate=row.heart_rate;
    if(finite(row.speed)&&row.speed>=0)sample.speed_mps=row.speed;
    if(sample.heart_rate!==undefined||sample.speed_mps!==undefined)readings.set(at,sample);
  }
  let samples=[...readings.values()];
  if(samples.length>1200){
    // Thin each series independently so sparse heart-rate or speed readings survive.
    const heart=samples.filter(p=>p.heart_rate!==undefined),speed=samples.filter(p=>p.speed_mps!==undefined);
    const heartLimit=Math.max(600,1200-speed.length),speedLimit=Math.max(600,1200-heart.length);
    samples=[...new Set([...plotSamples(heart,heartLimit),...plotSamples(speed,speedLimit)])];
  }
  samples.sort((a,b)=>a.at.localeCompare(b.at));
  return {...(route.length?{route_points:route}:{}),...(samples.length?{exercise_samples:samples}:{})};
}

export async function readSamsungSession(database:Pick<NodePgDatabase<typeof schema>,"execute">,subject:string,kind:string,fact:ObjectRow,raw:ObjectRow|null){
  if(raw?.source_type!=="samsung"||raw.current_version!==fact.raw_version||["deleted","quarantined","failed"].includes(String(raw.state)))return {};
  const type=kind==="sleep_session"?"sleep":kind==="workout_session"?"exercise":undefined;
  if(!type||raw.record_type!==(type==="sleep"?"sleep":"workout"))return {};
  const prefix=`samsung-${type}-`;
  if(typeof raw.client_record_id!=="string"||!raw.client_record_id.startsWith(prefix))return {};
  const uid=raw.client_record_id.slice(prefix.length);
  if(!uid)return {};
  const base=`samsung-archive-${type}-${uid}`;
  async function read(ids:string[]){
    const result=await database.execute<{id:string;payload:ObjectRow}>(sql`
      select r.client_record_id id,v.payload from health_raw_records r
      join health_raw_revisions v on v.raw_id=r.id and v.record_version=r.current_version
      where r.subject_id=${subject} and r.source_instance_id=${raw!.source_instance_id}
        and r.record_type='archive' and r.current_version=${fact.raw_version}
        and r.state in ('pending','normalized') and v.change_kind='upsert'
        and ${inArray(sql`r.client_record_id`,ids)}`);
    return new Map(result.rows.map(row=>[row.id,object(row.payload)]));
  }
  const first=await read([base,base+"-part-1"]);
  let payload=first.get(base);
  if(!payload){
    const head=first.get(base+"-part-1"),count=head?.chunk_count;
    // The SDK writer uses 300,000 base64 characters per part.
    if(!head||!finite(count)||!Number.isInteger(count)||count<1||count>64)return {};
    const ids=Array.from({length:count},(_,i)=>base+"-part-"+(i+1));
    const rest=count>1?await read(ids.slice(1)):new Map<string,ObjectRow>();
    const chunks:string[]=[];
    for(const [i,id] of ids.entries()){
      const part=i===0?head:rest.get(id);
      if(!part||part.archive_encoding!=="chunked-base64-json-utf8"||part.archive_identity!==uid||
        part.samsung_data_type!==type||part.chunk_index!==i||part.chunk_count!==count||
        typeof part.content!=="string"||part.content.length>300000||!part.content.length)return {};
      chunks.push(part.content);
    }
    try{payload=object(JSON.parse(Buffer.from(chunks.join(""),"base64").toString("utf8")));}catch{return {};}
  }
  if(payload.uid!==uid||payload.samsung_data_type!==type)return {};
  return sessionFields(type,object(payload.fields));
}

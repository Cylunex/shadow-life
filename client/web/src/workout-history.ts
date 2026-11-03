import type { SessionExercise } from "./workout-session.js";

/** Read completed facts only. Browsing a reference never changes the current draft. */
export async function previousExercise(headers:HeadersInit,exercise:SessionExercise["exercise"],signal:AbortSignal):Promise<string|undefined>{
  let cursor:string|undefined;
  const seen=new Set<string>();
  do{
    const params=new URLSearchParams({limit:"50"});
    if(cursor)params.set("cursor",cursor);
    const response=await fetch("/api/health?"+params,{headers,signal});
    if(!response.ok)throw new Error("上次表现暂时无法读取");
    const page=await response.json() as {items:Array<{kind:string;id:string}>;next_cursor:string|null};
    for(const item of page.items.filter(row=>row.kind==="workout_session")){
      const detail=await fetch("/api/health/records/"+encodeURIComponent(item.id),{headers,signal});
      if(!detail.ok)throw new Error("上次表现暂时无法读取");
      const {fact}=await detail.json() as {fact?:{effective:boolean;occurred_on:string;detail?:{strength_session?:{exercises?:Array<{exercise:{id:string;unit:string;equipment:string};sets:Array<{reps?:number;seconds?:number;load_kg?:string}>}>}}}};
      if(!fact?.effective)continue;
      const row=fact.detail?.strength_session?.exercises?.find(row=>row.exercise.id===exercise.id&&row.exercise.unit===exercise.unit&&row.exercise.equipment===exercise.equipment);
      if(!row)continue;
      const values=row.sets.flatMap(set=>{
        const value=set[exercise.unit];
        return value===undefined?[]:[(set.load_kg?set.load_kg+" kg / 只 × ":"")+value+(exercise.unit==="seconds"?" 秒":" 次")];
      });
      if(values.length)return fact.occurred_on+" · "+values.join("，");
    }
    cursor=page.next_cursor??undefined;
    if(cursor&&seen.has(cursor))throw new Error("训练分页未能继续");
    if(cursor)seen.add(cursor);
  }while(cursor);
  return undefined;
}

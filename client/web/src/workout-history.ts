import { exerciseHistoryResultSchema, type WorkoutExercise } from "@shadow/contracts";
import type { WorkoutSetDraft } from "./workout-session.js";

export type ExerciseHistory = {summary:string; sets:WorkoutSetDraft[]};

export async function previousExercise(headers:HeadersInit, exercise:WorkoutExercise, date:string, signal:AbortSignal):Promise<ExerciseHistory | undefined> {
  const {id, unit, equipment} = exercise;
  const params = new URLSearchParams({id, unit, equipment});
  const comparable:ReturnType<typeof exerciseHistoryResultSchema.parse>["sessions"]=[];
  const seen=new Set<string>();
  while(comparable.length<3){
    const response=await fetch(`/api/health/exercise-history?${params}`,{headers,signal});
    if(!response.ok)throw new Error("动作历史暂时无法读取");
    const {sessions}=exerciseHistoryResultSchema.parse(await response.json());
    for(const session of sessions){
      if(seen.has(session.record_id))throw new Error("动作历史分页未向前推进");
      seen.add(session.record_id);
      if(session.occurred_on<=date)comparable.push(session);
      if(comparable.length===3)break;
    }
    if(sessions.length<3 || comparable.length===3)break;
    params.set("before_session_id",sessions.at(-1)!.record_id);
  }
  const latest = comparable[0];
  if (!latest) return;
  const summary = comparable.map(session => {
    const sets = session.sets.map(set => {
      if(set[unit]===undefined || (equipment==="bodyweight" && set.load_kg!==undefined)){
        throw new Error("动作历史的单位或器械不匹配");
      }
      const load = set.load_kg ? `${set.load_kg} kg / 只 × ` : "";
      return `${load}${set[unit]}${unit === "seconds" ? " 秒" : " 次"}`;
    });
    return `${session.occurred_on} · ${sets.join("，")}`;
  }).join("；");
  return {summary, sets:latest.sets.map(set => ({
    value:String(set[unit]), load:set.load_kg ?? "", completed:false,
  }))};
}

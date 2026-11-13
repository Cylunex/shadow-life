import { exerciseHistoryResultSchema, type WorkoutExercise } from "@shadow/contracts";

export async function previousExercise(headers:HeadersInit, exercise:WorkoutExercise, signal:AbortSignal):Promise<string | undefined> {
  const {id, unit, equipment} = exercise;
  const params = new URLSearchParams({id, unit, equipment});
  const response = await fetch(`/api/health/exercise-history?${params}`, {headers, signal});
  if (!response.ok) throw new Error("动作历史暂时无法读取");
  const {sessions} = exerciseHistoryResultSchema.parse(await response.json());
  return sessions.map(session => {
    const sets = session.sets.map(set => {
      const load = set.load_kg ? `${set.load_kg} kg / 只 × ` : "";
      return `${load}${set[unit]}${unit === "seconds" ? " 秒" : " 次"}`;
    });
    return `${session.occurred_on} · ${sets.join("，")}`;
  }).join("；") || undefined;
}

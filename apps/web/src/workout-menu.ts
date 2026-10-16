import { domainRecordsResultSchema, homeWorkoutMenu, recordWorkoutInputSchema, setHealthPlanInputSchema, strengthSessionSchema, workoutMenuSchema, type DomainRecordSummary, type WorkoutExercise, type WorkoutFocus, type WorkoutMenu } from "@shadow/contracts";

export type MenuPlan = DomainRecordSummary & { workout_plan: {schedule: unknown; detail: unknown} };
export async function loadMenuPlans(fetcher: typeof fetch, headers: HeadersInit, signal?: AbortSignal): Promise<MenuPlan[]> {
  const plans: MenuPlan[] = [], cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({q:"workout_plan",limit:"100",...(cursor?{cursor}:{})});
    const response = await fetcher(`/api/health?${query}`, {headers,...(signal?{signal}:{})});
    if(!response.ok)throw new Error(`训练计划读取失败（${response.status}）`);
    const page = domainRecordsResultSchema.parse(await response.json());
    plans.push(...page.items.filter((item): item is MenuPlan => item.kind==="workout_plan" && item.state==="active" && !!item.workout_plan));
    cursor=page.next_cursor??undefined;
    if(cursor){if(cursors.has(cursor)||cursors.size>=100)throw new Error("训练计划分页异常，请重试");cursors.add(cursor);}
  } while(cursor);
  return plans;
}
export function menuForPlan(plan?: MenuPlan): WorkoutMenu {
  const parsed=workoutMenuSchema.safeParse(objectValue(plan?.workout_plan.detail).workout_menu);
  return parsed.success?parsed.data:structuredClone(homeWorkoutMenu);
}
export function buildMenuPlan(menu: WorkoutMenu, name: string, plan?: MenuPlan) {
  return setHealthPlanInputSchema.parse({kind:"workout",name,state:"active",...(plan?{plan_id:plan.id,expected_revision:plan.revision}:{}),
    schedule:{...preserveLegacy(plan?.workout_plan.schedule,"legacy_schedule"),days:menu.days.map(day=>day.weekday)},
    detail:{...preserveLegacy(plan?.workout_plan.detail,"legacy_detail"),workout_menu:workoutMenuSchema.parse(menu)}});
}
export type ActualExerciseDraft = {exercise:WorkoutExercise; values:string; load:string};
export function buildStrengthWorkout(drafts: ActualExerciseDraft[], focus:WorkoutFocus, date:string, timeZone:string, planId?:string) {
  // Only populated rows are actual execution. Selection alone never records a set.
  const exercises=drafts.filter(row=>row.values.trim()).map(row=>({exercise:row.exercise,sets:row.values.split(/[,，\s]+/u).filter(Boolean).map(value=>({
    [row.exercise.unit]: Number(value), ...(row.exercise.equipment==="dumbbell"&&row.load.trim()?{load_kg:row.load.trim()}:{}),
  }))}));
  const strength=strengthSessionSchema.parse({version:1,focus,exercises});
  return recordWorkoutInputSchema.parse({occurred_on:date,time_zone:timeZone,session_type:"strength_training",...(planId?{plan_id:planId}:{}),detail:{strength_session:strength}});
}
function objectValue(value:unknown):Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}

function preserveLegacy(value:unknown,key:string):Record<string,unknown>{if(value===undefined||value===null)return{};return typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{[key]:value};}

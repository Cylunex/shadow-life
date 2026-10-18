import { recordWorkoutInputSchema, workoutExerciseSchema, workoutFocusLabels, type WorkoutExercise, type WorkoutFocus } from "@shadow/contracts";
import type { MenuPlan } from "./workout-menu.js";

export type WorkoutSetDraft={value:string;load:string;completed:boolean};
export type SessionExercise={exercise:WorkoutExercise;sets:WorkoutSetDraft[]};
export type WorkoutDraft={version:1;date:string;timeZone:string;focus:WorkoutFocus;planId:string;started:boolean;exercises:SessionExercise[];restUntil:number};
export const blankSet=(load=""):WorkoutSetDraft=>({value:"",load,completed:false});
export const emptyWorkout=(date:string,timeZone:string,focus:WorkoutFocus="chest",planId=""):WorkoutDraft=>({version:1,date,timeZone,focus,planId,started:false,exercises:[],restUntil:0});
export function validWorkoutSet(set:WorkoutSetDraft,exercise:WorkoutExercise):boolean {
  return /^\d+$/u.test(set.value)&&Number(set.value)>0&&Number(set.value)<=(exercise.unit==="reps"?1000:7200)&&
    (exercise.equipment!=="dumbbell"||!set.load.trim()||/^(?:0|[1-9]\d{0,2})(?:\.\d{1,3})?$/u.test(set.load.trim()));
}
export function completedSetCount(draft:WorkoutDraft):number{return draft.exercises.reduce((sum,row)=>sum+row.sets.filter(set=>set.completed).length,0);}
export function buildSessionWorkout(draft:WorkoutDraft){
  const exercises=draft.exercises.flatMap(row=>{
    const sets=row.sets.filter(set=>set.completed).map(set=>{
      if(!validWorkoutSet(set,row.exercise))throw new Error(`请检查${row.exercise.name}的实际次数或重量`);
      return{[row.exercise.unit]:Number(set.value),...(row.exercise.equipment==="dumbbell"&&set.load.trim()?{load_kg:set.load.trim()}:{})};
    });
    return sets.length?[{exercise:row.exercise,sets}]:[];
  });
  return recordWorkoutInputSchema.parse({occurred_on:draft.date,time_zone:draft.timeZone,session_type:"strength_training",...(draft.planId?{plan_id:draft.planId}:{}),detail:{strength_session:{version:1,focus:draft.focus,exercises}}});
}
export function planWeekdays(plan:MenuPlan):number[]{
  const schedule=plan.workout_plan.schedule as {days?:unknown}|null;
  return Array.isArray(schedule?.days)?[...new Set(schedule.days.filter((day):day is number=>Number.isInteger(day)&&day>=1&&day<=7))]:[];
}
export function suggestedPlan(plans:MenuPlan[],date:string):MenuPlan|undefined{
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()||7;
  return plans.find(plan=>planWeekdays(plan).includes(weekday))??plans[0];
}
export function restSeconds(deadline:number,now:number):number{return Math.max(0,Math.ceil((deadline-now)/1000));}
export function workoutDraftKey(identityKey:string):string{return `life:training-session:v1:${identityKey}`;}
export function readWorkoutDraft(storage:Pick<Storage,"getItem">,key:string):WorkoutDraft|null{
  try{
    const raw=storage.getItem(key);if(!raw||raw.length>250_000)return null;
    const draft=JSON.parse(raw) as WorkoutDraft;
    if(draft.version!==1||!/^\d{4}-\d{2}-\d{2}$/u.test(draft.date)||!Number.isFinite(Date.parse(`${draft.date}T12:00:00Z`))||!(draft.focus in workoutFocusLabels)||typeof draft.planId!=="string"||typeof draft.started!=="boolean"||!Number.isFinite(draft.restUntil)||!Array.isArray(draft.exercises)||draft.exercises.length>30)return null;
    new Intl.DateTimeFormat("en",{timeZone:draft.timeZone});
    const ids=new Set<string>();
    for(const row of draft.exercises){
      row.exercise=workoutExerciseSchema.parse(row.exercise);
      if(ids.has(row.exercise.id)||!Array.isArray(row.sets)||row.sets.length<1||row.sets.length>30)return null;
      ids.add(row.exercise.id);
      if(row.sets.some(set=>typeof set.value!=="string"||typeof set.load!=="string"||typeof set.completed!=="boolean"||(set.completed&&!validWorkoutSet(set,row.exercise))))return null;
    }
    return draft;
  }catch{return null;}
}

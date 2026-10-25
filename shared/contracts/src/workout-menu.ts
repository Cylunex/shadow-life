import { z } from "zod";

export const workoutFocusSchema = z.enum(["chest", "core", "back_shoulders", "arms", "legs"]);
export type WorkoutFocus = z.infer<typeof workoutFocusSchema>;
export const workoutFocusLabels: Record<WorkoutFocus, string> = { chest: "胸", core: "腰腹", back_shoulders: "背肩", arms: "胳膊", legs: "腿" };
export const workoutDifficultyLabels = { easy: "入门", moderate: "进阶", challenging: "挑战" } as const;
export const workoutExerciseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/u), name: z.string().trim().min(1).max(100),
  focus: workoutFocusSchema, equipment: z.enum(["bodyweight", "dumbbell"]),
  difficulty: z.enum(["easy", "moderate", "challenging"]), unit: z.enum(["reps", "seconds"]),
  guidance: z.string().min(1).max(500), caution: z.string().min(1).max(500),
  source_url: z.url().regex(/^https:\/\//u),
}).strict();
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export const workoutMenuSchema = z.object({
  version: z.literal(1), priorities: z.array(workoutFocusSchema).length(5),
  days: z.array(z.object({ weekday: z.number().int().min(1).max(7), focus: workoutFocusSchema, secondary: z.array(workoutFocusSchema).max(4) }).strict()).min(1).max(7),
  exercises: z.array(workoutExerciseSchema).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.priorities).size !== 5) ctx.addIssue({code:"custom",path:["priorities"],message:"priorities must include each focus exactly once"});
  if (new Set(value.days.map(day=>day.weekday)).size !== value.days.length) ctx.addIssue({code:"custom",path:["days"],message:"weekday must be unique"});
  if (new Set(value.exercises.map(item=>item.id)).size !== value.exercises.length) ctx.addIssue({code:"custom",path:["exercises"],message:"exercise IDs must be unique"});
  value.days.forEach((day, index)=>{if(new Set([day.focus,...day.secondary]).size!==day.secondary.length+1)ctx.addIssue({code:"custom",path:["days",index],message:"daily focuses must be distinct"});});
});
export type WorkoutMenu = z.infer<typeof workoutMenuSchema>;
const actualSetSchema = z.object({
  reps: z.number().int().min(1).max(1000).optional(), seconds: z.number().int().min(1).max(7200).optional(),
  load_kg: z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,3})?$/u).optional(),
}).strict().refine(value=>(value.reps===undefined)!==(value.seconds===undefined),"each actual set needs reps or seconds, not both");
export const strengthSessionSchema = z.object({
  version: z.literal(1), focus: workoutFocusSchema,
  exercises: z.array(z.object({ exercise: workoutExerciseSchema, sets: z.array(actualSetSchema).min(1).max(30) }).strict()).min(1).max(30),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.exercises.map(item=>item.exercise.id)).size!==value.exercises.length)ctx.addIssue({code:"custom",message:"actual exercise IDs must be unique"});
  value.exercises.forEach((item,index)=>item.sets.forEach((set,setIndex)=>{
    if((item.exercise.unit==="reps"&&set.reps===undefined)||(item.exercise.unit==="seconds"&&set.seconds===undefined))ctx.addIssue({code:"custom",path:["exercises",index,"sets",setIndex],message:"set unit must match exercise"});
    if(item.exercise.equipment==="bodyweight"&&set.load_kg!==undefined)ctx.addIssue({code:"custom",path:["exercises",index,"sets",setIndex],message:"bodyweight exercise has no dumbbell load"});
  }));
});
export type StrengthSession = z.infer<typeof strengthSessionSchema>;

// The plan and actual execution use existing JSON detail fields. Legacy free-form detail stays valid.
export function validateWorkoutDetail(detail: unknown, kind: "plan" | "actual", ctx: z.RefinementCtx) {
  if(!detail || typeof detail!=="object" || Array.isArray(detail)) return;
  const object=detail as Record<string,unknown>;
  for(const [key, schema] of [["workout_menu",workoutMenuSchema],["strength_session",strengthSessionSchema]] as const) {
    if(!(key in object))continue;
    if((kind==="plan")!==(key==="workout_menu")) {ctx.addIssue({code:"custom",path:["detail",key],message:"menu belongs to plan; strength_session belongs to actual execution"});continue;}
    const result=schema.safeParse(object[key]);
    if(!result.success)for(const issue of result.error.issues)ctx.addIssue({code:"custom",path:["detail",key,...issue.path],message:issue.message});
  }
}

export function workoutThemeForDate(menu:WorkoutMenu,date:string):WorkoutFocus {
  const weekday=new Date(`${date}T00:00:00Z`).getUTCDay()||7;
  return menu.days.find(day=>day.weekday===weekday)?.focus??menu.priorities[0]!;
}

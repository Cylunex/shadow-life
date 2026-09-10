import type { WriteCapabilityName } from "@shadow/contracts";

export interface WorkoutFields{planId:string;sessionType:string;occurredOn:string;timeZone:string;durationMinutes:string;distanceKm:string;caloriesKcal:string;rpe:string;heartRateAvg:string;note:string;}
export interface WorkoutCommand{capability:WriteCapabilityName;input:unknown;}
export function initialWorkoutFields(date:string,timeZone:string):WorkoutFields{return{planId:"",sessionType:"run",occurredOn:date,timeZone,durationMinutes:"",distanceKm:"",caloriesKcal:"",rpe:"",heartRateAvg:"",note:""};}
export function buildWorkoutCommand(fields:WorkoutFields):WorkoutCommand{return{capability:"health.record_workout",input:{...(fields.planId?{plan_id:fields.planId}:{}),session_type:fields.sessionType.trim(),occurred_on:fields.occurredOn,time_zone:fields.timeZone,...integerField("duration_minutes",fields.durationMinutes),...decimalField("distance_km",fields.distanceKm),...decimalField("calories_kcal",fields.caloriesKcal),...integerField("rpe",fields.rpe),...integerField("heart_rate_avg",fields.heartRateAvg),...(fields.note.trim()?{detail:{note:fields.note.trim()}}:{})}};}
function integerField(key:string,value:string):Record<string,number>{return value.trim()?{[key]:Number(value)}:{};}
function decimalField(key:string,value:string):Record<string,string>{return value.trim()?{[key]:value.trim()}:{};}

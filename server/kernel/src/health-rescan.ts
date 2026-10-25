import { healthDailyActivityPayloadSchema,healthObservationPayloadSchema,healthSleepPayloadSchema,healthWorkoutPayloadSchema,healthWellbeingPayloadSchema,healthHabitPayloadSchema } from "@shadow/contracts";

export type HealthCoverage={start:string;end:string}|{date:string;timeZone:string};
// Exact containment is required before absence can invalidate a prior fact. Unknown payloads
// fail the complete scan instead of silently claiming synchronization or guessing their dates.
export function healthRescanCoverage(type:string,payload:unknown):HealthCoverage{
  if(["body","lab","fitness_test"].includes(type)){const p=healthObservationPayloadSchema.parse(payload);return p.occurred_at?{start:p.occurred_at,end:p.occurred_at}:{date:p.occurred_on,timeZone:p.time_zone};}
  if(type==="daily_activity"||type==="steps_interval"){const p=healthDailyActivityPayloadSchema.parse(payload);if(type==="steps_interval"&&!p.step_interval)throw new Error("step interval coverage is unknown");return p.step_interval?{start:p.step_interval.started_at,end:p.step_interval.ended_at}:{date:p.occurred_on,timeZone:p.time_zone};}
  if(type==="sleep"){const p=healthSleepPayloadSchema.parse(payload);if(!p.started_at||!p.ended_at)throw new Error("sleep coverage is unknown");return{start:p.started_at,end:p.ended_at};}
  if(type==="workout"){const p=healthWorkoutPayloadSchema.parse(payload);if(!p.started_at||p.duration_minutes==null)throw new Error("workout coverage is unknown");return{start:p.started_at,end:new Date(Date.parse(p.started_at)+p.duration_minutes*60_000).toISOString()};}
  if(type==="wellbeing"){const p=healthWellbeingPayloadSchema.parse(payload);return{date:p.occurred_on,timeZone:p.time_zone};}
  if(type==="habit"){const p=healthHabitPayloadSchema.parse(payload);return{date:p.occurred_on,timeZone:p.time_zone};}
  throw new Error("health record coverage is unknown");
}

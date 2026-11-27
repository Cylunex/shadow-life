import assert from "node:assert/strict";
import test from "node:test";
import { buildSleepInsights, type SleepInsightNight } from "../src/sleep-insights.js";

const night=(date:string,start:string|null,minutes=450):SleepInsightNight=>({wake_date:date,time_zone:"Asia/Shanghai",started_at:start,ended_at:start?new Date(Date.parse(start)+480*60_000).toISOString():null,total_minutes:minutes,deep_minutes:90,rem_minutes:90,source_type:"health_connect"});

test("sleep bedtime averages across midnight and separates missing clock evidence",()=>{
  const result=buildSleepInsights([
    night("2026-09-21","2026-09-20T15:30:00Z"),
    night("2026-09-22","2026-09-21T16:00:00Z"),
    night("2026-09-23","2026-09-22T16:30:00Z"),
    night("2026-09-24",null)
  ],"2026-08-26","2026-09-24");
  assert.equal(result.nights,4);
  assert.equal(result.bedtime_nights,3);
  assert.equal(result.average_bedtime,"00:00");
  assert.equal(result.bedtime_variation_minutes,24);
  assert.equal(result.average_efficiency_percent,94);
  assert.equal(result.efficiency_nights,3);
});

test("sleep insights do not infer regularity from two timed nights",()=>{
  const result=buildSleepInsights([night("2026-09-23","2026-09-22T15:30:00Z"),night("2026-09-24",null)],"2026-09-18","2026-09-24");
  assert.equal(result.average_bedtime,null);
  assert.equal(result.bedtime_variation_minutes,null);
  assert.equal(result.at_least_seven_hours,2);
});

test("Samsung target and efficiency use documented sleep stages and skip missing stages",()=>{
  const row={...night("2026-11-27","2026-11-26T15:15:00Z",440),ended_at:"2026-11-26T22:35:00Z",source_type:"samsung",deep_minutes:63,light_minutes:220,rem_minutes:105};
  const result=buildSleepInsights([row,{...row,light_minutes:null}],"2026-11-26","2026-11-27");
  assert.equal(result.nights,1);
  assert.equal(result.average_minutes,388);
  assert.equal(result.at_least_seven_hours,0);
  assert.equal(result.average_efficiency_percent,88);
});

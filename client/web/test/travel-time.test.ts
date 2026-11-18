import assert from "node:assert/strict";
import test from "node:test";
import { editableTime, parseEditableTime, formatInTimeZone, parseInTimeZone } from "../src/travel-time.js";

test("travel wall time round-trips in the trip time zone",()=>{
  for(const [instant,zone] of [["2026-09-11T00:00:00.000Z","Asia/Seoul"],["2026-09-11T01:30:00.000Z","Asia/Shanghai"],["2026-11-01T07:30:00.000Z","America/Denver"]] as const){
    const local=formatInTimeZone(instant,zone);
    assert.equal(formatInTimeZone(parseInTimeZone(local,zone),zone),local);
  }
});

test("travel wall time rejects the skipped daylight-saving hour",()=>{
  assert.throws(()=>parseInTimeZone("2026-03-08T02:30","America/New_York"),/不是有效/u);
});

test("editable intervals preserve query-zone time, explicit offsets and repeated hours",()=>{
  const zone="Asia/Shanghai";
  assert.equal(editableTime("2026-11-13T01:00:27.125Z",zone),"2026-11-13T09:00:27.125");
  for(const value of ["2026-11-13T09:00","2026-11-13T09:00:00+08:00","2026-11-13T01:00:00Z"])
    assert.equal(parseEditableTime(value,zone),"2026-11-13T01:00:00.000Z");
  assert.equal(parseEditableTime("2026-11-13T09:00:27.125",zone),"2026-11-13T01:00:27.125Z");
  const later="2026-11-01T06:30:00Z";
  assert.equal(parseEditableTime("2026-11-01T01:30","America/New_York",later),later);
});

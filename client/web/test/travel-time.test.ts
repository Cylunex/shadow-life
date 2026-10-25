import assert from "node:assert/strict";
import test from "node:test";
import { formatInTimeZone, parseInTimeZone } from "../src/travel-time.js";

test("travel wall time round-trips in the trip time zone",()=>{
  for(const [instant,zone] of [["2026-09-11T00:00:00.000Z","Asia/Seoul"],["2026-09-11T01:30:00.000Z","Asia/Shanghai"],["2026-11-01T07:30:00.000Z","America/Denver"]] as const){
    const local=formatInTimeZone(instant,zone);
    assert.equal(formatInTimeZone(parseInTimeZone(local,zone),zone),local);
  }
});

test("travel wall time rejects the skipped daylight-saving hour",()=>{
  assert.throws(()=>parseInTimeZone("2026-03-08T02:30","America/New_York"),/不是有效/u);
});

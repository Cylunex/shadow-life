import assert from "node:assert/strict";
import test from "node:test";
import {sampleTrack,wgs84ToGcj02} from "../src/travel-coordinates.js";

test("mainland WGS-84 coordinates are converted for AMap presentation",()=>{
  const converted=wgs84ToGcj02({latitude:39.908823,longitude:116.39747});
  assert.ok(Math.abs(converted.latitude-39.910226)<0.00001);
  assert.ok(Math.abs(converted.longitude-116.403714)<0.00001);
});

test("coordinates outside mainland China remain portable WGS-84",()=>{
  const point={latitude:35.681236,longitude:139.767125};
  assert.deepEqual(wgs84ToGcj02(point),point);
});

test("long GPX tracks keep both endpoints while bounding map overlays",()=>{
  const points=Array.from({length:10_000},(_,index)=>index),sampled=sampleTrack(points);
  assert.equal(sampled.length,1_200);assert.equal(sampled[0],0);assert.equal(sampled.at(-1),9_999);
});

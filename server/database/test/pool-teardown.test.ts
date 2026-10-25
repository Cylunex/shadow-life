import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { Pool } from "pg";
import { trackPoolShutdown } from "./pool-teardown.js";

test("database teardown waits for every socket even when pool.end resolves first",async()=>{
  class EarlyEndingPool extends EventEmitter{async end(){}}
  const pool=new EarlyEndingPool(),close=trackPoolShutdown(pool as unknown as Pool);
  const first={},second={},expired={};
  pool.emit("connect",expired);pool.emit("remove",expired);
  pool.emit("connect",first);pool.emit("connect",second);
  let readyToDrop=false;
  const closing=close().then(()=>{readyToDrop=true;});
  await setImmediate();assert.equal(readyToDrop,false);
  pool.emit("remove",first);
  await setImmediate();assert.equal(readyToDrop,false);
  pool.emit("remove",second);
  await closing;assert.equal(readyToDrop,true);
  assert.equal(pool.listenerCount("connect"),0);assert.equal(pool.listenerCount("remove"),0);
  const unused=new EarlyEndingPool();
  await trackPoolShutdown(unused as unknown as Pool)();
});

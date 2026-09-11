import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionResult } from "@shadow/contracts";
import { CommandController } from "../src/command-controller.js";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const result = (commandId: string): ExecutionResult => ({ protocol: "shadow.execution-result", capability: "money.record_entry", command_id: commandId, execution_id: "execution_12345678", status: "committed", result_kind: "record", resources: [{ type: "money_entry", id: "money_entry_12345678", revision: 1 }], actual_values: {}, warnings: [], replayed: false });

test("persists a command and a fresh controller can recover its committed receipt", async () => {
  const storage = new MemoryStorage();
  let posts = 0;
  let saved:ExecutionResult|undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    if(init?.method!=="POST")return Response.json(saved);
    posts += 1;
    const body = JSON.parse(String(init?.body)) as { command_id: string };
    saved=result(body.command_id);
    return Response.json(saved, { status: 201 });
  }) as typeof fetch;
  const controller = new CommandController(fetcher, () => ({ authorization: "Bearer test" }), storage, "test");
  const input = { amount: "12.00" };
  const first = await controller.execute("money.record_entry", input, "quick-money");
  const refreshed = new CommandController(fetcher, () => ({ authorization: "Bearer test" }), storage, "test");
  const second = await refreshed.execute("money.record_entry", input, "quick-money");
  assert.equal(posts, 1);
  assert.equal(second.command_id, first.command_id);
  assert.match(String(storage.values.keys().next().value),/quick-money/);
});

test("coalesces an in-flight click but treats a later successful click as a new intent", async()=>{
  const storage=new MemoryStorage();let posts=0;
  const fetcher=(async(_input:string|URL|Request,init?:RequestInit)=>{posts+=1;const body=JSON.parse(String(init?.body)) as {command_id:string};await Promise.resolve();return Response.json(result(body.command_id),{status:201});}) as typeof fetch;
  const controller=new CommandController(fetcher,()=>({}),storage,"test");
  const one=controller.execute("money.record_entry",{amount:"12.00"},"quick-money"),same=controller.execute("money.record_entry",{amount:"12.00"},"quick-money");
  assert.equal((await one).command_id,(await same).command_id);assert.equal(posts,1);
  const next=await controller.execute("money.record_entry",{amount:"12.00"},"quick-money");
  assert.notEqual(next.command_id,(await one).command_id);assert.equal(posts,2);
});

test("queries the original command after an unknown outcome", async () => {
  const storage = new MemoryStorage();
  let postCommand = "";
  let calls = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (init?.method === "POST") {
      postCommand = (JSON.parse(String(init.body)) as { command_id: string }).command_id;
      throw new TypeError("disconnected");
    }
    assert.match(String(input), new RegExp(postCommand));
    return Response.json(result(postCommand));
  }) as typeof fetch;
  const controller = new CommandController(fetcher, () => ({}), storage, "test");
  await assert.rejects(controller.execute("money.record_entry", { amount: "12.00" }, "quick-money"), /结果尚未确认/);
  const recovered = await controller.execute("money.record_entry", { amount: "12.00" }, "quick-money");
  assert.equal(recovered.command_id, postCommand);
  assert.equal(calls, 2);
});

test("does not replace an unresolved command when the draft changed", async () => {
  const storage = new MemoryStorage();
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") throw new TypeError("disconnected");
    throw new TypeError("still offline");
  }) as typeof fetch;
  const controller = new CommandController(fetcher, () => ({}), storage, "test");
  await assert.rejects(controller.execute("money.record_entry", { amount: "12.00" }, "quick-money"));
  await assert.rejects(controller.execute("money.record_entry", { amount: "13.00" }, "quick-money"), /上一笔操作的结果仍未知/);
});

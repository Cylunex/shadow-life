import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildCapabilityHttpRequest, type CapabilityName } from "@shadow/contracts";

test("shipped agent examples use real current contracts and keep gifts out of intake", async () => {
  const examples = JSON.parse(await readFile(new URL("../../../skills/life-operator/references/examples.json", import.meta.url), "utf8")) as { scenario: string; capability: CapabilityName; arguments: unknown }[];
  for (const example of examples) assert.doesNotThrow(() => buildCapabilityHttpRequest("https://life.example.com", example.capability, example.arguments), example.scenario);
  const dining = examples.find(example => example.capability === "life.record_dining")!;
  const envelope = JSON.parse(buildCapabilityHttpRequest("https://life.example.com", dining.capability, dining.arguments).body!);
  assert.equal(envelope.input.sources.length, 2);
  assert.equal(envelope.input.consumed_items.length, 1); assert.equal(envelope.input.purchased_items.length, 2);
  assert.equal(envelope.input.payment.amount, "18.00");
});

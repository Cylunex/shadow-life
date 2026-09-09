import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { capabilityRegistry } from "../src/registry.js";

const output = resolve(import.meta.dirname, "../generated");
await mkdir(output, { recursive: true });
const registry = Object.fromEntries(Object.values(capabilityRegistry).map((capability) => [capability.name, {
  name: capability.name,
  description: capability.description,
  possible_effects: capability.possibleEffects,
  idempotency: capability.idempotency,
  status_query: capability.statusQuery,
  input_schema: z.toJSONSchema(capability.inputSchema),
  command_schema: z.toJSONSchema(capability.commandSchema),
  result_schema: z.toJSONSchema(capability.resultSchema)
}]));
const target = resolve(output, "capabilities.json");
const content = `${JSON.stringify({ capabilities: registry }, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== content) { console.error("Generated capability registry is stale. Run pnpm --filter @shadow/contracts generate."); process.exit(1); }
} else {
  await writeFile(target, content);
}

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { agentCatalogSnapshotSchema, diffAgentCatalogs } from "../shared/contracts/src/index.js";

const [before, after = "shared/contracts/generated/agent-catalog.json"] = process.argv.slice(2);
if (!before) { console.error("Usage: pnpm catalog:diff <previous-catalog.json> [current-catalog.json]"); process.exit(64); }
async function readSnapshot(path: string) {
  if ((await stat(resolve(path))).size > 10 * 1024 * 1024) throw new Error("Catalog snapshot is too large.");
  return agentCatalogSnapshotSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
}
console.log(JSON.stringify(diffAgentCatalogs(await readSnapshot(before), await readSnapshot(after)), null, 2));

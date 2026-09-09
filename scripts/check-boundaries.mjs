import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const violations = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "generated"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:ts|tsx|js|mjs|kt|sql|md|json)$/u.test(entry.name)) {
      const text = await readFile(path, "utf8");
      const relative = path.slice(root.length + 1);
      const internalLegacyArtifact=relative.startsWith("packages/database/migrations/")||relative==="packages/database/src/schema.ts"||relative.startsWith("packages/database/test/");
      const publicVersionMarker=!internalLegacyArtifact&&/\/api\/v\d+\b|shadow\.[a-z0-9_.-]+\.v\d+\b|capability_version/u.test(text);
      if (relative !== "scripts/check-boundaries.mjs" && publicVersionMarker) violations.push(`${relative}: public contracts use one current version`);
      if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
        if (relative.startsWith("packages/contracts/") && /from ["'](?:@shadow\/(?:kernel|database|agent-adapter)|hono|drizzle-orm|pg)["']/u.test(text)) violations.push(`${relative}: contracts must stay independent`);
        if (relative.startsWith("packages/kernel/") && /from ["'](?:@shadow\/database|hono|drizzle-orm|pg|pg-boss|react)["']/u.test(text)) violations.push(`${relative}: kernel imported an adapter or framework`);
        if (relative.startsWith("apps/cli/") && /from ["'](?:@shadow\/database|drizzle-orm|pg)["']/u.test(text)) violations.push(`${relative}: CLI must use the API`);
      }
    }
  }
}
await scan(root);
if (violations.length > 0) { console.error(violations.join("\n")); process.exit(1); }
console.log("Dependency boundaries are valid.");

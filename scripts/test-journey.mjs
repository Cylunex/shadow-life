import { spawnSync } from "node:child_process";

const journey = process.argv.at(-1);
if (journey !== "meal" && journey !== "health-ledger") { console.error("Available journeys: meal, health-ledger"); process.exit(64); }
if (process.env.TEST_DATABASE_URL === undefined) { console.error("TEST_DATABASE_URL is required for the real PostgreSQL Health/Ledger journey."); process.exit(78); }
const result = spawnSync("pnpm", ["--filter", "@shadow/database", "test"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);

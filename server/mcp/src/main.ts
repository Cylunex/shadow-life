import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { delimiter, isAbsolute, resolve } from "node:path";
import { agentScenarioNameSchema, assertCompleteQueryTransport } from "@shadow/contracts";
import { LifeClient } from "./client.js";
import { createMcpServer } from "./server.js";

assertCompleteQueryTransport();
const profile = process.env.SHADOW_MCP_PROFILE ?? "personal";
if (profile !== "personal" && profile !== "personal-money-void" && profile !== "authorized") throw new Error("SHADOW_MCP_PROFILE must be personal, personal-money-void or authorized");
const toolset = process.env.SHADOW_MCP_TOOLSET ?? "full";
if (toolset !== "full" && toolset !== "compact") throw new Error("SHADOW_MCP_TOOLSET must be full or compact");
const config = process.env.SHADOW_MCP_CONFIG_FILE ? JSON.parse(readFileSync(process.env.SHADOW_MCP_CONFIG_FILE, "utf8")) : {};
if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).some(k => !["mediaRoots", "timeoutMs"].includes(k))) throw new Error("Invalid MCP file config");
const roots: string[] = config.mediaRoots ?? (process.env.SHADOW_MEDIA_ROOTS ?? "").split(delimiter).filter(Boolean);
if (!Array.isArray(roots) || roots.some(root => typeof root !== "string")) throw new Error("Invalid MCP media roots");
if (roots.some(root => !isAbsolute(root))) throw new Error("SHADOW_MEDIA_ROOTS must contain absolute directories");
const timeoutMs = Number(config.timeoutMs ?? process.env.SHADOW_MCP_TIMEOUT_MS ?? 30_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("SHADOW_MCP_TIMEOUT_MS must be between 1 and 120000");
const client = new LifeClient({ api: process.env.SHADOW_API_URL ?? "http://127.0.0.1:8787", profile, timeoutMs,
  ...(process.env.SHADOW_MCP_SCENARIO ? { scenario: agentScenarioNameSchema.parse(process.env.SHADOW_MCP_SCENARIO) } : {}),
  ...(process.env.SHADOW_ACCESS_TOKEN ? { token: process.env.SHADOW_ACCESS_TOKEN } : {}),
  ...(process.env.SHADOW_PROXY_AUTH_SECRET ? { proxySecret: process.env.SHADOW_PROXY_AUTH_SECRET } : {}),
  ...(process.env.SHADOW_PROXY_CLIENT_ID ? { proxyClientId: process.env.SHADOW_PROXY_CLIENT_ID } : {})
});
const handleLine = createMcpServer(client, roots.map(root => resolve(root)), toolset);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const response = await handleLine(line);
  if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
}

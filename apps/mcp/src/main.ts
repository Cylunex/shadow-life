import { createInterface } from "node:readline";
import { delimiter, isAbsolute, resolve } from "node:path";
import { assertCompleteQueryTransport } from "@shadow/contracts";
import { LifeClient } from "./client.js";
import { createMcpServer } from "./server.js";

assertCompleteQueryTransport();
const profile = process.env.SHADOW_MCP_PROFILE ?? "personal";
if (profile !== "personal" && profile !== "authorized") throw new Error("SHADOW_MCP_PROFILE must be personal or authorized");
const roots = (process.env.SHADOW_MEDIA_ROOTS ?? "").split(delimiter).filter(Boolean);
if (roots.some(root => !isAbsolute(root))) throw new Error("SHADOW_MEDIA_ROOTS must contain absolute directories");
const timeoutMs = Number(process.env.SHADOW_MCP_TIMEOUT_MS ?? 30_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("SHADOW_MCP_TIMEOUT_MS must be between 1 and 120000");
const client = new LifeClient({ api: process.env.SHADOW_API_URL ?? "http://127.0.0.1:8787", profile, timeoutMs,
  ...(process.env.SHADOW_ACCESS_TOKEN ? { token: process.env.SHADOW_ACCESS_TOKEN } : {}),
  ...(process.env.SHADOW_PROXY_AUTH_SECRET ? { proxySecret: process.env.SHADOW_PROXY_AUTH_SECRET } : {})
});
const handleLine = createMcpServer(client, roots.map(root => resolve(root)));
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const response = await handleLine(line);
  if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
}

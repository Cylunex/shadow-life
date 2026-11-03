import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { LifeClient, toolError, isCapability } from "@shadow/life-client/client";
import { uploadLocalImage, uploadLocalFile, uploadTool, uploadFileTool } from "@shadow/life-client/media";
import { agentScenarioNameSchema } from "@shadow/contracts";

// One JSON document in/out; no protocol handshake or resident MCP process.
export async function runSkill(configPath: string, action: string, name?: string, args: unknown = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const profile = config.profile ?? "personal";
  if (!["personal", "personal-money-void", "authorized"].includes(profile)) throw new Error("Invalid Life profile");
  const roots = config.mediaRoots ?? [];
  if (!Array.isArray(roots) || roots.some((root: unknown) => typeof root !== "string" || !isAbsolute(root))) throw new Error("Absolute mediaRoots required");
  const timeoutMs = config.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("Invalid timeoutMs");
  const client = new LifeClient({ api: config.api, profile, timeoutMs,
    ...(config.token ? { token: config.token } : {}),
    ...(config.proxySecret ? { proxySecret: config.proxySecret } : {}),
    ...(config.proxyClientId ? { proxyClientId: config.proxyClientId } : {}),
    ...(config.scenario ? { scenario: agentScenarioNameSchema.parse(config.scenario) } : {}) });
  if (action === "catalog") return [...await client.listTools(), ...(roots.length ? [uploadTool, ...(client.allows("money.import_file") ? [uploadFileTool] : [])] : [])];
  if (action !== "call" || !name) throw new Error("Usage: skill --config <private.json> catalog | call <capability> [input.json]; default input is stdin");
  try {
    if (name === uploadTool.name) return await uploadLocalImage(client, roots, args);
    if (name === uploadFileTool.name) return await uploadLocalFile(client, roots, args);
    if (!isCapability(name)) throw new Error("Unknown capability");
    return await client.call(name, args);
  } catch (error) { return { ...toolError(error, name, args).structuredContent, isError: true }; }
}

if (process.argv[1]?.endsWith("/skill.ts")) {
  const [, , flag, configPath, action, name, inputPath] = process.argv;
  if (flag !== "--config" || !configPath || !action) throw new Error("Life skill requires --config <private.json> and catalog/call");
  let args: unknown = {};
  if (action === "call") {
    let raw: string;
    if (inputPath) raw = await readFile(inputPath, "utf8");
    else { const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); raw = Buffer.concat(chunks).toString("utf8"); }
    args = JSON.parse(raw || "{}");
  }
  try {
    const result = await runSkill(configPath, action, name, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result && typeof result === "object" && !Array.isArray(result) && "isError" in result && result.isError) process.exitCode = 1;
  } catch { process.stdout.write(`${JSON.stringify({ isError: true, code: "connection_unavailable", message: "Life skill configuration or connection unavailable" })}\n`); process.exitCode = 1; }
}

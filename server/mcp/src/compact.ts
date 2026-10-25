import { capabilityRegistry, mcpCommandInputSchema as commandSchema, mcpQueryInputSchema as querySchema, type CapabilityName } from "@shadow/contracts";
import { z } from "zod";
import { capabilityTool, LifeClient, ToolFailure } from "./client.js";

export type McpToolset = "full" | "compact";
export const compactEntrypoints = new Set(["agent.discover", "operations.find"]);

export const compactQueryTool = {
  name: "life.query",
  description: "Run one Life read capability discovered with agent.discover (include_schemas=true). Pass its exact name and schema-matching input. Never executes a write. Follow the result's pagination and use returned source IDs for details.",
  inputSchema: z.toJSONSchema(querySchema),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
};
export const compactCommandTool = {
  name: "life.command",
  description: "Execute one Life write capability discovered with agent.discover (include_schemas=true). Use one stable cmd_ key per intent and schema-matching input; corrections require the current revision. On unknown outcome use operations.find with the same key. Success requires the returned committed receipt.",
  inputSchema: z.toJSONSchema(commandSchema),
  // This entry can route any write allowed by the configured profile, so use conservative hints.
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
};

export const compactInstructions = `This MCP uses the compact toolset. Start with agent.discover using a task/query or exact names and include_schemas=true; follow next_offset when needed. Each returned input_schema describes only the capability input.
For mode=read call life.query with {capability: name, input: schemaMatchingInput}. For mode=write call life.command with {capability: name, command_id: stableCmdKey, input: schemaMatchingInput}.
operations.find remains directly callable for unknown write outcomes. Other domain names are discovery targets, not directly exposed tools in compact mode. Toolset selection does not grant permissions. Never send code, SQL or nested batches.`;

export async function listCompactTools(client: LifeClient) {
  // Fetch metadata only: no full schema catalog or legacy per-capability schema fan-out.
  const visible = await client.listCapabilities();
  const tools: Array<ReturnType<typeof capabilityTool> | typeof compactQueryTool | typeof compactCommandTool> = visible.filter(item => compactEntrypoints.has(item.name)).map(item => {
    const name = item.name as CapabilityName;
    return capabilityTool(name, z.toJSONSchema(capabilityRegistry[name].inputSchema));
  });
  if (visible.some(item => capabilityRegistry[item.name as CapabilityName].idempotency !== "required")) tools.push(compactQueryTool);
  if (visible.some(item => capabilityRegistry[item.name as CapabilityName].idempotency === "required")) tools.push(compactCommandTool);
  return { tools, canUpload: visible.some(item => item.name === "library.capture"), canUploadFile: visible.some(item => item.name === "library.capture") && visible.some(item => item.name === "money.import_file") };
}

export function resolveCompactCall(client: LifeClient, tool: string, args: unknown) {
  const write = tool === compactCommandTool.name;
  const parsed = (write ? commandSchema : querySchema).parse(args);
  const name = parsed.capability;
  if (!client.allows(name)) throw new ToolFailure({ protocol: "shadow.error", code: "permission_denied", message: "The capability is unavailable in this profile/scenario." });
  if ((capabilityRegistry[name].idempotency === "required") !== write) throw new ToolFailure({
    protocol: "shadow.error", code: "validation", fields: ["capability"],
    message: `This capability requires ${write ? "life.query" : "life.command"}; no command was submitted.`
  });
  return { name, args: write ? { command_id: (parsed as z.infer<typeof commandSchema>).command_id, input: parsed.input } : parsed.input };
}

import { z } from "zod";
import { commandId } from "./schemas.js";

// Transport envelopes only. Domain inputs/results remain in capabilityRegistry.
const capability = z.string().min(1).max(100).describe("Exact capability name returned by agent.discover.");
const input = z.record(z.string(), z.unknown()).describe("Input matching the discovered input_schema. Do not nest another input or command_id here.");
export const mcpQueryInputSchema = z.object({ capability, input }).strict();
export const mcpCommandInputSchema = z.object({ capability, command_id: commandId, input }).strict();

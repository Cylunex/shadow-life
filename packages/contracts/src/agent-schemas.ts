import { z } from "zod";

export const agentScenarioNameSchema = z.enum(["daily", "spending", "health", "travel", "library", "planning"]);
export const agentProfileSchema = z.enum(["personal", "personal-money-void", "authorized"]);
export const agentCatalogInputSchema = z.object({ profile: agentProfileSchema.optional(), scenario: agentScenarioNameSchema.optional() }).strict();
export const agentDiscoverInputSchema = z.object({
  query: z.string().trim().max(200).default(""),
  scenario: agentScenarioNameSchema.optional(),
  profile: agentProfileSchema.optional(),
  names: z.array(z.string().min(1).max(100)).max(20).optional(),
  read_only: z.boolean().default(false),
  include_schemas: z.boolean().default(false),
  offset: z.number().int().min(0).max(1000).default(0),
  limit: z.number().int().min(1).max(30).default(10)
}).strict();
export const agentGlossaryInputSchema = z.object({ query: z.string().trim().max(200).default(""), profile: agentProfileSchema.optional(), scenario: agentScenarioNameSchema.optional(), limit: z.number().int().min(1).max(30).default(20) }).strict();
export const agentScenariosInputSchema = z.object({ scenario: agentScenarioNameSchema.optional(), profile: agentProfileSchema.optional() }).strict();
export const agentTermSchema = z.object({
  id: z.string(), title: z.string(), aliases: z.array(z.string()), definition: z.string(),
  boundaries: z.array(z.string()), capabilities: z.array(z.string()), lookup_tools: z.array(z.string())
});
export const agentScenarioSchema = z.object({
  name: agentScenarioNameSchema, title: z.string(), description: z.string(),
  capabilities: z.array(z.string()), instructions: z.array(z.string())
});
export const agentCapabilitySchema = z.object({
  name: z.string(), description: z.string(), domain: z.string(), mode: z.enum(["read", "write"]),
  possible_effects: z.array(z.string()), scenarios: z.array(agentScenarioNameSchema),
  matched_terms: z.array(z.string()), example: z.record(z.string(), z.unknown()).optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(), result_schema: z.record(z.string(), z.unknown()).optional()
});
export const agentDiscoverResultSchema = z.object({
  catalog_revision: z.string(), capabilities: z.array(agentCapabilitySchema), terms: z.array(agentTermSchema),
  total: z.number().int().nonnegative(), next_offset: z.number().int().nullable(), truncated: z.boolean()
});
export const agentGlossaryResultSchema = z.object({ catalog_revision: z.string(), terms: z.array(agentTermSchema), total: z.number().int().nonnegative(), truncated: z.boolean() });
export const agentScenariosResultSchema = z.object({ catalog_revision: z.string(), scenarios: z.array(agentScenarioSchema) });
export const agentCatalogSnapshotSchema = z.object({ catalog_revision: z.string(), terms: z.array(agentTermSchema).max(200), scenarios: z.array(agentScenarioSchema).max(20), capabilities: z.array(agentCapabilitySchema).max(1000) });
export const agentValidateInputSchema = z.object({ name: z.string().min(1).max(100), input: z.unknown() }).strict();
export const agentValidateResultSchema = z.object({
  name: z.string(), catalog_revision: z.string(), valid: z.boolean(), executed: z.literal(false),
  mode: z.enum(["read", "write"]), required_effects: z.array(z.string()),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
  input: z.unknown().optional()
});
export type AgentScenarioName = z.infer<typeof agentScenarioNameSchema>;
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export type AgentDiscoverResult = z.infer<typeof agentDiscoverResultSchema>;
export type AgentTerm = z.infer<typeof agentTermSchema>;
export type AgentScenario = z.infer<typeof agentScenarioSchema>;
export type AgentValidateResult = z.infer<typeof agentValidateResultSchema>;
export type AgentCatalogSnapshot = z.infer<typeof agentCatalogSnapshotSchema>;

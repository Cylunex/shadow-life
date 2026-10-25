import { z } from 'zod';
import { agentProfileSchema, agentScenarioNameSchema } from './agent-schemas.js';
import { agentObjectReferenceSchema, agentMemoriesResultSchema, ianaTimeZone, instant, localDate, storedAmount } from './schemas.js';

export const agentContextInputSchema = z.object({
  scenario: agentScenarioNameSchema.optional().describe('Narrows record kinds: daily=meal/purchase/measurement, spending=purchase/money, health=measurement/workout, travel=trip, library=library_item, planning=meal/purchase/money. Never grants effects.'),
  profile: agentProfileSchema.optional().describe('Additional narrowing only; MCP owns the configured profile.'),
  query: z.string().trim().min(1).max(200).optional().describe('Literal case-insensitive substring of names, notes and source text; no natural-language classifier or SQL wildcard syntax.'),
  from_on: localDate.optional(), to_on_exclusive: localDate.optional(),
  time_zone: ianaTimeZone.default('Asia/Shanghai').describe('Timestamps use this local date; date-only facts retain their stored date. Library uses document_date or local creation date; trips use starts_on.'),
  object_refs: z.array(agentObjectReferenceSchema).max(20).default([]).describe('Exact current effective revisions; Library permits immutable historical revisions. Unavailable references fail uniformly. With other filters, their intersection is returned.'),
  memory_keys: z.array(z.string().trim().min(1).max(100)).max(20).default([]).describe('Exact preference/aggregate keys, still restricted to the selected scenario and readable evidence.'),
  response_format: z.enum(['concise', 'detailed']).default('concise'),
  limit: z.number().int().min(1).max(50).default(20),
  byte_budget: z.number().int().min(2048).max(65536).default(16000).describe('Actual UTF-8 JSON bytes, including metadata and continuation; whole records only.'),
  offset: z.number().int().min(0).max(10000).default(0).describe('Continue with the same filters and next_offset. Each page revalidates current facts and is a fresh snapshot.')
}).strict().superRefine((value, context) => {
  if (!value.scenario && !value.query && !value.from_on && !value.object_refs.length && !value.memory_keys.length) context.addIssue({ code: 'custom', message: 'A scenario, query, complete date range, object reference or memory key is required' });
  if ((value.from_on === undefined) !== (value.to_on_exclusive === undefined)) context.addIssue({ code: 'custom', path: ['to_on_exclusive'], message: 'Both date endpoints are required' });
  if (value.from_on && value.to_on_exclusive && value.from_on >= value.to_on_exclusive) context.addIssue({ code: 'custom', path: ['to_on_exclusive'], message: 'Exclusive end must follow start' });
  if (new Set(value.object_refs.map(ref => `${ref.kind}:${ref.id}:${ref.revision}`)).size !== value.object_refs.length) context.addIssue({ code: 'custom', path: ['object_refs'], message: 'References must be unique' });
});
export const agentContextRecordSchema = z.object({
  ref: agentObjectReferenceSchema,
  domain: z.enum(['meals', 'money', 'health', 'travel', 'library']),
  title: z.string().max(300), happened_on: localDate, occurred_at: instant.nullable(), time_zone: ianaTimeZone,
  source_type: z.string().max(100), amount: storedAmount.optional(), currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
  excerpt: z.string().max(2000).optional(), facts: z.record(z.string(), z.json()).optional(),
  detail: z.object({ capability: z.enum(['life.get_record', 'health.get_record', 'travel.get_trip', 'library.get_item']), input: z.record(z.string(), z.json()) }).strict()
}).strict();
export const agentContextResultSchema = z.object({
  as_of: instant, time_zone: ianaTimeZone,
  range: z.object({ from_on: localDate.nullable(), to_on_exclusive: localDate.nullable() }).strict(),
  response_format: z.enum(['concise', 'detailed']),
  records: z.array(agentContextRecordSchema).max(50), memories: agentMemoriesResultSchema.shape.items.max(20),
  coverage: z.object({ authorized_kinds: z.array(agentObjectReferenceSchema.shape.kind), matched_records: z.number().int().nonnegative(), returned_records: z.number().int().nonnegative(), matched_memories: z.number().int().nonnegative(), unknown: z.array(z.string()), complete: z.boolean() }).strict(),
  truncation: z.object({ truncated: z.boolean(), reasons: z.array(z.enum(['limit', 'byte_budget', 'offset_limit', 'oversized_record', 'memory_limit'])), omitted_records: z.number().int().nonnegative(), omitted_memories: z.number().int().nonnegative(), result_bytes: z.number().int().nonnegative(), byte_budget: z.number().int().positive() }).strict(),
  continuation: z.object({ capability: z.literal('agent.context'), next_offset: z.number().int().nonnegative().nullable(), instruction: z.string() }).strict()
}).strict();
export type AgentContextInput = z.infer<typeof agentContextInputSchema>;
export type AgentContextRecord = z.infer<typeof agentContextRecordSchema>;
export type AgentContextResult = z.infer<typeof agentContextResultSchema>;

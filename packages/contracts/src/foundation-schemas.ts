import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !value.startsWith('0000') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const cursor=z.string().regex(/^\d{1,19}$/u).refine(value=>/^\d{1,19}$/u.test(value)&&BigInt(value)<=9223372036854775807n,'Cursor exceeds the supported range');
const instant = z.iso.datetime({ offset: true });
export const foundationScenario = z.enum(['daily', 'spending', 'health', 'travel', 'library', 'planning']);
export const foundationRefSchema = z.object({
  kind: z.enum(['meal', 'purchase', 'money_entry', 'health_measurement', 'health_workout', 'health_observation', 'health_sleep', 'health_activity', 'health_habit', 'health_source', 'trip', 'library_item', 'life_project', 'action_item', 'meal_plan', 'food_stock_lot', 'owned_item', 'recipe', 'food', 'place', 'reservation', 'source', 'agent_intention', 'agent_task', 'agent_learning', 'agent_subscription']),
  id, revision: z.number().int().positive().max(2147483647)
}).strict();
export type FoundationRef = z.infer<typeof foundationRefSchema>;
export const foundationEffects: Record<FoundationRef['kind'], string> = {
  meal: 'life.meal.read', purchase: 'life.meal.read', money_entry: 'money.entry.read',
  health_measurement: 'health.measurement.read', health_workout: 'health.measurement.read', health_observation:'health.measurement.read',health_sleep:'health.measurement.read',health_activity:'health.measurement.read',health_habit:'health.measurement.read',health_source:'health.measurement.read', trip: 'travel.trip.read', reservation: 'travel.trip.read',
  library_item: 'library.item.read', source: 'library.asset.read', life_project: 'life.project.read', action_item: 'life.project.read', owned_item: 'life.item.read',
  meal_plan: 'life.meal.read', food_stock_lot: 'life.meal.read', recipe: 'life.meal.read', food: 'life.meal.read', place: 'travel.trip.read',
  agent_intention: 'agent.run', agent_task: 'agent.run', agent_learning: 'agent.run', agent_subscription: 'agent.run'
};
export const foundationKinds: Record<string, FoundationRef['kind'][]> = {
  daily: ['meal', 'purchase', 'health_measurement', 'health_observation', 'health_sleep', 'health_activity', 'health_habit', 'health_source', 'action_item'], spending: ['purchase', 'money_entry', 'owned_item'],
  health: ['health_measurement', 'health_workout', 'health_observation', 'health_sleep', 'health_activity', 'health_habit', 'health_source'], travel: ['trip', 'reservation', 'place'], library: ['library_item', 'source'],
  planning: ['meal', 'purchase', 'money_entry', 'health_measurement', 'health_workout', 'health_observation', 'health_sleep', 'health_activity', 'health_habit', 'health_source', 'library_item', 'life_project', 'action_item', 'meal_plan', 'food_stock_lot', 'recipe', 'food', 'owned_item', 'trip', 'reservation', 'place']
};

const refs = z.array(foundationRefSchema).max(20).default([]).refine(items => items.every(item => !item.kind.startsWith('agent_')) && new Set(items.map(item => `${item.kind}:${item.id}`)).size === items.length, 'Evidence must be distinct business objects; recursive memory references are not evidence');
const revisionFields = { id: id.optional(), expected_revision: z.number().int().positive().max(2147483647).optional(), reason: z.string().trim().min(1).max(500).optional() };
function revisionGuard(value: {id?: string | undefined; expected_revision?: number | undefined; reason?: string | undefined}, context: z.RefinementCtx) {
  if ((value.id === undefined) !== (value.expected_revision === undefined)) context.addIssue({code: 'custom', message: 'id and expected_revision must be supplied together'});
  if (value.id && !value.reason) context.addIssue({code: 'custom', path: ['reason'], message: 'A correction requires a reason'});
}
const scope = z.enum(['global', ...foundationScenario.options]);
export const setIntentionSchema = z.object({
  ...revisionFields, key: z.string().trim().min(1).max(100), scope,
  kind: z.enum(['preference', 'constraint', 'goal']), category: z.enum(['dietary', 'time_budget', 'travel', 'budget', 'goal', 'other']),
  statement: z.string().trim().min(1).max(2000), assertion: z.literal('explicit'),
  minutes: z.number().int().min(1).max(1440).optional(),
  amount: z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u).optional(), currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
  valid_from: date.optional(), valid_to_exclusive: date.optional(), project_ref: foundationRefSchema.refine(ref => ref.kind === 'life_project').optional(),
  state: z.enum(['active', 'archived']).default('active')
}).strict().superRefine((value, context) => {
  revisionGuard(value, context);
  if (value.valid_from && value.valid_to_exclusive && value.valid_from >= value.valid_to_exclusive) context.addIssue({code: 'custom', message: 'Validity range must be nonempty'});
  if ((value.amount === undefined) !== (value.currency === undefined)) context.addIssue({code: 'custom', message: 'Amount and currency must be paired'});
  if (value.category === 'time_budget' && value.minutes === undefined) context.addIssue({code: 'custom', path: ['minutes'], message: 'Time budget requires minutes'});
  if (value.category === 'budget' && value.amount === undefined) context.addIssue({code: 'custom', path: ['amount'], message: 'Budget requires amount and currency'});
});
export const saveTaskSchema = z.object({
  ...revisionFields, task_key: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(300),
  scope, state: z.enum(['open', 'running', 'waiting', 'completed', 'cancelled']).default('open'),
  current_step: z.string().trim().max(1000).default(''), next_step: z.string().trim().max(1000).default(''),
  missing: z.array(z.string().trim().min(1).max(300)).max(20).default([]), object_refs: refs,
  operation_ids: z.array(id).max(30).default([]).describe('Existing subject-bound execution receipts, never model declarations.'),
  lease_token: id.optional(), claim_seconds: z.number().int().min(15).max(300).optional()
}).strict().superRefine((value, context) => {
  revisionGuard(value, context);
  if (value.claim_seconds && value.state !== 'running') context.addIssue({code: 'custom', message: 'A claim requires running state'});
  if (value.state === 'completed' && (value.missing.length || value.next_step)) context.addIssue({code: 'custom', message: 'Completed task must have no missing material or next step'});
});
export const saveLearningSchema = z.object({
  ...revisionFields, key: z.string().trim().min(1).max(200), scope,
  kind: z.enum(['observation', 'workflow_experience']), statement: z.string().trim().min(1).max(2000),
  object_refs: refs, operation_ids: z.array(id).max(30).default([]),
  environment: z.string().trim().min(1).max(200), workflow_revision: z.string().trim().min(1).max(200),
  outcome: z.enum(['observed', 'succeeded', 'failed']), limitations: z.string().trim().min(1).max(1000),
  valid_to_exclusive: date.optional(), state: z.enum(['active', 'archived']).default('active')
}).strict().superRefine((value, context) => {
  revisionGuard(value, context);
  if (!value.object_refs.length && !value.operation_ids.length) context.addIssue({code: 'custom', message: 'Learning requires verifiable evidence'});
  if (value.kind === 'observation' && value.outcome !== 'observed') context.addIssue({code: 'custom', message: 'An observation cannot claim workflow success'});
  if (value.kind === 'workflow_experience' && value.outcome === 'succeeded' && !value.operation_ids.length) context.addIssue({code: 'custom', message: 'Successful experience requires operation receipts'});
});
export const setSubscriptionSchema = z.object({
  ...revisionFields, consumer: id, scope, object_refs: refs, state: z.enum(['active', 'archived']).default('active')
}).strict().superRefine(revisionGuard);
export const ackChangesSchema = z.object({ consumer: id, expected_cursor: cursor, cursor: cursor }).strict().refine(value => /^\d{1,19}$/u.test(value.cursor)&&/^\d{1,19}$/u.test(value.expected_cursor)&&BigInt(value.cursor) >= BigInt(value.expected_cursor), 'Cursor cannot move backwards');
export const restoreFoundationSchema=z.object({section:z.enum(['intentions','tasks','learning']),copy_key:id.max(90),entries:z.array(z.record(z.string(),z.json())).min(1).max(50)}).strict();
export const foundationWriteSchemas = {
  'agent.restore':restoreFoundationSchema,
  'agent.set_intention': setIntentionSchema, 'agent.save_task': saveTaskSchema,
  'agent.save_learning': saveLearningSchema, 'agent.set_subscription': setSubscriptionSchema, 'agent.ack_changes': ackChangesSchema
} as const;
const foundationBudgetSchema=z.object({truncated:z.boolean(),result_bytes:z.number().int().nonnegative(),byte_budget:z.number().int().positive().max(2147483647)}).strict();
const common = {
  byte_budget:z.number().int().min(4096).max(131072).default(64000),
  scenario: foundationScenario.optional(), profile: z.enum(['authorized', 'personal', 'personal-money-void']).optional(),
  limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).max(10000).default(0)
};
export const intentionsInputSchema = z.object({...common, on: date, include_inactive: z.boolean().default(false)}).strict();
const objectQueryRefs=z.array(foundationRefSchema).max(20).default([]).refine(items=>new Set(items.map(item=>`${item.kind}:${item.id}`)).size===items.length,'Object references must be distinct');
export const objectsInputSchema = z.object({...common, object_refs: objectQueryRefs, query: z.string().trim().min(1).max(200).optional(), depth: z.number().int().min(0).max(2).default(1)}).strict().refine(value => (value.object_refs.length > 0 || !!value.query)&&value.object_refs.length<=value.limit, 'Object references or query required; limit must cover explicit roots');
export const tasksInputSchema = z.object({...common, id: id.optional(), include_terminal: z.boolean().default(false)}).strict();
export const learningInputSchema = z.object({...common, on: date, query: z.string().trim().min(1).max(200).optional(), environment: z.string().trim().min(1).max(200).optional(), workflow_revision: z.string().trim().min(1).max(200).optional()}).strict();
export const workspaceInputSchema = z.object({...common, from_on: date, to_on_exclusive: date, time_zone: z.string().refine(value => {try {new Intl.DateTimeFormat('en', {timeZone: value}); return true;} catch {return false;} }).default('Asia/Shanghai'), query: z.string().trim().min(1).max(200).optional(), byte_budget: z.number().int().min(4096).max(131072).default(64000)}).strict().refine(value => value.to_on_exclusive > value.from_on && (Date.parse(value.to_on_exclusive) - Date.parse(value.from_on)) / 86400000 <= 31, 'Workspace date window must be 1–31 days');
export const changesInputSchema = z.object({...common, consumer: id, after: cursor.optional()}).strict();
export const exportInputSchema = z.object({...common, section: z.enum(['intentions', 'tasks', 'learning', 'subscriptions', 'history', 'sources']), on: date}).strict();
export const foundationNodeSchema = z.object({ref: foundationRefSchema, title: z.string(), semantic: z.enum(['fact', 'plan', 'source']), data: z.record(z.string(), z.json()), detail: z.object({capability: z.string(), input: z.record(z.string(), z.json())}).strict()}).strict();
export const foundationListSchema = z.object({items: z.array(z.record(z.string(), z.json())), truncation:foundationBudgetSchema, as_of: instant, total: z.number().int().nonnegative(), total_is_exact:z.boolean(), has_more:z.boolean(), next_offset: z.number().int().nonnegative().nullable()}).strict();
export const objectsResultSchema = z.object({nodes: z.array(foundationNodeSchema), truncation:foundationBudgetSchema, edges: z.array(z.object({from: foundationRefSchema, to: foundationRefSchema, relation: z.string()}).strict()), as_of: instant, truncated: z.boolean()}).strict();
export const workspaceResultSchema = z.object({
  from_on: date, to_on_exclusive: date, time_zone: z.string(), as_of: instant,
  intentions: z.array(z.record(z.string(), z.json())), sections: z.array(z.object({kind: z.string(), semantic: z.enum(['fact', 'plan', 'source', 'task', 'derived']), as_of: instant, data: z.json(), truncated: z.boolean()}).strict()),
  coverage: z.object({authorized_sections: z.array(z.string()), unknown: z.array(z.string()), complete: z.boolean()}).strict(),
  truncation: z.object({truncated: z.boolean(), result_bytes: z.number().int(), byte_budget: z.number().int()}).strict()
}).strict();
export const changesResultSchema = z.object({items: z.array(z.object({sequence: z.string(), type: z.string(), refs: z.array(foundationRefSchema), invalidated_refs:z.array(foundationRefSchema), occurred_at: instant}).strict()), truncation:foundationBudgetSchema, cursor: z.string(), acknowledged_cursor: z.string(), has_more: z.boolean(), as_of: instant}).strict();
export const foundationExportSchema = z.object({format: z.literal('shadow-life.personal-data'), section: exportInputSchema.shape.section, items: z.array(z.record(z.string(), z.json())), truncation:foundationBudgetSchema, as_of: instant, total: z.number().int(), total_is_exact:z.boolean(), has_more:z.boolean(), next_offset: z.number().int().nullable(), original_assets_included: z.literal(false)}).strict();
export const foundationQueries = {
  'agent.intentions': {input: intentionsInputSchema, result: foundationListSchema},
  'agent.workspace': {input: workspaceInputSchema, result: workspaceResultSchema},
  'agent.objects': {input: objectsInputSchema, result: objectsResultSchema},
  'agent.tasks': {input: tasksInputSchema, result: foundationListSchema},
  'agent.learning': {input: learningInputSchema, result: foundationListSchema},
  'agent.changes': {input: changesInputSchema, result: changesResultSchema},
  'agent.export': {input: exportInputSchema, result: foundationExportSchema}
} as const;
export type FoundationQueryName = keyof typeof foundationQueries;

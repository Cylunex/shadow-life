import { z } from "zod";

export const runStateSchema=z.enum(["started","streaming","awaiting_input","committed_partial","completed","interrupted"]);
export type RunState=z.infer<typeof runStateSchema>;
const hostEventBase={id:z.string().min(1),run_id:z.string().min(1)};
export const hostRunEventSchema=z.discriminatedUnion("type",[
  z.object({...hostEventBase,type:z.literal("run.state"),state:runStateSchema,reason:z.string().min(1).optional(),fields:z.array(z.string().min(1)).optional(),prompt:z.string().min(1).optional()}).strict(),
  z.object({...hostEventBase,type:z.literal("message.delta"),text:z.string(),runtime_event_id:z.string().min(1)}).strict(),
  z.object({...hostEventBase,type:z.literal("tool.started"),authority:z.literal("host"),tool_call_id:z.string().min(1),capability:z.string().min(1),mode:z.enum(["read","write"])}).strict(),
  z.object({...hostEventBase,type:z.literal("event.redacted")}).strict(),
  z.object({...hostEventBase,type:z.literal("tool.result"),authority:z.literal("host").optional(),tool_call_id:z.string().min(1),capability:z.string().min(1),outcome:z.enum(["returned","rejected"]),query_input:z.unknown().optional(),result:z.unknown()}).strict(),
  z.object({...hostEventBase,type:z.literal("operation.committed"),authority:z.literal("executor"),subject_id:z.string().min(1),tool_call_id:z.string().min(1),capability:z.string().min(1),command_id:z.string().min(1),execution_id:z.string().min(1),result:z.unknown()}).strict()
]);
export type HostRunEvent=z.infer<typeof hostRunEventSchema>;

export const storedRunSchema=z.object({id:z.string(),thread_id:z.string(),status:z.enum(["running","awaiting_input","completed","interrupted","failed"]),error:z.string().nullable(),started_at:z.string(),finished_at:z.string().nullable(),last_sequence:z.number().int().nonnegative()});
export const runPageInputSchema=z.object({after:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(1000).default(1000)});
export const storedRunEventSchema=z.object({sequence:z.number().int().positive(),event_type:z.string(),payload:hostRunEventSchema,created_at:z.string()});
export const runPageResultSchema=z.object({run:storedRunSchema,events:z.array(storedRunEventSchema).max(1000),next_after:z.number().int().nonnegative(),has_more:z.boolean()});
export const runEventsPageResultSchema=z.object({items:z.array(storedRunEventSchema).max(1000),next_after:z.number().int().nonnegative(),has_more:z.boolean()});
export const threadRunsResultSchema=z.object({items:z.array(storedRunSchema).max(20)});
export type RunPage=z.infer<typeof runPageResultSchema>;

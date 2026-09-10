import { z } from "zod";

export const canonicalDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u, "must be a canonical non-negative decimal");
export const positiveDecimal = canonicalDecimal.refine((value) => BigInt(value.replace(".", "")) > 0n, "must be greater than zero");
export const currencyCode = z.string().regex(/^[A-Z]{3}$/u, "must be an ISO 4217 currency code");
export const cnyAmount = z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/u, "CNY amount must have exactly two decimal places").refine((value) => value !== "0.00", "must be greater than zero");
export const storedAmount = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u, "amount exceeds NUMERIC(24,6)");
export const signedStoredAmount = z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u, "amount exceeds NUMERIC(24,6)");
export const localDate = z.iso.date();
export const instant = z.iso.datetime({ offset: true });
export const ianaTimeZone = z.string().min(1).max(64).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "must be an IANA time zone");
export const stableId = z.string().regex(/^[a-z][a-z0-9_]{7,127}$/u);
export const commandId = z.string().regex(/^cmd_[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/u);
export const paymentMethodSchema = z.enum(["alipay", "wechat", "jd_pay", "jd_baitiao", "huabei", "gift_card", "cash", "bank_card", "bank_transfer", "mixed", "other"]);

export const sourceInputSchema = z.object({
  kind: z.enum(["text", "image", "receipt", "import"]),
  external_id: z.string().min(1).max(256).optional(),
  captured_on: localDate.optional(),
  captured_at: instant.optional(),
  time_zone: ianaTimeZone.optional(),
  original_text: z.string().max(20_000).optional(),
  asset_version_id: stableId.optional()
}).strict().superRefine((source, context) => {
  if (source.original_text === undefined && source.asset_version_id === undefined) context.addIssue({ code: "custom", message: "source needs original_text or asset_version_id" });
  if (source.captured_on === undefined && source.captured_at === undefined) context.addIssue({ code: "custom", message: "source needs captured_on or captured_at" });
  if (source.captured_at !== undefined && source.time_zone === undefined) context.addIssue({ code: "custom", message: "captured_at needs time_zone" });
});

export const intakeItemInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  food_ref_id: stableId.optional(),
  free_text: z.string().trim().min(1).max(500).optional(),
  quantity: positiveDecimal.optional(),
  unit: z.string().trim().min(1).max(32).optional(),
  amount_g: positiveDecimal.optional(),
  energy_kcal: canonicalDecimal.optional(),
  protein_g: canonicalDecimal.optional(),
  fat_g: canonicalDecimal.optional(),
  carb_g: canonicalDecimal.optional(),
  fiber_g: canonicalDecimal.optional(),
  sodium_mg: canonicalDecimal.optional(),
  consumed_fraction: canonicalDecimal.refine(value => Number(value) <= 1, "must be at most one").optional(),
  provenance: z.enum(["manual","estimated","reference_snapshot","legacy"]).optional(),
  grouping_origin: z.enum(["actual_meal","legacy_meal_bucket"]).optional(),
  estimate: z.boolean().default(false),
  evidence_note: z.string().trim().min(1).max(500).optional()
}).strict().superRefine((item, context) => {
  if ((item.quantity === undefined) !== (item.unit === undefined)) {
    context.addIssue({ code: "custom", message: "quantity and unit must be supplied together" });
  }
  if (item.estimate && item.evidence_note === undefined) {
    context.addIssue({ code: "custom", message: "estimated values need an evidence_note" });
  }
});

export const datedPaymentSchema = z.object({
  amount: cnyAmount,
  currency: z.literal("CNY"),
  occurred_on: localDate,
  occurred_at: instant.optional(),
  time_zone: ianaTimeZone,
  payment_method: paymentMethodSchema.optional(),
  note: z.string().trim().min(1).max(500).optional()
}).strict().refine((value) => {
  if (!value.occurred_at) return true;
  return new Intl.DateTimeFormat("en-CA", { timeZone: value.time_zone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(value.occurred_at)) === value.occurred_on;
}, { path:["occurred_at"], message:"occurred_at does not fall on occurred_on in time_zone" });

export const recordMealInputSchema = z.object({
  occurred_on: localDate,
  occurred_at: instant.optional(),
  time_zone: ianaTimeZone,
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]),
  note: z.string().trim().min(1).max(2_000).optional(),
  items: z.array(intakeItemInputSchema).max(100),
  payment: datedPaymentSchema.optional(),
  source: sourceInputSchema.optional()
}).strict().superRefine((meal, context) => {
  if(meal.items.length===0&&meal.source?.kind!=="image")context.addIssue({code:"custom",path:["items"],message:"a meal needs intake items or an image source"});
  if (meal.occurred_at !== undefined) {
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: meal.time_zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(meal.occurred_at));
    if (local !== meal.occurred_on) context.addIssue({ code: "custom", path: ["occurred_at"], message: "occurred_at does not fall on occurred_on in time_zone" });
  }
});

export const commandEnvelopeSchema = z.object({
  protocol: z.literal("shadow.command"),
  capability: z.literal("life.record_meal"),
  command_id: commandId,
  input: recordMealInputSchema
}).strict();
export const recordMealCommandEnvelopeSchema=commandEnvelopeSchema;

const datedFactSchema = z.object({
  occurred_on: localDate,
  occurred_at: instant.optional(),
  time_zone: ianaTimeZone,
  note: z.string().trim().min(1).max(2_000).optional(),
  source: sourceInputSchema.optional()
}).strict();
function factDateMatches(value: { occurred_on: string; occurred_at?: string | undefined; time_zone: string }): boolean {
  if (!value.occurred_at) return true;
  return new Intl.DateTimeFormat("en-CA", { timeZone: value.time_zone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(value.occurred_at)) === value.occurred_on;
}

export const purchasePaymentSchema=datedPaymentSchema;
export const purchaseItemInputSchema=z.object({raw_name:z.string().trim().min(1).max(200),quantity:positiveDecimal.optional(),unit:z.string().trim().min(1).max(32).optional(),line_amount:cnyAmount.optional(),category_key:z.string().trim().min(1).max(80).optional()}).strict();
export const recordPurchaseInputSchema=datedFactSchema.extend({scene:z.enum(["online_purchase","offline_purchase","delivery","dine_in","drink","service","subscription","transport","entertainment","travel","other"]),merchant_name_raw:z.string().trim().min(1).max(200).optional(),channel_name_raw:z.string().trim().min(1).max(100).optional(),place_ref:z.string().trim().min(1).max(300).optional(),rating:z.number().int().min(1).max(5).optional(),would_repeat:z.boolean().optional(),items:z.array(purchaseItemInputSchema).max(100).default([]),payment:purchasePaymentSchema.optional()}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"}).refine(value=>value.items.length>0||value.merchant_name_raw!==undefined||value.note!==undefined,{message:"consumption needs an item, merchant, or note"});
export const correctIntakeInputSchema = z.object({ item_id: stableId, expected_revision: z.number().int().positive(), item: intakeItemInputSchema, reason: z.string().trim().min(1).max(500) }).strict();
export const correctPurchaseInputSchema=z.object({record_id:stableId,expected_revision:z.number().int().positive(),occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,scene:z.enum(["online_purchase","offline_purchase","delivery","dine_in","drink","service","subscription","transport","entertainment","travel","other"]),merchant_name_raw:z.string().trim().min(1).max(200).optional(),channel_name_raw:z.string().trim().min(1).max(100).optional(),place_ref:z.string().trim().min(1).max(300).optional(),rating:z.number().int().min(1).max(5).optional(),would_repeat:z.boolean().optional(),note:z.string().trim().min(1).max(2_000).optional(),reason:z.string().trim().min(1).max(500)}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
export const voidRecordInputSchema=z.object({record_id:stableId,expected_revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();
export const linkMealConsumptionInputSchema=z.object({meal_id:stableId,consumption_record_id:stableId,evidence:z.enum(["legacy_reference","shared_source","user_confirmed"])}).strict();
export const saveMealTemplateInputSchema=z.object({template_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),name:z.string().trim().min(1).max(200),items:z.array(intakeItemInputSchema).min(1).max(100)}).strict().refine(value=>(value.template_id===undefined)===(value.expected_revision===undefined),{message:"template_id and expected_revision must be supplied together"});
export const recordMealFromTemplateInputSchema=z.object({template_id:stableId,occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),note:z.string().trim().min(1).max(2_000).optional(),payment:datedPaymentSchema.optional(),source:sourceInputSchema.optional()}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
export const diningSceneSchema=z.enum(["delivery","dine_in","takeaway","home_cooked","other"]);
export const diningSourceInputSchema=sourceInputSchema.extend({role:z.enum(["meal_photo","order_screenshot","receipt","evidence"])}).strict();
export const recordDiningInputSchema=z.object({occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),note:z.string().trim().min(1).max(2_000).optional(),items:z.array(intakeItemInputSchema).max(100).optional(),consumed_items:z.array(intakeItemInputSchema).max(100).optional(),purchased_items:z.array(purchaseItemInputSchema).max(100).default([]),
  merchant_name_raw:z.string().trim().min(1).max(200).optional(), channel_name_raw:z.string().trim().min(1).max(100).optional(),
  scene:diningSceneSchema.optional(), place_ref:z.string().trim().min(1).max(300).optional(), rating:z.number().int().min(1).max(5).optional(), would_repeat:z.boolean().optional(),
  payment:datedPaymentSchema.optional(), sources:z.array(diningSourceInputSchema).max(20).default([]), visit:z.object({place_name:z.string().trim().min(1).max(200),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional()}).strict().superRefine((value,context)=>{if((value.latitude===undefined)!==(value.longitude===undefined))context.addIssue({code:"custom",message:"latitude and longitude must be supplied together"});}).optional()
}).strict().superRefine((value,context)=>{if(value.items&&value.consumed_items)context.addIssue({code:"custom",path:["consumed_items"],message:"use consumed_items instead of supplying both fields"});const consumed=value.consumed_items??value.items??[];if(consumed.length===0&&!value.sources.some(source=>source.role==="meal_photo"))context.addIssue({code:"custom",path:["consumed_items"],message:"a dining record needs consumed items or a meal photo"});if(!factDateMatches(value))context.addIssue({code:"custom",path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});});
export const correctMealInputSchema=z.object({meal_id:stableId,expected_revision:z.number().int().positive(),occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),note:z.string().trim().min(1).max(2_000).optional(),reason:z.string().trim().min(1).max(500)}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
export const addIntakeInputSchema=z.object({meal_id:stableId,expected_meal_revision:z.number().int().positive(),item:intakeItemInputSchema,reason:z.string().trim().min(1).max(500)}).strict();
export const removeIntakeInputSchema=z.object({item_id:stableId,expected_revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();
export const addMealPaymentInputSchema=z.object({meal_id:stableId,expected_meal_revision:z.number().int().positive(),payment:datedPaymentSchema}).strict();
export const attachMealSourceInputSchema=z.object({meal_id:stableId,expected_meal_revision:z.number().int().positive(),source:sourceInputSchema,role:z.enum(["evidence","meal_photo","order_screenshot","replacement"]).default("evidence")}).strict();
export const setPersonalAliasInputSchema=z.object({alias:z.string().trim().min(1).max(100),target_kind:z.enum(["food","merchant","meal_template","payment_method"]),target_value:z.string().trim().min(1).max(300)}).strict();

export const recordMoneyEntryInputSchema = datedFactSchema.extend({
  entry_type: z.enum(["expense", "income"]),
  amount: cnyAmount,
  currency: z.literal("CNY"),
  category: z.string().trim().min(1).max(80).optional(),
  counterparty: z.string().trim().min(1).max(200).optional(),
  payment_method: paymentMethodSchema.optional()
}).strict().refine(factDateMatches, { path:["occurred_at"], message:"occurred_at does not fall on occurred_on in time_zone" });

export const recordRefundInputSchema = datedFactSchema.extend({
  original_entry_id: stableId,
  amount: cnyAmount,
  currency: z.literal("CNY")
}).strict().refine(factDateMatches, { path:["occurred_at"], message:"occurred_at does not fall on occurred_on in time_zone" });
export const correctMoneyEntryInputSchema=z.object({record_id:stableId,expected_revision:z.number().int().positive(),amount:storedAmount.refine(value=>BigInt(value.replace(".",""))>0n,"must be greater than zero"),currency:currencyCode,occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,category:z.string().trim().min(1).max(80).optional(),counterparty:z.string().trim().min(1).max(200).optional(),payment_method:paymentMethodSchema.optional(),note:z.string().trim().min(1).max(2_000).optional(),reason:z.string().trim().min(1).max(500)}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});

export const setBudgetInputSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/u),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  amount: cnyAmount,
  currency: z.literal("CNY"),
  expected_revision:z.number().int().positive().optional()
}).strict();

export const setRecurringPlanInputSchema = z.object({
  plan_id:stableId.optional(),
  expected_revision:z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200),
  amount: cnyAmount.nullable().optional(),
  currency: z.literal("CNY").nullable().optional(),
  cadence: z.enum(["daily","weekly", "monthly", "yearly","interval"]),
  interval_days:z.number().int().positive().max(366).optional(),
  time_zone:ianaTimeZone.default("Asia/Shanghai"),
  next_due_on: localDate,
  anchor_on: localDate.optional(),
  local_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u).optional(),
  missing_date_policy:z.enum(["skip","last_day"]).default("skip"),
  recurrence_rule:z.string().trim().min(1).max(500).regex(/^FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=[1-9]\d{0,2})?(?:;BYMONTH=(?:[1-9]|1[0-2]))?(?:;BYMONTHDAY=(?:-1|[1-9]|[12]\d|3[01]))?$/u,"unsupported recurrence rule subset").optional(),
  category: z.string().trim().min(1).max(80).optional(),
  state:z.enum(["active","paused","ended"]).default("active"),
  ended_on:localDate.optional()
}).strict().superRefine((value,context)=>{if((value.plan_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"plan_id and expected_revision must be supplied together"});if((value.amount===undefined||value.amount===null)!==(value.currency===undefined||value.currency===null))context.addIssue({code:"custom",message:"amount and currency must be supplied together"});if(value.cadence==="interval"&&value.interval_days===undefined)context.addIssue({code:"custom",path:["interval_days"],message:"interval cadence needs interval_days"});if(value.state==="ended"&&value.ended_on===undefined)context.addIssue({code:"custom",path:["ended_on"],message:"ended plan needs ended_on"});if(value.anchor_on&&value.next_due_on<value.anchor_on)context.addIssue({code:"custom",path:["next_due_on"],message:"next_due_on must not precede anchor_on"});});
export const setSpendingIntentInputSchema=z.object({intent_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),title:z.string().trim().min(1).max(200),expected_amount:storedAmount.nullable().optional(),currency:currencyCode.nullable().optional(),intended_on:localDate.optional(),state:z.enum(["planned","purchased","cancelled"]),linked_record_id:stableId.optional()}).strict().superRefine((value,context)=>{if((value.intent_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"intent_id and expected_revision must be supplied together"});if((value.expected_amount==null)!==(value.currency==null))context.addIssue({code:"custom",message:"expected_amount and currency must be supplied together"});});
export const setUseCycleInputSchema=z.object({cycle_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),purchase_record_id:stableId.optional(),item_name:z.string().trim().min(1).max(200),started_on:localDate,ended_on:localDate.optional(),state:z.enum(["active","completed","discarded"])}).strict().superRefine((value,context)=>{if((value.cycle_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"cycle_id and expected_revision must be supplied together"});if(value.ended_on&&value.ended_on<value.started_on)context.addIssue({code:"custom",path:["ended_on"],message:"ended_on must not be before started_on"});});
export const setRecurringOccurrenceInputSchema=z.object({occurrence_id:stableId,state:z.enum(["pending","reminded","handled","dismissed","snoozed"]),linked_record_id:stableId.optional(),feedback:z.record(z.string(),z.json()).default({})}).strict();

export const recordHealthMeasurementInputSchema = datedFactSchema.extend({
  metric: z.enum(["weight", "body_fat", "heart_rate", "blood_pressure_systolic", "blood_pressure_diastolic", "temperature", "sleep_duration", "steps", "custom"]),
  value: canonicalDecimal,
  unit: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(100).optional()
}).strict().refine(factDateMatches, { path:["occurred_at"], message:"occurred_at does not fall on occurred_on in time_zone" });
export const ingestHealthRawInputSchema=z.object({source_type:z.enum(["health_connect","scale","samsung","file_import","legacy_health"]),source_instance_key:z.string().trim().min(1).max(200),source_fingerprint:z.string().min(1).max(256),record_type:z.enum(["body","wellbeing","sleep","workout","daily_activity","habit","lab","fitness_test"]),client_record_id:z.string().min(1).max(256),provider_record_id:z.string().min(1).max(256).optional(),record_version:z.number().int().nonnegative(),sync_epoch:z.number().int().positive(),change_kind:z.enum(["upsert","delete"]),payload:z.json().optional(),parse_version:z.string().min(1).max(64)}).strict().superRefine((value,context)=>{if(value.change_kind==="upsert"&&value.payload===undefined)context.addIssue({code:"custom",path:["payload"],message:"upsert needs payload"});if(value.change_kind==="delete"&&value.payload!==undefined)context.addIssue({code:"custom",path:["payload"],message:"delete must not invent payload"});});
export const ingestHealthBatchInputSchema=z.object({source_type:z.enum(["health_connect","scale","samsung","file_import","legacy_health"]),source_instance_key:z.string().trim().min(1).max(200),source_fingerprint:z.string().min(1).max(256),device_id:z.string().trim().min(1).max(200),record_type:z.enum(["body","wellbeing","sleep","workout","daily_activity","habit","lab","fitness_test"]),permission_fingerprint:z.string().min(1).max(256),sync_epoch:z.number().int().positive(),previous_cursor:z.string().max(4_000).nullable(),next_cursor:z.string().min(1).max(4_000),parse_version:z.string().min(1).max(64),records:z.array(z.object({client_record_id:z.string().min(1).max(256),provider_record_id:z.string().min(1).max(256).optional(),record_version:z.number().int().nonnegative(),change_kind:z.enum(["upsert","delete"]),payload:z.json().optional()}).strict().superRefine((value,context)=>{if(value.change_kind==="upsert"&&value.payload===undefined)context.addIssue({code:"custom",path:["payload"],message:"upsert needs payload"});if(value.change_kind==="delete"&&value.payload!==undefined)context.addIssue({code:"custom",path:["payload"],message:"delete must not invent payload"});})).max(1_000)}).strict();
export const setHealthSourceStateInputSchema=z.object({source_type:z.enum(["health_connect","scale","samsung","file_import","legacy_health"]),source_instance_key:z.string().trim().min(1).max(200),source_fingerprint:z.string().min(1).max(256),sync_epoch:z.number().int().positive(),permission_state:z.enum(["granted","revoked","expired","rescan_required"]),reason:z.string().trim().min(1).max(500).optional()}).strict();
export const setHealthPlanInputSchema=z.object({plan_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),kind:z.enum(["habit","goal","workout"]),name:z.string().trim().min(1).max(200),state:z.enum(["active","paused","ended","achieved","cancelled"]),schedule:z.json().optional(),detail:z.json().optional(),metric_key:z.string().trim().min(1).max(100).optional(),target_value:canonicalDecimal.optional(),unit:z.string().trim().min(1).max(32).optional(),due_on:localDate.optional()}).strict().superRefine((value,context)=>{if((value.plan_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"plan_id and expected_revision must be supplied together"});if(value.kind==="goal"&&(!value.metric_key||!value.target_value||!value.unit))context.addIssue({code:"custom",message:"goal needs metric_key, target_value and unit"});if(value.kind!=="goal"&&!value.schedule)context.addIssue({code:"custom",message:"habit and workout need schedule"});if(value.kind==="goal"&&!(["active","achieved","cancelled"] as string[]).includes(value.state))context.addIssue({code:"custom",path:["state"],message:"goal state must be active, achieved, or cancelled"});if(value.kind!=="goal"&&!(["active","paused","ended"] as string[]).includes(value.state))context.addIssue({code:"custom",path:["state"],message:"habit and workout state must be active, paused, or ended"});});
export const healthObservationMetricSchema=z.enum(["weight","body_fat","waist","chest","hip","heart_rate","blood_pressure_systolic","blood_pressure_diastolic","temperature","spo2","blood_glucose","lab_value","fitness_value"]);
const healthProjectionTimeSchema=z.object({occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
export const healthObservationPayloadSchema=healthProjectionTimeSchema.extend({group_kind:z.enum(["measurement","legacy_daily_form","lab_report","fitness_test"]).default("measurement"),observations:z.array(z.object({metric_key:healthObservationMetricSchema,value:canonicalDecimal,unit:z.string().trim().min(1).max(32),original_field:z.string().trim().min(1).max(100).optional(),autofilled:z.boolean().default(false)}).strict()).min(1).max(100)}).strict();
export const healthWellbeingPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,mood_score:z.number().int().min(0).max(10).nullable().optional(),energy_level:z.number().int().min(0).max(10).nullable().optional(),sleep_quality:z.number().int().min(0).max(10).nullable().optional(),morning_erection:z.boolean().nullable().optional(),notes:z.string().max(2_000).nullable().optional()}).strict();
export const healthSleepPayloadSchema=z.object({wake_date:localDate,time_zone:ianaTimeZone,started_at:instant.optional(),ended_at:instant.optional(),total_minutes:z.number().int().nonnegative(),deep_minutes:z.number().int().nonnegative().optional(),light_minutes:z.number().int().nonnegative().optional(),rem_minutes:z.number().int().nonnegative().optional(),awake_minutes:z.number().int().nonnegative().optional()}).strict().refine(value=>!value.started_at||!value.ended_at||value.ended_at>=value.started_at,{path:["ended_at"],message:"ended_at must not be before started_at"});
export const healthWorkoutPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,session_type:z.string().trim().min(1).max(100),started_at:instant.optional(),duration_minutes:z.number().int().nonnegative().optional(),distance_km:canonicalDecimal.optional(),calories_kcal:canonicalDecimal.optional(),rpe:z.number().int().min(0).max(10).optional(),heart_rate_avg:z.number().int().positive().optional(),detail:z.json().optional()}).strict();
export const healthDailyActivityPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,steps:z.number().int().nonnegative().nullable().optional(),active_minutes:z.number().int().nonnegative().nullable().optional(),device_calories_kcal:canonicalDecimal.nullable().optional(),workout_calories_kcal:canonicalDecimal.nullable().optional(),field_sources:z.record(z.string(),z.string()).default({})}).strict();
export const healthHabitPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,habit_key:z.string().trim().min(1).max(120),done_count:z.number().int().nonnegative(),explicit_denial:z.boolean().default(false),note:z.string().max(500).optional()}).strict().refine(value=>!value.explicit_denial||value.done_count===0,{path:["done_count"],message:"explicit denial must keep done_count at zero"});

export const createTripInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  starts_on: localDate,
  ends_on: localDate,
  time_zone: ianaTimeZone,
  note: z.string().trim().min(1).max(2_000).optional()
}).strict().refine((trip) => trip.ends_on >= trip.starts_on, { path: ["ends_on"], message: "ends_on must not be before starts_on" });
export const correctTripInputSchema=createTripInputSchema.extend({trip_id:stableId,expected_revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();

export const addReservationInputSchema = z.object({
  trip_id: stableId,
  reservation_type: z.enum(["flight", "rail", "hotel", "restaurant", "activity", "other"]),
  title: z.string().trim().min(1).max(200),
  starts_at: instant.optional(),
  ends_at: instant.optional(),
  confirmation_code: z.string().trim().min(1).max(100).optional(),
  state:z.enum(["pending","waitlisted","confirmed","changed","cancelled","refunded"]).default("confirmed"),
  origin:z.string().trim().min(1).max(200).optional(), destination:z.string().trim().min(1).max(200).optional(), service_number:z.string().trim().min(1).max(100).optional(), seat:z.string().trim().min(1).max(100).optional(),
  fare:datedPaymentSchema.optional(),
  source: sourceInputSchema.optional()
}).strict().refine((value)=>!value.starts_at||!value.ends_at||value.ends_at>=value.starts_at,{path:["ends_at"],message:"ends_at must not be before starts_at"});
export const correctReservationInputSchema=z.object({reservation_id:stableId,expected_revision:z.number().int().positive(),reservation_type:z.enum(["flight","rail","hotel","restaurant","activity","other"]),title:z.string().trim().min(1).max(200),starts_at:instant.optional(),ends_at:instant.optional(),confirmation_code:z.string().trim().min(1).max(100).optional(),state:z.enum(["pending","waitlisted","confirmed","changed","cancelled","refunded"]),origin:z.string().trim().min(1).max(200).optional(),destination:z.string().trim().min(1).max(200).optional(),service_number:z.string().trim().min(1).max(100).optional(),seat:z.string().trim().min(1).max(100).optional(),source:sourceInputSchema.optional(),reason:z.string().trim().min(1).max(500)}).strict().refine(value=>!value.starts_at||!value.ends_at||value.ends_at>=value.starts_at,{path:["ends_at"],message:"ends_at must not be before starts_at"});
export const voidReservationInputSchema=z.object({reservation_id:stableId,expected_revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();
export const recordTripSegmentInputSchema=z.object({trip_id:stableId,mode:z.enum(["walk","bike","taxi","car","bus","metro","rail","flight","ferry","other"]),origin:z.string().trim().min(1).max(200),destination:z.string().trim().min(1).max(200),starts_at:instant.optional(),ends_at:instant.optional(),distance_km:canonicalDecimal.optional(),note:z.string().trim().min(1).max(2_000).optional(),source:sourceInputSchema.optional()}).strict().refine(value=>!value.starts_at||!value.ends_at||value.ends_at>=value.starts_at,{path:["ends_at"],message:"ends_at must not be before starts_at"});

export const recordVisitInputSchema = datedFactSchema.extend({
  place_name: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  trip_id: stableId.optional()
}).strict().refine(factDateMatches, { path:["occurred_at"], message:"occurred_at does not fall on occurred_on in time_zone" }).superRefine((visit, context) => {
  if ((visit.latitude === undefined) !== (visit.longitude === undefined)) context.addIssue({ code: "custom", message: "latitude and longitude must be supplied together" });
});
export const savePlaceInputSchema=z.object({place_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),name:z.string().trim().min(1).max(200),address:z.string().trim().min(1).max(500).optional(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),tags:z.array(z.string().trim().min(1).max(64)).max(30).default([]),favorite:z.boolean().default(false)}).strict().superRefine((value,context)=>{if((value.place_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"place_id and expected_revision must be supplied together"});if((value.latitude===undefined)!==(value.longitude===undefined))context.addIssue({code:"custom",message:"latitude and longitude must be supplied together"});});
export const tripPlanItemSchema=z.object({stop_id:stableId.optional(),title:z.string().trim().min(1).max(200),starts_at:instant.optional(),place_id:stableId.optional(),note:z.string().max(1000).optional()}).strict();
export const setTripDayPlanInputSchema=z.object({trip_id:stableId,plan_date:localDate,expected_revision:z.number().int().positive().optional(),items:z.array(tripPlanItemSchema).max(100)}).strict();
export const setTripMemberInputSchema=z.object({trip_id:stableId,member_subject_id:stableId,role:z.enum(["editor","viewer"]),visibility:z.enum(["shared","private"])}).strict();
export const publishTripPlanInputSchema=z.object({trip_id:stableId,label:z.string().trim().min(1).max(200).optional(),note:z.string().trim().min(1).max(2_000).optional()}).strict();
export const startTripRunInputSchema=z.object({trip_id:stableId,plan_version_id:stableId.optional()}).strict();
export const setTripStopOutcomeInputSchema=z.object({run_id:stableId,stop_id:stableId,state:z.enum(["arrived","skipped"]),occurred_at:instant.optional(),note:z.string().trim().min(1).max(1_000).optional(),expected_revision:z.number().int().positive().optional()}).strict();

export const captureLibraryItemInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  item_type: z.enum(["note", "receipt", "document", "image", "link"]),
  text: z.string().min(1).max(100_000).optional(),
  url: z.url().max(2_000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  source: sourceInputSchema.optional()
}).strict().refine((item) => item.text !== undefined || item.url !== undefined || item.source !== undefined, { message: "library item needs text, url, or source" });
export const reviseLibraryItemInputSchema=z.object({item_id:stableId,expected_revision:z.number().int().positive(),title:z.string().trim().min(1).max(300),text:z.string().min(1).max(100_000).optional(),url:z.url().max(2_000).optional(),tags:z.array(z.string().trim().min(1).max(64)).max(30).default([]),reason:z.string().trim().min(1).max(500)}).strict().refine(value=>value.text!==undefined||value.url!==undefined,{message:"revision needs text or url"});
export const annotateLibraryItemInputSchema=z.object({item_id:stableId,anchor:z.json(),note:z.string().trim().min(1).max(10_000)}).strict();
export const registerLibraryDerivationInputSchema=z.object({item_id:stableId,source_asset_version_id:stableId,derived_asset_version_id:stableId,kind:z.string().trim().min(1).max(100),processor_version:z.string().trim().min(1).max(100)}).strict();

export const writeCommandSchemas = {
  "life.record_meal": recordMealInputSchema,
  "life.record_dining":recordDiningInputSchema,
  "life.correct_meal":correctMealInputSchema,
  "life.add_intake":addIntakeInputSchema,
  "life.remove_intake":removeIntakeInputSchema,
  "life.add_meal_payment":addMealPaymentInputSchema,
  "life.attach_meal_source":attachMealSourceInputSchema,
  "life.set_personal_alias":setPersonalAliasInputSchema,
  "life.record_purchase": recordPurchaseInputSchema,
  "life.correct_intake": correctIntakeInputSchema,
  "life.correct_purchase": correctPurchaseInputSchema,
  "life.void_purchase": voidRecordInputSchema,
  "life.link_meal_consumption":linkMealConsumptionInputSchema,
  "life.save_meal_template":saveMealTemplateInputSchema,
  "life.record_meal_from_template":recordMealFromTemplateInputSchema,
  "money.record_entry": recordMoneyEntryInputSchema,
  "money.record_refund": recordRefundInputSchema,
  "money.correct_entry": correctMoneyEntryInputSchema,
  "money.void_entry": voidRecordInputSchema,
  "money.set_budget": setBudgetInputSchema,
  "money.set_recurring_plan": setRecurringPlanInputSchema,
  "money.set_spending_intent":setSpendingIntentInputSchema,
  "money.set_use_cycle":setUseCycleInputSchema,
  "money.set_occurrence_state":setRecurringOccurrenceInputSchema,
  "health.record_measurement": recordHealthMeasurementInputSchema,
  "health.ingest_raw": ingestHealthRawInputSchema,
  "health.ingest_batch": ingestHealthBatchInputSchema,
  "health.set_source_state":setHealthSourceStateInputSchema,
  "health.set_plan":setHealthPlanInputSchema,
  "travel.create_trip": createTripInputSchema,
  "travel.correct_trip":correctTripInputSchema,
  "travel.add_reservation": addReservationInputSchema,
  "travel.correct_reservation":correctReservationInputSchema,
  "travel.void_reservation":voidReservationInputSchema,
  "travel.record_segment":recordTripSegmentInputSchema,
  "travel.record_visit": recordVisitInputSchema,
  "travel.save_place":savePlaceInputSchema,
  "travel.set_day_plan":setTripDayPlanInputSchema,
  "travel.set_member":setTripMemberInputSchema,
  "travel.publish_plan":publishTripPlanInputSchema,
  "travel.start_run":startTripRunInputSchema,
  "travel.set_stop_outcome":setTripStopOutcomeInputSchema,
  "library.capture": captureLibraryItemInputSchema,
  "library.revise":reviseLibraryItemInputSchema,
  "library.annotate":annotateLibraryItemInputSchema,
  "library.register_derivation":registerLibraryDerivationInputSchema
} as const;

export const writeCapabilityNameSchema = z.enum(Object.keys(writeCommandSchemas) as [keyof typeof writeCommandSchemas, ...(keyof typeof writeCommandSchemas)[]]);
export const universalCommandEnvelopeSchema = z.object({
  protocol: z.literal("shadow.command"), capability: writeCapabilityNameSchema,
  command_id: commandId, input: z.unknown()
}).strict().transform((command, context) => {
  const schema=writeCommandSchemas[command.capability];
  const parsed = schema.safeParse(command.input);
  if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ["input", ...issue.path] }); return z.NEVER; }
  return { ...command, input: parsed.data };
});

export const resourceReferenceSchema = z.object({
  type: z.enum(["meal", "meal_template", "personal_alias", "intake_item", "consumption_record", "purchase", "purchase_item", "money_entry", "refund", "budget", "recurring_plan", "recurring_occurrence", "spending_intent", "use_cycle", "health_measurement", "health_raw", "health_sync_cursor", "health_plan", "trip", "trip_segment", "reservation", "visit", "place", "trip_day_plan", "trip_member", "trip_plan_version", "trip_run", "trip_stop_outcome", "library_item", "library_annotation", "library_derivation", "source", "thread", "run", "task"]),
  id: stableId,
  revision: z.number().int().positive()
}).strict();

export const executionResultSchema = z.object({
  protocol: z.literal("shadow.execution-result"),
  capability: writeCapabilityNameSchema,
  command_id: commandId,
  execution_id: stableId,
  status: z.literal("committed"),
  result_kind: z.enum(["record", "plan", "task"]),
  resources: z.array(resourceReferenceSchema).min(1),
  actual_values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  warnings: z.array(z.string()),
  replayed: z.boolean()
}).strict();

export const operationErrorSchema = z.object({
  protocol: z.literal("shadow.error"),
  code: z.enum(["missing_fact", "validation", "conflict", "permission_denied", "confirmation_required", "retryable_not_applied", "outcome_unknown", "not_found"]),
  message: z.string(),
  fields: z.array(z.string()).optional(),
  execution_id: stableId.optional()
}).strict();

export const mealViewSchema = z.object({
  id: stableId,
  occurred_on: localDate,
  occurred_at: instant.nullable(),
  time_zone: ianaTimeZone,
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]),
  note: z.string().nullable(),
  revision: z.number().int().positive(),
  items: z.array(z.object({ id: stableId, name: z.string(), food_ref_id:stableId.nullable(),free_text:z.string().nullable(),quantity: canonicalDecimal.nullable(), unit: z.string().nullable(),amount_g:canonicalDecimal.nullable(), energy_kcal: canonicalDecimal.nullable(),protein_g:canonicalDecimal.nullable(),fat_g:canonicalDecimal.nullable(),carb_g:canonicalDecimal.nullable(),fiber_g:canonicalDecimal.nullable(),sodium_mg:canonicalDecimal.nullable(),consumed_fraction:canonicalDecimal.nullable(),provenance:z.string().nullable(),grouping_origin:z.string().nullable(), estimate: z.boolean(), revision: z.number().int().positive() }).strict()),
  payments: z.array(z.object({ id: stableId, amount: cnyAmount, currency: z.literal("CNY"),payment_method:paymentMethodSchema.nullable() }).strict()),
  source_ids: z.array(stableId)
}).strict();

export const moneySummarySchema = z.object({
  currency: z.literal("CNY"),
  expense_total: cnyAmount.or(z.literal("0.00")),
  entries: z.number().int().nonnegative(),
  as_of: instant,
  totals: z.array(z.object({currency:currencyCode,gross_expense:storedAmount,refund:storedAmount,net_spending:signedStoredAmount,income:storedAmount,net_cashflow:signedStoredAmount,entries:z.number().int().nonnegative()}).strict())
}).strict();

export const listMealsInputSchema = z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict();
export const listMealsResultSchema = z.object({ items: z.array(mealViewSchema) }).strict();
export const moneySummaryInputSchema = z.object({}).strict();
export const domainRecordsInputSchema=z.object({query:z.string().trim().min(1).max(200).optional(),limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(1_000).optional()}).strict();
export const domainRecordsResultSchema=z.object({items:z.array(z.record(z.string(),z.unknown())),next_cursor:z.string().nullable(),as_of:instant}).strict();
export const lifeOverviewDomainSchema=z.enum(["meals","money","health","travel","library"]);
export const lifeTodayInputSchema=z.object({date:localDate,time_zone:ianaTimeZone,domains:z.array(lifeOverviewDomainSchema).min(1).max(5).optional()}).strict();
export const lifeTodayResultSchema=z.object({date:localDate,domains:z.object({
  meals:z.object({count:z.number().int().nonnegative(),freshness:instant.nullable()}).strict().optional(),
  money:z.object({entries:z.number().int().nonnegative(),totals:z.array(z.object({currency:currencyCode,gross_expense:storedAmount,refund:storedAmount,income:storedAmount,net_spending:signedStoredAmount,net_cashflow:signedStoredAmount}).strict()),freshness:instant.nullable()}).strict().optional(),
  health:z.object({facts:z.number().int().nonnegative(),freshness:instant.nullable()}).strict().optional(),
  travel:z.object({visits:z.number().int().nonnegative(),freshness:instant.nullable()}).strict().optional(),
  library:z.object({captured:z.number().int().nonnegative(),freshness:instant.nullable()}).strict().optional()
}).strict(),as_of:instant}).strict();
export const lifeTimelineInputSchema=z.object({domains:z.array(lifeOverviewDomainSchema).min(1).max(5).optional(),limit:z.number().int().min(1).max(100).default(30),cursor:z.string().max(1_000).optional()}).strict();
export const lifeTimelineItemSchema=z.object({domain:lifeOverviewDomainSchema,kind:z.string(),id:stableId,happened_at:instant,title:z.string(),amount:storedAmount.optional(),currency:currencyCode.optional(),record_id:stableId.optional()}).strict();
export const lifeTimelineResultSchema=z.object({items:z.array(lifeTimelineItemSchema),next_cursor:z.string().nullable(),as_of:instant}).strict();
export const lifeRecordSectionSchema=z.enum(["meal","purchase","money","sources"]);
export const lifeRecordInputSchema=z.object({id:stableId,sections:z.array(lifeRecordSectionSchema).min(1).max(4).optional()}).strict();
export const resourceDetailInputSchema=z.object({id:stableId}).strict();
export const moneyPlanningInputSchema=z.object({period:z.string().regex(/^(?:0{3}[1-9]|0{2}[1-9]\d|0[1-9]\d{2}|[1-9]\d{3})-(0[1-9]|1[0-2])$/u)}).strict();
export const healthDailyInputSchema=z.object({date:localDate}).strict();
export const resourceDetailResultSchema=z.record(z.string(),z.unknown());
export const healthTrendInputSchema=z.object({metric_key:z.string().trim().min(1).max(100),from:localDate.optional(),to:localDate.optional(),limit:z.number().int().min(2).max(1000).default(100)}).strict().refine(value=>!value.from||!value.to||value.to>=value.from,{path:["to"],message:"to must not be before from"});
export const healthTrendResultSchema=z.object({metric_key:z.string(),points:z.array(z.object({id:stableId,occurred_on:localDate,value:canonicalDecimal,unit:z.string(),source_kind:z.string(),revision:z.number().int().positive()}).strict()),coverage:z.object({from:localDate.nullable(),to:localDate.nullable(),points:z.number().int().nonnegative(),truncated:z.boolean()}).strict(),as_of:instant}).strict();
export const healthSourcesInputSchema=z.object({}).strict();
export const healthSourcesResultSchema=z.object({items:z.array(z.object({id:stableId,source_type:z.string(),instance_key:z.string(),permission_state:z.string(),sync_epoch:z.number().int().positive(),fingerprint:z.string().nullable(),cursors:z.array(z.object({device_id:z.string(),record_type:z.string(),cursor:z.string().nullable(),state:z.string(),sync_epoch:z.number().int().positive(),updated_at:instant}).strict())}).strict()),as_of:instant}).strict();
export const getOperationInputSchema = z.object({ execution_id: stableId }).strict();

export type RecordMealInput = z.infer<typeof recordMealInputSchema>;
export type LifeOverviewDomain = z.infer<typeof lifeOverviewDomainSchema>;
export type LifeTimelineItem = z.infer<typeof lifeTimelineItemSchema>;
export type RecordMealCommand = z.infer<typeof recordMealCommandEnvelopeSchema>;
export type WriteCapabilityName = z.infer<typeof writeCapabilityNameSchema>;
export type UniversalCommandEnvelope = z.infer<typeof universalCommandEnvelopeSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type ExecutionResult = z.infer<typeof executionResultSchema>;
export type OperationError = z.infer<typeof operationErrorSchema>;
export type MealView = z.infer<typeof mealViewSchema>;
export type MoneySummary = z.infer<typeof moneySummarySchema>;

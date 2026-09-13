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
export const saveFoodInputSchema=z.object({food_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),name:z.string().trim().min(1).max(200),serving_amount:positiveDecimal.optional(),serving_unit:z.string().trim().min(1).max(32).optional(),nutrients:z.object({energy_kcal:canonicalDecimal.optional(),protein_g:canonicalDecimal.optional(),fat_g:canonicalDecimal.optional(),carb_g:canonicalDecimal.optional(),fiber_g:canonicalDecimal.optional(),sodium_mg:canonicalDecimal.optional()}).strict().default({}),provenance:z.string().trim().min(1).max(500).optional(),state:z.enum(["active","archived"]).default("active"),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.food_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"food_id and expected_revision must be supplied together"});if((value.serving_amount===undefined)!==(value.serving_unit===undefined))context.addIssue({code:"custom",message:"serving_amount and serving_unit must be supplied together"});if(value.food_id!==undefined&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"updating a food needs a reason"});if(value.food_id===undefined&&value.reason!==undefined)context.addIssue({code:"custom",path:["reason"],message:"reason is only accepted when updating a food"});});
export const saveRecipeInputSchema=z.object({recipe_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),title:z.string().trim().min(1).max(200),servings:positiveDecimal,items:z.array(intakeItemInputSchema).min(1).max(100),instructions:z.string().trim().min(1).max(20_000).optional(),state:z.enum(["active","archived"]).default("active"),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.recipe_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"recipe_id and expected_revision must be supplied together"});if(value.recipe_id!==undefined&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"updating a recipe needs a reason"});if(value.recipe_id===undefined&&value.reason!==undefined)context.addIssue({code:"custom",path:["reason"],message:"reason is only accepted when updating a recipe"});});
export const recordMealFromRecipeInputSchema=z.object({recipe_id:stableId,expected_recipe_revision:z.number().int().positive(),occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),consumed_fraction:positiveDecimal.refine(value=>Number(value)<=1,"must be at most one"),note:z.string().trim().min(1).max(2_000).optional()}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
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
export const setRecurringOccurrenceInputSchema=z.object({occurrence_id:stableId,expected_revision:z.number().int().positive(),state:z.enum(["pending","reminded","handled","dismissed","snoozed"]),effective_due_on:localDate.optional(),snoozed_until:instant.optional(),linked_record_id:stableId.optional(),feedback:z.record(z.string(),z.json()).default({})}).strict().superRefine((value,context)=>{if(value.state==="snoozed"&&value.snoozed_until===undefined)context.addIssue({code:"custom",path:["snoozed_until"],message:"snoozed state requires snoozed_until"});if(value.state!=="snoozed"&&value.snoozed_until!==undefined)context.addIssue({code:"custom",path:["snoozed_until"],message:"only snoozed state accepts snoozed_until"});});
export const moneyPlanningResultSchema=z.object({period:z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),window:z.object({start_on:localDate,end_on_exclusive:z.string().regex(/^\d{4,5}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u)}).strict(),budgets:z.array(z.object({id:stableId,category:z.string().nullable(),amount:storedAmount,currency:currencyCode,revision:z.number().int().positive(),spent_basis:z.literal("gross_expense"),spent:storedAmount}).strict()),recurring_plans:z.array(z.object({id:stableId,title:z.string(),amount:storedAmount.nullable(),currency:currencyCode,cadence:z.enum(["daily","weekly","monthly","yearly","interval"]),next_due_on:localDate,category:z.string().nullable(),active:z.boolean(),revision:z.number().int().positive(),time_zone:ianaTimeZone,interval_days:z.number().int().positive().nullable(),state:z.enum(["active","paused","ended"]),ended_on:localDate.nullable(),anchor_on:localDate,local_time:z.string().nullable(),missing_date_policy:z.enum(["skip","last_day"]),recurrence_rule:z.string()}).strict()),occurrences:z.array(z.object({id:stableId,plan_id:stableId,due_on:localDate,original_due_on:localDate,effective_due_on:localDate,state:z.enum(["pending","reminded","handled","dismissed","snoozed"]),linked_record_id:stableId.nullable(),feedback:z.record(z.string(),z.unknown()),snoozed_until:instant.nullable(),revision:z.number().int().positive()}).strict()),spending_intents:z.array(z.object({id:stableId,title:z.string(),expected_amount:storedAmount.nullable(),currency:currencyCode.nullable(),intended_on:localDate.nullable(),state:z.enum(["planned","purchased","cancelled"]),linked_record_id:stableId.nullable(),revision:z.number().int().positive()}).strict()),use_cycles:z.array(z.object({id:stableId,purchase_record_id:stableId.nullable(),item_name:z.string(),started_on:localDate,ended_on:localDate.nullable(),state:z.enum(["active","completed","discarded"]),revision:z.number().int().positive()}).strict()),limits:z.object({budgets:z.number().int().positive(),recurring_plans:z.number().int().positive(),occurrences:z.number().int().positive(),spending_intents:z.number().int().positive(),use_cycles:z.number().int().positive()}).strict(),truncated:z.object({budgets:z.boolean(),recurring_plans:z.boolean(),occurrences:z.boolean(),spending_intents:z.boolean(),use_cycles:z.boolean()}).strict(),as_of:instant}).strict();
export const stageMoneyImportInputSchema=z.object({format:z.enum(["csv","json","markdown"]),source_name:z.string().trim().min(1).max(200),content:z.string().min(1).max(900_000),time_zone:ianaTimeZone}).strict();
export const moneyImportCorrectionSchema=z.object({entry_type:z.enum(["expense","income","refund"]).optional(),amount:cnyAmount.optional(),currency:z.literal("CNY").optional(),occurred_on:localDate.optional(),time_zone:ianaTimeZone.optional(),counterparty:z.string().trim().min(1).max(200).nullable().optional(),category:z.string().trim().min(1).max(80).nullable().optional(),payment_method:paymentMethodSchema.nullable().optional(),note:z.string().trim().min(1).max(2_000).nullable().optional()}).strict();
export const moneyImportRuleReplacementsSchema=z.object({entry_type:z.enum(["expense","income"]).optional(),counterparty:z.string().trim().min(1).max(200).optional(),category:z.string().trim().min(1).max(80).optional(),payment_method:paymentMethodSchema.optional()}).strict().refine(value=>Object.keys(value).length>0,{message:"an import rule needs at least one replacement"});
export const setMoneyImportRuleInputSchema=z.object({rule_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),match_value:z.string().trim().min(1).max(200),replacements:moneyImportRuleReplacementsSchema,state:z.enum(["active","disabled"]).default("active")}).strict().superRefine((value,context)=>{if((value.rule_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"rule_id and expected_revision must be supplied together"});});
export const resolveMoneyImportCandidateInputSchema=z.object({candidate_id:stableId,expected_revision:z.number().int().positive(),decision:z.enum(["confirm","ignore"]),corrections:moneyImportCorrectionSchema.optional(),original_entry_id:stableId.optional(),remember_rule:z.boolean().default(false),reason:z.string().trim().min(1).max(500)}).strict().superRefine((value,context)=>{if(value.decision==="ignore"&&(value.corrections||value.original_entry_id||value.remember_rule))context.addIssue({code:"custom",message:"ignored candidates cannot carry accounting corrections or remember a rule"});});

export const recordHealthMeasurementInputSchema = datedFactSchema.extend({
  metric: z.enum(["weight", "body_fat", "heart_rate", "blood_pressure_systolic", "blood_pressure_diastolic", "temperature", "sleep_duration", "steps", "custom"]),
  value: canonicalDecimal,
  unit: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(100).optional()
}).strict().refine(factDateMatches, { path:["occurred_at"], message:"occurred_at does not fall on occurred_on in time_zone" });
export const correctHealthMeasurementInputSchema=z.object({measurement_id:stableId,expected_revision:z.number().int().positive(),metric:z.enum(["weight","body_fat","heart_rate","blood_pressure_systolic","blood_pressure_diastolic","temperature","sleep_duration","steps","custom"]),value:canonicalDecimal,unit:z.string().trim().min(1).max(32),label:z.string().trim().min(1).max(100).optional(),occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,note:z.string().trim().min(1).max(2_000).optional(),reason:z.string().trim().min(1).max(500)}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
export const ingestHealthRawInputSchema=z.object({source_type:z.enum(["health_connect","scale","samsung","file_import","legacy_health"]),source_instance_key:z.string().trim().min(1).max(200),source_fingerprint:z.string().min(1).max(256),record_type:z.enum(["body","wellbeing","sleep","workout","daily_activity","steps_interval","habit","lab","fitness_test"]),client_record_id:z.string().min(1).max(256),provider_record_id:z.string().min(1).max(256).optional(),record_version:z.number().int().nonnegative(),sync_epoch:z.number().int().positive(),change_kind:z.enum(["upsert","delete"]),payload:z.json().optional(),parse_version:z.string().min(1).max(64)}).strict().superRefine((value,context)=>{if(value.change_kind==="upsert"&&value.payload===undefined)context.addIssue({code:"custom",path:["payload"],message:"upsert needs payload"});if(value.change_kind==="delete"&&value.payload!==undefined)context.addIssue({code:"custom",path:["payload"],message:"delete must not invent payload"});});
export const ingestHealthBatchInputSchema=z.object({source_type:z.enum(["health_connect","scale","samsung","file_import","legacy_health"]),source_instance_key:z.string().trim().min(1).max(200),source_fingerprint:z.string().min(1).max(256),device_id:z.string().trim().min(1).max(200),record_type:z.enum(["body","wellbeing","sleep","workout","daily_activity","steps_interval","habit","lab","fitness_test"]),permission_fingerprint:z.string().min(1).max(256),sync_epoch:z.number().int().positive(),previous_cursor:z.string().max(4_000).nullable(),next_cursor:z.string().min(1).max(4_000),rescan:z.object({generation:stableId,window_start:instant,window_end:instant,complete:z.literal(true)}).strict().refine(value=>Date.parse(value.window_end)>Date.parse(value.window_start),{message:"rescan window must be nonempty"}).optional(),parse_version:z.string().min(1).max(64),records:z.array(z.object({client_record_id:z.string().min(1).max(256),provider_record_id:z.string().min(1).max(256).optional(),record_version:z.number().int().nonnegative(),change_kind:z.enum(["upsert","delete"]),payload:z.json().optional()}).strict().superRefine((value,context)=>{if(value.change_kind==="upsert"&&value.payload===undefined)context.addIssue({code:"custom",path:["payload"],message:"upsert needs payload"});if(value.change_kind==="delete"&&value.payload!==undefined)context.addIssue({code:"custom",path:["payload"],message:"delete must not invent payload"});})).max(1_000)}).strict().superRefine((value,context)=>{if(value.rescan&&(value.source_type!=="health_connect"||value.records.some(record=>record.change_kind!=="upsert")||new Set(value.records.map(record=>record.client_record_id)).size!==value.records.length))context.addIssue({code:"custom",path:["rescan"],message:"complete rescan requires distinct Health Connect upserts"});});
export const setHealthSourceStateInputSchema=z.object({source_type:z.enum(["health_connect","scale","samsung","file_import","legacy_health"]),source_instance_key:z.string().trim().min(1).max(200),source_fingerprint:z.string().min(1).max(256),sync_epoch:z.number().int().positive(),permission_state:z.enum(["granted","revoked","expired","rescan_required"]),reason:z.string().trim().min(1).max(500).optional()}).strict();
export const setHealthPlanInputSchema=z.object({plan_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),kind:z.enum(["habit","goal","workout"]),name:z.string().trim().min(1).max(200),state:z.enum(["active","paused","ended","achieved","cancelled"]),schedule:z.json().optional(),detail:z.json().optional(),metric_key:z.string().trim().min(1).max(100).optional(),target_value:canonicalDecimal.optional(),unit:z.string().trim().min(1).max(32).optional(),due_on:localDate.optional()}).strict().superRefine((value,context)=>{if((value.plan_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"plan_id and expected_revision must be supplied together"});if(value.kind==="goal"&&(!value.metric_key||!value.target_value||!value.unit))context.addIssue({code:"custom",message:"goal needs metric_key, target_value and unit"});if(value.kind!=="goal"&&!value.schedule)context.addIssue({code:"custom",message:"habit and workout need schedule"});if(value.kind==="goal"&&!(["active","achieved","cancelled"] as string[]).includes(value.state))context.addIssue({code:"custom",path:["state"],message:"goal state must be active, achieved, or cancelled"});if(value.kind!=="goal"&&!(["active","paused","ended"] as string[]).includes(value.state))context.addIssue({code:"custom",path:["state"],message:"habit and workout state must be active, paused, or ended"});});
export const healthObservationMetricSchema=z.enum(["weight","body_fat","muscle_mass","skeletal_muscle","body_water","visceral_fat","bmr","impedance_low","impedance_high","waist","chest","hip","heart_rate","blood_pressure_systolic","blood_pressure_diastolic","temperature","spo2","blood_glucose","lab_value","fitness_value"]);
const healthProjectionTimeSchema=z.object({occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone}).strict().refine(factDateMatches,{path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});
export const healthObservationPayloadSchema=healthProjectionTimeSchema.extend({group_kind:z.enum(["measurement","legacy_daily_form","lab_report","fitness_test"]).default("measurement"),observations:z.array(z.object({metric_key:healthObservationMetricSchema,value:canonicalDecimal,unit:z.string().trim().min(1).max(32),original_field:z.string().trim().min(1).max(100).optional(),autofilled:z.boolean().default(false)}).strict()).min(1).max(100)}).strict();
export const healthWellbeingPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,mood_score:z.number().int().min(0).max(10).nullable().optional(),energy_level:z.number().int().min(0).max(10).nullable().optional(),sleep_quality:z.number().int().min(0).max(10).nullable().optional(),morning_erection:z.boolean().nullable().optional(),notes:z.string().max(2_000).nullable().optional()}).strict();
export const healthSleepPayloadSchema=z.object({wake_date:localDate,time_zone:ianaTimeZone,started_at:instant.optional(),ended_at:instant.optional(),total_minutes:z.number().int().nonnegative(),deep_minutes:z.number().int().nonnegative().optional(),light_minutes:z.number().int().nonnegative().optional(),rem_minutes:z.number().int().nonnegative().optional(),awake_minutes:z.number().int().nonnegative().optional()}).strict().refine(value=>!value.started_at||!value.ended_at||value.ended_at>=value.started_at,{path:["ended_at"],message:"ended_at must not be before started_at"});
export const healthWorkoutPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,session_type:z.string().trim().min(1).max(100),started_at:instant.optional(),duration_minutes:z.number().int().nonnegative().optional(),distance_km:canonicalDecimal.optional(),calories_kcal:canonicalDecimal.optional(),rpe:z.number().int().min(0).max(10).optional(),heart_rate_avg:z.number().int().positive().optional(),detail:z.json().optional()}).strict().refine(value=>factDateMatches({...value,occurred_at:value.started_at}),{path:["started_at"],message:"started_at does not fall on occurred_on in time_zone"});
export const recordWorkoutInputSchema=healthWorkoutPayloadSchema.extend({plan_id:stableId.optional()}).strict().refine(value=>factDateMatches({...value,occurred_at:value.started_at}),{path:["started_at"],message:"started_at does not fall on occurred_on in time_zone"});
export const healthDailyActivityPayloadSchema=z.object({occurred_on:localDate,time_zone:ianaTimeZone,step_interval:z.object({started_at:instant,ended_at:instant,data_origin:z.string().min(1).max(256)}).strict().optional(),steps:z.number().int().nonnegative().nullable().optional(),active_minutes:z.number().int().nonnegative().nullable().optional(),device_calories_kcal:canonicalDecimal.nullable().optional(),workout_calories_kcal:canonicalDecimal.nullable().optional(),field_sources:z.record(z.string(),z.string()).default({})}).strict().superRefine((value,context)=>{if(value.step_interval&&(value.steps==null||Date.parse(value.step_interval.ended_at)<=Date.parse(value.step_interval.started_at)||!factDateMatches({occurred_on:value.occurred_on,occurred_at:value.step_interval.started_at,time_zone:value.time_zone})))context.addIssue({code:"custom",path:["step_interval"],message:"step interval needs a count, increasing times and its local start date"});});
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
  visibility:z.enum(["shared","private"]).default("shared"),
  origin:z.string().trim().min(1).max(200).optional(), destination:z.string().trim().min(1).max(200).optional(), service_number:z.string().trim().min(1).max(100).optional(), seat:z.string().trim().min(1).max(100).optional(),
  fare:datedPaymentSchema.optional(),
  source: sourceInputSchema.optional()
}).strict().refine((value)=>!value.starts_at||!value.ends_at||value.ends_at>=value.starts_at,{path:["ends_at"],message:"ends_at must not be before starts_at"});
export const correctReservationInputSchema=z.object({reservation_id:stableId,expected_revision:z.number().int().positive(),reservation_type:z.enum(["flight","rail","hotel","restaurant","activity","other"]),title:z.string().trim().min(1).max(200),starts_at:instant.optional(),ends_at:instant.optional(),confirmation_code:z.string().trim().min(1).max(100).optional(),state:z.enum(["pending","waitlisted","confirmed","changed","cancelled","refunded"]),visibility:z.enum(["shared","private"]).default("shared"),origin:z.string().trim().min(1).max(200).optional(),destination:z.string().trim().min(1).max(200).optional(),service_number:z.string().trim().min(1).max(100).optional(),seat:z.string().trim().min(1).max(100).optional(),source:sourceInputSchema.optional(),reason:z.string().trim().min(1).max(500)}).strict().refine(value=>!value.starts_at||!value.ends_at||value.ends_at>=value.starts_at,{path:["ends_at"],message:"ends_at must not be before starts_at"});
export const voidReservationInputSchema=z.object({reservation_id:stableId,expected_revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();
export const recordTripSegmentInputSchema=z.object({trip_id:stableId,mode:z.enum(["walk","bike","taxi","car","bus","metro","rail","flight","ferry","other"]),origin:z.string().trim().min(1).max(200),destination:z.string().trim().min(1).max(200),starts_at:instant.optional(),ends_at:instant.optional(),distance_km:canonicalDecimal.optional(),note:z.string().trim().min(1).max(2_000).optional(),visibility:z.enum(["shared","private"]).default("shared"),source:sourceInputSchema.optional()}).strict().refine(value=>!value.starts_at||!value.ends_at||value.ends_at>=value.starts_at,{path:["ends_at"],message:"ends_at must not be before starts_at"});

export const recordVisitInputSchema = datedFactSchema.extend({
  place_name: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  trip_id: stableId.optional(),
  visibility:z.enum(["shared","private"]).default("private")
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
export const travelMapItemInputSchema=z.object({place_id:stableId,status:z.enum(["candidate","anchor","planned","visited"]),note:z.string().trim().min(1).max(1_000).optional()}).strict();
export const saveTravelMapInputSchema=z.object({map_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),title:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(2_000).optional(),state:z.enum(["active","archived"]).default("active"),items:z.array(travelMapItemInputSchema).max(200),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.map_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"map_id and expected_revision must be supplied together"});if(value.map_id&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"reason is required for an update"});if(new Set(value.items.map(item=>item.place_id)).size!==value.items.length)context.addIssue({code:"custom",path:["items"],message:"a place can occur only once in a map"});});
export const importTravelTrackInputSchema=z.object({trip_id:stableId,name:z.string().trim().min(1).max(200).optional(),gpx:z.string().min(1).max(900_000)}).strict();
export const travelWorkspaceInputSchema=z.object({trip_id:stableId.optional()}).strict();
export const travelExportInputSchema=z.object({trip_id:stableId,format:z.enum(["bundle","gpx","ics"])}).strict();
export const travelExportResultSchema=z.object({format:z.enum(["bundle","gpx","ics"]),mime_type:z.string(),filename:z.string(),sha256:z.string().regex(/^[0-9a-f]{64}$/u),content:z.string()}).strict();
const coordinateDecimal=z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,7})?$/u);
const portablePlaceSchema=z.object({id:stableId,name:z.string().trim().min(1).max(200),address:z.string().nullable(),latitude:coordinateDecimal.nullable(),longitude:coordinateDecimal.nullable(),tags:z.array(z.string().trim().min(1).max(64)).max(30),favorite:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict().refine(value=>(value.latitude===null)===(value.longitude===null),{message:"portable place coordinates must be supplied together"});
const portableMapSchema=z.object({id:stableId,title:z.string().trim().min(1).max(200),description:z.string().nullable(),state:z.enum(["active","archived"]),revision:z.number().int().positive(),updated_at:instant,items:z.array(z.object({place_id:stableId,position:z.number().int().nonnegative(),status:z.enum(["candidate","anchor","planned","visited"]),note:z.string().nullable()}).strict()).max(200)}).strict();
const portableReservationSchema=z.object({id:stableId,trip_id:stableId,reservation_type:z.enum(["flight","rail","hotel","restaurant","activity","other"]),title:z.string().trim().min(1).max(200),starts_at:instant.nullable(),ends_at:instant.nullable(),state:z.enum(["pending","waitlisted","confirmed","changed","cancelled","refunded"]),visibility:z.enum(["shared","private"]),origin:z.string().nullable(),destination:z.string().nullable(),service_number:z.string().nullable(),revision:z.number().int().positive(),created_at:instant,confirmation_code:z.string().nullable().optional(),seat:z.string().nullable().optional(),fare_entry_id:stableId.nullable().optional(),source_id:stableId.nullable().optional()}).strict();
const portableSegmentSchema=z.object({id:stableId,trip_id:stableId,mode:z.enum(["walk","bike","taxi","car","bus","metro","rail","flight","ferry","other"]),origin:z.string(),destination:z.string(),starts_at:instant.nullable(),ends_at:instant.nullable(),distance_km:canonicalDecimal.nullable(),visibility:z.enum(["shared","private"]),revision:z.number().int().positive(),voided_at:instant.nullable(),created_at:instant,source_id:stableId.nullable().optional(),note:z.string().nullable().optional()}).strict();
const portableVisitSchema=z.object({id:stableId,trip_id:stableId,place_name:z.string(),latitude:coordinateDecimal.nullable(),longitude:coordinateDecimal.nullable(),occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,visibility:z.enum(["shared","private"]),revision:z.number().int().positive(),created_at:instant,source_id:stableId.nullable().optional(),note:z.string().nullable().optional()}).strict();
const portableDayPlanSchema=z.object({id:stableId,trip_id:stableId,plan_date:localDate,items:z.array(tripPlanItemSchema.extend({stop_id:stableId})).max(100),revision:z.number().int().positive(),created_at:instant}).strict();
const portablePlanVersionSchema=z.object({id:stableId,trip_id:stableId,version:z.number().int().positive(),label:z.string().nullable(),note:z.string().nullable(),snapshot:z.unknown(),content_hash:z.string().regex(/^[0-9a-f]{64}$/u),created_at:instant}).strict();
const portableTrackSchema=z.object({id:stableId,trip_id:stableId,name:z.string().trim().min(1).max(200),points:z.array(z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),elevation_m:z.number().finite().optional(),recorded_at:instant.optional()}).strict()).min(1).max(10_000),original_sha256:z.string().regex(/^[0-9a-f]{64}$/u),created_at:instant}).strict();
const publishedTripPlanSchema=z.object({days:z.array(z.object({plan_date:localDate,items:z.array(tripPlanItemSchema.extend({stop_id:stableId})).max(100)}).strict()).max(366),stop_count:z.number().int().positive()}).strict();
export const travelWorkspaceResultSchema=z.object({
  places:z.array(portablePlaceSchema).max(200),maps:z.array(portableMapSchema).max(100),
  trips:z.array(z.object({id:stableId,title:z.string(),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone,revision:z.number().int().positive(),is_owner:z.boolean(),role:z.enum(["owner","editor","viewer"]).nullable(),visibility:z.enum(["shared","private"]).nullable(),latest_plan_version_id:stableId.nullable()}).strict()).max(50),
  selected_trip_id:stableId.nullable(),
  active_run:z.object({id:stableId,trip_id:stableId,plan_version_id:stableId,state:z.literal("active"),started_at:instant,completed_at:instant.nullable(),plan_snapshot:publishedTripPlanSchema,plan_version:z.number().int().positive(),outcomes:z.array(z.object({stop_id:stableId,state:z.enum(["arrived","skipped"]),occurred_at:instant.nullable(),note:z.string().nullable(),revision:z.number().int().positive(),updated_at:instant}).strict()).max(1_000)}).strict().nullable(),
  tracks:z.array(portableTrackSchema).max(100),day_plans:z.array(portableDayPlanSchema).max(366),
  segments:z.array(z.object({id:stableId,trip_id:stableId,mode:z.enum(["walk","bike","taxi","car","bus","metro","rail","flight","ferry","other"]),origin:z.string(),destination:z.string(),starts_at:instant.nullable(),ends_at:instant.nullable(),distance_km:canonicalDecimal.nullable(),note:z.string().nullable(),visibility:z.enum(["shared","private"]),revision:z.number().int().positive()}).strict()).max(1_000),
  as_of:instant
}).strict();
const tripDetailTripSchema=z.object({id:stableId,title:z.string(),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone,note:z.string().nullable(),revision:z.number().int().positive(),created_at:instant}).strict();
export const travelTripResultSchema=z.object({
  trip:tripDetailTripSchema,
  reservations:z.array(portableReservationSchema).max(500),
  segments:z.array(portableSegmentSchema).max(1_000),
  visits:z.array(portableVisitSchema).max(1_000),
  day_plans:z.array(portableDayPlanSchema).max(366),
  members:z.array(z.object({member_id:stableId,role:z.enum(["owner","editor","viewer"]),visibility:z.enum(["shared","private"]),created_at:instant}).strict()).max(100),
  plan_versions:z.array(z.object({id:stableId,trip_id:stableId,version:z.number().int().positive(),label:z.string().nullable(),note:z.string().nullable(),snapshot:publishedTripPlanSchema,content_hash:z.string().regex(/^[0-9a-f]{64}$/u),created_at:instant}).strict()).max(100),
  my_runs:z.array(z.object({id:stableId,trip_id:stableId,plan_version_id:stableId,state:z.enum(["active","completed","abandoned"]),started_at:instant,completed_at:instant.nullable(),outcomes:z.array(z.object({stop_id:stableId,state:z.enum(["arrived","skipped"]),occurred_at:instant.nullable(),note:z.string().nullable(),revision:z.number().int().positive(),updated_at:instant}).strict()).max(1_000)}).strict()).max(100),
  revisions:z.array(z.object({trip_id:stableId,revision:z.number().int().positive(),snapshot:tripDetailTripSchema,reason:z.string(),created_at:instant}).strict()).max(1_000),
  as_of:instant
}).strict();
export const travelBundleSchema=z.object({format:z.literal("shadow-life.travel-bundle.v1"),exported_trip:z.object({trip:z.object({id:stableId,title:z.string().trim().min(1).max(200),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone,note:z.string().nullable().optional(),revision:z.number().int().positive()}).strict(),places:z.array(portablePlaceSchema).max(200).default([]),maps:z.array(portableMapSchema).max(100).default([]),reservations:z.array(portableReservationSchema).max(500),segments:z.array(portableSegmentSchema).max(1_000),visits:z.array(portableVisitSchema).max(1_000),day_plans:z.array(portableDayPlanSchema).max(366),plan_versions:z.array(portablePlanVersionSchema).max(100),tracks:z.array(portableTrackSchema).max(100)}).strict()}).strict();
export const previewTravelPortableInputSchema=z.object({format:z.enum(["gpx","bundle"]),content:z.string().min(1).max(900_000)}).strict();
export const previewTravelPortableResultSchema=z.discriminatedUnion("format",[
  z.object({format:z.literal("gpx"),sha256:z.string().regex(/^[0-9a-f]{64}$/u),name:z.string().nullable(),points:z.number().int().positive(),bounds:z.object({south:z.number(),west:z.number(),north:z.number(),east:z.number()}).strict()}).strict(),
  z.object({format:z.literal("bundle"),sha256:z.string().regex(/^[0-9a-f]{64}$/u),trip:z.object({id:stableId,title:z.string(),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone}).strict(),counts:z.object({places:z.number().int().nonnegative(),maps:z.number().int().nonnegative(),reservations:z.number().int().nonnegative(),segments:z.number().int().nonnegative(),visits:z.number().int().nonnegative(),day_plans:z.number().int().nonnegative(),plan_versions:z.number().int().nonnegative(),tracks:z.number().int().nonnegative()}).strict()}).strict()
]);
export const restoreTravelBundleInputSchema=z.object({bundle:z.string().min(1).max(900_000),title:z.string().trim().min(1).max(200).optional()}).strict();

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
export const queueLibraryProcessingInputSchema=z.object({item_id:stableId,source_asset_version_id:stableId,kind:z.enum(["text_extract","ocr","transcript"]),requested_processor:z.string().trim().min(1).max(100)}).strict();
export const retryLibraryProcessingInputSchema=z.object({job_id:stableId}).strict();
export const claimLibraryProcessingInputSchema=z.object({job_id:stableId,expected_attempt:z.number().int().min(0)}).strict();
export const renewLibraryProcessingInputSchema=z.object({job_id:stableId,attempt:z.number().int().positive()}).strict();
export const failLibraryProcessingInputSchema=z.object({job_id:stableId,attempt:z.number().int().positive(),error:z.string().trim().min(1).max(2_000)}).strict();
export const completeLibraryProcessingInputSchema=z.object({job_id:stableId,attempt:z.number().int().positive(),derived_asset_version_id:stableId,processor_version:z.string().trim().min(1).max(100),snippets:z.array(z.object({text:z.string().trim().min(1).max(20_000),locator:z.json()}).strict()).min(1).max(500)}).strict();
export const libraryProcessingQueueInputSchema=z.object({kind:z.enum(["text_extract","ocr","transcript"]).optional(),limit:z.number().int().min(1).max(100).default(20)}).strict();
export const libraryProcessingQueueResultSchema=z.object({items:z.array(z.object({id:stableId,item_id:stableId,source_asset_version_id:stableId,kind:z.enum(["text_extract","ocr","transcript"]),requested_processor:z.string().nullable(),state:z.enum(["queued","running"]),attempts:z.number().int().nonnegative(),lease_expires_at:instant.nullable(),created_at:instant,title:z.string(),media_type:z.string(),sha256:z.string().regex(/^[0-9a-f]{64}$/u),byte_size:z.string().regex(/^\d+$/u)}).strict()).max(100),as_of:instant}).strict();
export const libraryItemResultSchema=z.object({
  item:z.object({id:stableId,title:z.string(),item_type:z.string(),current_revision:z.number().int().positive(),source_id:stableId.nullable(),state:z.enum(["active","deleted"]),created_at:instant}).strict(),
  revisions:z.array(z.object({item_id:stableId,revision:z.number().int().positive(),text:z.string().nullable(),url:z.string().nullable(),tags:z.array(z.string()),reason:z.string().nullable(),created_at:instant}).strict()),
  sources:z.array(z.object({source:z.object({id:stableId,kind:z.string(),external_id:z.string().nullable(),captured_on:localDate.nullable(),captured_at:instant.nullable(),time_zone:z.string().nullable(),original_text:z.string().nullable(),asset_version_id:stableId.nullable(),revision:z.number().int().positive()}).strict(),asset:z.object({id:stableId,asset_id:stableId,media_type:z.string(),sha256:z.string().regex(/^[0-9a-f]{64}$/u),byte_size:z.string().regex(/^\d+$/u),created_at:instant}).strict().nullable()}).strict()),
  annotations:z.array(z.object({id:stableId,item_id:stableId,anchor:z.json(),note:z.string(),revision:z.number().int().positive(),created_at:instant}).strict()),
  derivations:z.array(z.object({id:stableId,item_id:stableId,source_asset_version_id:stableId,derived_asset_version_id:stableId,kind:z.string(),processor_version:z.string(),created_at:instant}).strict()),
  proofs:z.array(z.object({id:stableId,item_id:stableId,revision:z.number().int().positive(),content_hash:z.string().regex(/^[0-9a-f]{64}$/u),asset_hashes:z.array(z.string().regex(/^[0-9a-f]{64}$/u)),created_at:instant}).strict()),
  processing_jobs:z.array(z.object({id:stableId,item_id:stableId,source_asset_version_id:stableId,kind:z.enum(["text_extract","ocr","transcript"]),requested_processor:z.string(),state:z.enum(["queued","running","completed","failed"]),attempts:z.number().int().nonnegative(),derived_asset_version_id:stableId.nullable(),processor_version:z.string().nullable(),last_error:z.string().nullable(),started_at:instant.nullable(),finished_at:instant.nullable(),lease_expires_at:instant.nullable(),created_at:instant,updated_at:instant}).strict()),
  snippets:z.array(z.object({id:stableId,item_id:stableId,job_id:stableId,item_revision:z.number().int().positive(),ordinal:z.number().int().nonnegative(),text:z.string(),locator:z.json(),created_at:instant}).strict()),
  reading_state:z.object({item_id:stableId,item_revision:z.number().int().positive(),locator:z.json(),progress:z.number().min(0).max(1),state:z.enum(["active","completed"]),updated_at:instant}).strict().nullable(),
  legacy_links:z.array(z.object({id:stableId,item_id:stableId,legacy_uri:z.string(),algorithm:z.enum(["ed25519-sha256-ascii-v1","legacy-unverified"]),source_asset_version_id:stableId.nullable(),signed_content_sha256:z.string().regex(/^[0-9a-f]{64}$/u).nullable(),verification_state:z.enum(["verified","invalid","unverified"]),verification_error:z.string().nullable(),checked_at:instant.nullable(),created_at:instant}).strict()),
  as_of:instant
}).strict();
export const setLibraryReadingStateInputSchema=z.object({item_id:stableId,item_revision:z.number().int().positive(),locator:z.json(),progress:z.number().min(0).max(1),state:z.enum(["active","completed"])}).strict().superRefine((value,context)=>{if(value.state==="completed"&&value.progress!==1)context.addIssue({code:"custom",path:["progress"],message:"completed reading state requires progress 1"});});
export const registerLibraryLegacyLinkInputSchema=z.object({item_id:stableId,legacy_uri:z.string().trim().min(1).max(2_000),algorithm:z.enum(["ed25519-sha256-ascii-v1","legacy-unverified"]),source_asset_version_id:stableId.optional(),signed_content_sha256:z.string().regex(/^[0-9a-f]{64}$/u).optional(),public_key_pem:z.string().min(1).max(10_000).optional(),signature_base64:z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u).max(1_000).optional()}).strict().superRefine((value,context)=>{const proofFields=[value.source_asset_version_id,value.signed_content_sha256,value.public_key_pem,value.signature_base64];if(value.algorithm==="ed25519-sha256-ascii-v1"&&proofFields.some(field=>field===undefined))context.addIssue({code:"custom",message:"verified legacy proof requires the asset version, hash, public key, and signature"});if(value.algorithm==="legacy-unverified"&&proofFields.some(field=>field!==undefined))context.addIssue({code:"custom",message:"unverified legacy links cannot carry unverifiable proof fields"});});

export const agentObjectReferenceSchema=z.object({kind:z.enum(["meal","purchase","money_entry","health_measurement","health_workout","trip","library_item"]),id:stableId,revision:z.number().int().positive()}).strict();
export const createAgentContextPackInputSchema=z.object({thread_id:stableId.optional(),object_refs:z.array(agentObjectReferenceSchema).min(1).max(20),valid_from:instant.optional(),valid_to:instant.optional(),ttl_minutes:z.number().int().min(5).max(60).default(15)}).strict().superRefine((value,context)=>{if(value.valid_from&&value.valid_to&&value.valid_to<value.valid_from)context.addIssue({code:"custom",path:["valid_to"],message:"valid_to must not precede valid_from"});if(new Set(value.object_refs.map(ref=>`${ref.kind}:${ref.id}:${ref.revision}`)).size!==value.object_refs.length)context.addIssue({code:"custom",path:["object_refs"],message:"context object references must be unique"});});
export const revokeAgentContextPackInputSchema=z.object({context_pack_id:stableId}).strict();
export const setAgentMemoryInputSchema=z.object({memory_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),category:z.enum(["explicit_preference","deterministic_aggregate"]),memory_key:z.string().trim().min(1).max(100),value:z.json().optional(),evidence_refs:z.array(agentObjectReferenceSchema).max(20).default([]),algorithm_version:z.string().trim().min(1).max(100).optional(),state:z.enum(["active","archived"]).default("active"),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.memory_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"memory_id and expected_revision must be supplied together"});if(value.memory_id&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"reason is required for a memory update"});if(value.category==="deterministic_aggregate"&&(!value.algorithm_version||!value.evidence_refs.length))context.addIssue({code:"custom",message:"deterministic aggregate memory requires an algorithm version and evidence"});if(value.category==="explicit_preference"&&value.value===undefined)context.addIssue({code:"custom",path:["value"],message:"explicit preferences require a value"});if(value.category==="explicit_preference"&&value.algorithm_version!==undefined)context.addIssue({code:"custom",path:["algorithm_version"],message:"explicit preferences do not use an aggregate algorithm"});});
const quietTime=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export const setNotificationPreferencesInputSchema=z.object({enabled:z.boolean(),quiet_start:quietTime.optional(),quiet_end:quietTime.optional(),time_zone:ianaTimeZone}).strict().refine(value=>(value.quiet_start===undefined)===(value.quiet_end===undefined),{message:"quiet_start and quiet_end must be supplied together"});
export const updateNotificationInputSchema=z.object({notification_id:stableId,action:z.enum(["dismiss","snooze","mark_read","mark_unread","mark_delivered"]),snoozed_until:instant.optional()}).strict().superRefine((value,context)=>{if((value.action==="snooze")!==(value.snoozed_until!==undefined))context.addIssue({code:"custom",path:["snoozed_until"],message:"snooze requires snoozed_until and other actions forbid it"});});
export const registerNotificationDeviceInputSchema=z.object({installation_id:stableId,platform:z.literal("android"),authorization_state:z.enum(["enabled","denied","unavailable"]),push_token:z.string().trim().min(1).max(4_096).optional()}).strict();
export const setNotificationDeliveryStateInputSchema=z.object({notification_id:stableId,installation_id:stableId,state:z.enum(["scheduled","delivered","failed","cancelled","unknown"]),provider_reference:z.string().trim().min(1).max(500).optional(),attempt:z.number().int().positive().default(1)}).strict();
export const agentContextPackInputSchema=z.object({context_pack_id:stableId}).strict();
export const agentMemoriesInputSchema=z.object({category:z.enum(["explicit_preference","deterministic_aggregate"]).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const agentContextPackResultSchema=z.object({id:stableId,thread_id:stableId.nullable(),object_refs:z.array(agentObjectReferenceSchema).max(20),valid_from:instant.nullable(),valid_to:instant.nullable(),expires_at:instant,state:z.literal("active"),created_at:instant}).strict();
export const agentMemoriesResultSchema=z.object({items:z.array(z.object({id:stableId,category:z.enum(["explicit_preference","deterministic_aggregate"]),memory_key:z.string(),value:z.json(),evidence_refs:z.array(agentObjectReferenceSchema).max(20),algorithm_version:z.string().nullable(),state:z.literal("active"),revision:z.number().int().positive(),updated_at:instant}).strict()).max(100),as_of:instant}).strict();
export const agentThreadMessagesInputSchema=z.object({limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(1_000).optional()}).strict();
export const agentMessageResultSchema=z.object({id:stableId,role:z.enum(["user","assistant"]),content:z.string().max(1_000_000),created_at:instant}).strict();
export const agentThreadMessagesResultSchema=z.object({items:z.array(agentMessageResultSchema),next_cursor:z.string().nullable(),as_of:instant}).strict();
export const agentThreadResultSchema=z.object({id:stableId,title:z.string().min(1).max(500),created_at:instant,updated_at:instant,last_message:z.string().max(1_000_000).nullable()}).strict();
export const agentThreadsResultSchema=z.object({items:z.array(agentThreadResultSchema)}).strict();
export const notificationsInputSchema=z.object({limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(1_000).optional()}).strict();
export const notificationDeliverySchema=z.object({installation_id:stableId,state:z.enum(["scheduled","delivered","failed","cancelled","unknown"]),attempt:z.number().int().positive(),revision:z.number().int().positive(),updated_at:instant}).strict();
export const notificationItemSchema=z.object({id:stableId,kind:z.enum(["due","processing_failed","reminder"]),title:z.string().min(1).max(500),body:z.string().max(2_000),scheduled_at:instant,state:z.enum(["pending","snoozed","dismissed","delivered"]),snoozed_until:instant.nullable(),read_state:z.enum(["unread","read"]),delivery_state:z.enum(["disabled","quiet","snoozed","scheduled","ready"]),deliveries:z.array(notificationDeliverySchema)}).strict();
export const notificationPreferencesResultSchema=z.object({enabled:z.boolean(),quiet_start:z.string().nullable(),quiet_end:z.string().nullable(),time_zone:ianaTimeZone,revision:z.number().int().nonnegative(),updated_at:instant.nullable()}).strict();
export const notificationsResultSchema=z.object({items:z.array(notificationItemSchema),next_cursor:z.string().nullable(),preferences:notificationPreferencesResultSchema,as_of:instant}).strict();

export const ownedItemDocumentSchema=z.object({library_item_id:stableId,library_revision:z.number().int().positive(),role:z.enum(["receipt","manual","warranty","repair"])}).strict();
export const saveOwnedItemInputSchema=z.object({owned_item_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),purchase_item_id:stableId.nullable().optional(),name:z.string().trim().min(1).max(200),ownership_state:z.enum(["owned","gifted","returned","disposed","lost"]).default("owned"),location:z.string().trim().min(1).max(200).nullable().optional(),started_on:localDate.nullable().optional(),warranty_ends_on:localDate.nullable().optional(),return_by:localDate.nullable().optional(),documents:z.array(ownedItemDocumentSchema).max(20).default([]),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.owned_item_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"owned_item_id and expected_revision must be supplied together"});if(value.owned_item_id&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"updating an owned item needs a reason"});const keys=new Set<string>();for(const [index,document] of value.documents.entries()){const key=`${document.role}:${document.library_item_id}`;if(keys.has(key))context.addIssue({code:"custom",path:["documents",index],message:"duplicate owned item document"});keys.add(key);}});
export const recordOwnedItemEventInputSchema=z.object({owned_item_id:stableId,expected_revision:z.number().int().positive(),event_kind:z.enum(["maintenance","repair","return","dispose","gift","lost","restore","note"]),occurred_on:localDate,note:z.string().trim().min(1).max(2_000),cost_entry_id:stableId.optional(),document:ownedItemDocumentSchema.omit({role:true}).optional()}).strict();
export const ownedItemsInputSchema=z.object({id:stableId.optional(),state:z.enum(["owned","gifted","returned","disposed","lost"]).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const generateLifeReviewInputSchema=z.object({review_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),from_on:localDate,to_on:localDate,time_zone:ianaTimeZone,domains:z.array(z.enum(["money","meals","health","items","library"])).min(1).max(5).default(["money","meals","health","items","library"])}).strict().superRefine((value,context)=>{if((value.review_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"review_id and expected_revision must be supplied together"});if(value.to_on<value.from_on)context.addIssue({code:"custom",path:["to_on"],message:"to_on must not precede from_on"});const days=(Date.parse(`${value.to_on}T00:00:00Z`)-Date.parse(`${value.from_on}T00:00:00Z`))/86_400_000+1;if(days>366)context.addIssue({code:"custom",path:["to_on"],message:"review period must not exceed 366 days"});if(new Set(value.domains).size!==value.domains.length)context.addIssue({code:"custom",path:["domains"],message:"review domains must be unique"});});
export const lifeReviewsInputSchema=z.object({id:stableId.optional(),limit:z.number().int().min(1).max(50).default(20)}).strict();

export const projectReferenceSchema=z.object({kind:z.enum(["trip","health_plan","recurring_plan","owned_item","library_item","money_entry","meal","recipe"]),id:stableId,revision:z.number().int().positive(),role:z.string().trim().min(1).max(80)}).strict();
export const saveLifeProjectInputSchema=z.object({project_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),title:z.string().trim().min(1).max(200),goal:z.string().trim().min(1).max(2_000),starts_on:localDate.nullable().optional(),ends_on:localDate.nullable().optional(),state:z.enum(["active","completed","paused","cancelled"]).default("active"),milestones:z.array(z.object({id:stableId.optional(),title:z.string().trim().min(1).max(200),due_on:localDate.nullable().optional(),state:z.enum(["planned","completed","cancelled"]).default("planned")}).strict()).max(50).default([]),links:z.array(projectReferenceSchema).max(50).default([]),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.project_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"project_id and expected_revision must be supplied together"});if(value.project_id&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"updating a life project needs a reason"});if(value.starts_on&&value.ends_on&&value.ends_on<value.starts_on)context.addIssue({code:"custom",path:["ends_on"],message:"ends_on must not precede starts_on"});const links=new Set<string>();for(const [index,link] of value.links.entries()){const key=`${link.kind}:${link.id}:${link.role}`;if(links.has(key))context.addIssue({code:"custom",path:["links",index],message:"duplicate project link"});links.add(key);}});
export const saveActionItemInputSchema=z.object({action_item_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),project_id:stableId,title:z.string().trim().min(1).max(200),due_on:localDate.nullable().optional(),state:z.enum(["open","completed","cancelled"]).default("open"),recurring_occurrence_id:stableId.optional(),health_habit_id:stableId.optional()}).strict().superRefine((value,context)=>{if((value.action_item_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"action_item_id and expected_revision must be supplied together"});if(value.recurring_occurrence_id&&value.health_habit_id)context.addIssue({code:"custom",message:"an action item can mirror at most one existing due source"});});
export const lifeProjectsInputSchema=z.object({id:stableId.optional(),state:z.enum(["active","completed","paused","cancelled"]).optional(),limit:z.number().int().min(1).max(50).default(20)}).strict();
export const lifeProjectResultSchema=z.object({id:stableId,title:z.string(),goal:z.string(),starts_on:localDate.nullable(),ends_on:localDate.nullable(),state:z.enum(["active","completed","paused","cancelled"]),revision:z.number().int().positive(),created_at:instant,updated_at:instant,milestones:z.array(z.object({id:stableId,title:z.string(),due_on:localDate.nullable(),state:z.enum(["planned","completed","cancelled"]),position:z.number().int().nonnegative()}).strict()),links:z.array(z.object({ref_kind:projectReferenceSchema.shape.kind,ref_id:stableId,ref_revision:z.number().int().positive(),role:z.string()}).strict()),actions:z.array(z.object({id:stableId,title:z.string(),due_on:localDate.nullable(),state:z.enum(["open","completed","cancelled"]),recurring_occurrence_id:stableId.nullable().optional(),health_habit_id:stableId.nullable().optional(),revision:z.number().int().positive(),updated_at:instant,source_state:z.string().nullable().optional()}).strict())}).strict();
export const lifeProjectsResultSchema=z.object({items:z.array(lifeProjectResultSchema),as_of:instant}).strict();
export const ownedItemResultSchema=z.object({id:stableId,name:z.string(),ownership_state:z.enum(["owned","gifted","returned","disposed","lost"]),location:z.string().nullable(),started_on:localDate.nullable(),warranty_ends_on:localDate.nullable(),return_by:localDate.nullable(),purchase_item_id:stableId.nullable(),revision:z.number().int().positive(),created_at:instant,updated_at:instant,purchase:z.object({purchase_item_id:stableId,purchase_id:stableId,record_id:stableId,raw_name:z.string(),quantity:canonicalDecimal.nullable(),unit:z.string().nullable(),line_amount:storedAmount.nullable()}).strict().nullable(),documents:z.array(z.object({library_item_id:stableId,library_revision:z.number().int().positive(),role:z.enum(["receipt","manual","warranty","repair"]),title:z.string().optional()}).strict()),events:z.array(z.object({id:stableId,event_kind:z.enum(["maintenance","repair","return","dispose","gift","lost","restore","note"]),occurred_on:localDate,note:z.string(),revision:z.number().int().positive(),created_at:instant,document_library_item_id:stableId.nullable(),document_library_revision:z.number().int().positive().nullable(),cost_entry_id:stableId.nullable().optional(),cost_amount:storedAmount.nullable().optional(),cost_currency:currencyCode.nullable().optional(),document_title:z.string().nullable().optional()}).strict())}).strict();
export const ownedItemsResultSchema=z.object({items:z.array(ownedItemResultSchema),as_of:instant}).strict();
export const lifeReviewResultSchema=z.object({id:stableId,from_on:localDate,to_on:localDate,time_zone:ianaTimeZone,domains:z.array(z.enum(["money","meals","health","items","library"])),algorithm_version:z.string(),metrics:z.record(z.string(),z.unknown()),coverage:z.record(z.string(),z.unknown()),evidence:z.array(z.object({type:z.string(),id:stableId,revision:z.number().int().positive()}).strict()),limitations:z.array(z.string()),revision:z.number().int().positive(),generated_at:instant}).strict();
export const lifeReviewsResultSchema=z.object({items:z.array(lifeReviewResultSchema),as_of:instant}).strict();
export const planningAgendaInputSchema=z.object({from_on:localDate,to_on_exclusive:localDate,time_zone:ianaTimeZone,limit:z.number().int().min(1).max(200).default(100)}).strict().superRefine((value,context)=>{if(value.to_on_exclusive<=value.from_on)context.addIssue({code:"custom",path:["to_on_exclusive"],message:"to_on_exclusive must follow from_on"});const days=(Date.parse(`${value.to_on_exclusive}T00:00:00Z`)-Date.parse(`${value.from_on}T00:00:00Z`))/86_400_000;if(days>31)context.addIssue({code:"custom",path:["to_on_exclusive"],message:"agenda window must not exceed 31 days"});});
export const planningAgendaTargetSchema=z.object({kind:z.enum(["project","money_occurrence","health_habit"]),id:stableId,project_id:stableId.nullable()}).strict();
export const planningAgendaActionSchema=z.object({capability:z.enum(["life.save_action_item","money.set_occurrence_state"]),target_id:stableId,expected_revision:z.number().int().positive()}).strict();
export const planningAgendaItemSchema=z.object({source_kind:z.enum(["project_action","recurring_occurrence","health_habit"]),source_id:stableId,source_key:z.string().min(1).max(300),title:z.string().min(1).max(500),state:z.enum(["open","pending","reminded","snoozed","handled","completed","dismissed","cancelled","not_applicable"]),due_on:localDate,due_at:instant.nullable(),target:planningAgendaTargetSchema,primary_action:planningAgendaActionSchema.nullable()}).strict();
export const planningAgendaResultSchema=z.object({from_on:localDate,to_on_exclusive:localDate,time_zone:ianaTimeZone,items:z.array(planningAgendaItemSchema),truncated:z.boolean(),as_of:instant}).strict();
export type PlanningAgendaItem=z.infer<typeof planningAgendaItemSchema>;
export type PlanningAgendaResult=z.infer<typeof planningAgendaResultSchema>;

export const mealPlanEntryInputSchema=z.object({plan_date:localDate,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),title:z.string().trim().min(1).max(200),servings:positiveDecimal,recipe_id:stableId.optional(),recipe_revision:z.number().int().positive().optional()}).strict().refine(value=>(value.recipe_id===undefined)===(value.recipe_revision===undefined),{message:"recipe_id and recipe_revision must be supplied together"});
export const saveMealPlanInputSchema=z.object({meal_plan_id:stableId.optional(),expected_revision:z.number().int().positive().optional(),title:z.string().trim().min(1).max(200),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone,state:z.enum(["draft","active","completed","cancelled"]).default("draft"),entries:z.array(mealPlanEntryInputSchema).min(1).max(100),reason:z.string().trim().min(1).max(500).optional()}).strict().superRefine((value,context)=>{if((value.meal_plan_id===undefined)!==(value.expected_revision===undefined))context.addIssue({code:"custom",message:"meal_plan_id and expected_revision must be supplied together"});if(value.meal_plan_id&&value.reason===undefined)context.addIssue({code:"custom",path:["reason"],message:"updating a meal plan needs a reason"});if(value.ends_on<value.starts_on)context.addIssue({code:"custom",path:["ends_on"],message:"ends_on must not precede starts_on"});for(const [index,entry] of value.entries.entries())if(entry.plan_date<value.starts_on||entry.plan_date>value.ends_on)context.addIssue({code:"custom",path:["entries",index,"plan_date"],message:"meal plan entry is outside the plan period"});});
export const buildShoppingListInputSchema=z.object({meal_plan_id:stableId,expected_meal_plan_revision:z.number().int().positive(),title:z.string().trim().min(1).max(200),extras:z.array(z.object({name:z.string().trim().min(1).max(200),quantity:positiveDecimal.optional(),unit:z.string().trim().min(1).max(32).optional()}).strict().refine(value=>(value.quantity===undefined)===(value.unit===undefined),{message:"quantity and unit must be supplied together"})).max(50).default([])}).strict();
export const updateShoppingItemInputSchema=z.object({shopping_item_id:stableId,expected_revision:z.number().int().positive(),state:z.enum(["needed","bought","skipped"]),purchase_item_id:stableId.optional()}).strict().superRefine((value,context)=>{if(value.state!=="bought"&&value.purchase_item_id)context.addIssue({code:"custom",path:["purchase_item_id"],message:"only a bought item can link a purchase line"});});
export const mealPlanningInputSchema=z.object({limit:z.number().int().min(1).max(50).default(20)}).strict();
const mealPlanRecipeSnapshotSchema=z.object({recipe:z.object({id:stableId,title:z.string(),revision:z.number().int().positive(),servings:positiveDecimal}).strict(),items:z.array(intakeItemInputSchema.safeExtend({planned_quantity:positiveDecimal.optional()}))}).strict();
export const mealPlanningResultSchema=z.object({meal_plans:z.array(z.object({id:stableId,title:z.string(),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone,state:z.enum(["draft","active","completed","cancelled"]),revision:z.number().int().positive(),created_at:instant,updated_at:instant,entries:z.array(z.object({id:stableId,plan_date:localDate,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),title:z.string(),servings:positiveDecimal,recipe_id:stableId.nullable(),recipe_revision:z.number().int().positive().nullable(),recipe_snapshot:mealPlanRecipeSnapshotSchema.nullable(),position:z.number().int().nonnegative()}).strict())}).strict()),shopping_lists:z.array(z.object({id:stableId,meal_plan_id:stableId,meal_plan_revision:z.number().int().positive(),title:z.string(),state:z.enum(["open","completed","cancelled"]),revision:z.number().int().positive(),created_at:instant,updated_at:instant,items:z.array(z.object({id:stableId,name:z.string(),quantity:positiveDecimal.nullable(),unit:z.string().nullable(),source_entry_ids:z.array(stableId),state:z.enum(["needed","bought","skipped"]),purchase_item_id:stableId.nullable(),revision:z.number().int().positive()}).strict())}).strict()),as_of:instant}).strict();

const fxRate=z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/u).refine(value=>Number(value)>0,"rate must be greater than zero");
export const recordForeignEntryInputSchema=z.object({entry_type:z.enum(["expense","income"]),amount:storedAmount.refine(value=>Number(value)>0,"amount must be greater than zero"),currency:currencyCode,source_scale:z.number().int().min(0).max(6),occurred_on:localDate,occurred_at:instant.optional(),time_zone:ianaTimeZone,counterparty:z.string().trim().min(1).max(200).optional(),category:z.string().trim().min(1).max(80).optional(),payment_method:paymentMethodSchema.optional(),note:z.string().trim().min(1).max(2_000).optional(),trip_id:stableId.optional(),conversion:z.object({base_amount:storedAmount.refine(value=>Number(value)>0,"base amount must be greater than zero"),base_currency:currencyCode,rate:fxRate,quoted_at:instant,source_kind:z.enum(["manual","provider","import"]),source_ref:z.string().trim().min(1).max(500).optional()}).strict(),allocations:z.array(z.object({participant_label:z.string().trim().min(1).max(100),original_amount:storedAmount.refine(value=>Number(value)>0,"allocation must be greater than zero"),state:z.enum(["unsettled","settled","waived"]).default("unsettled"),settled_on:localDate.optional()}).strict().refine(value=>(value.state==="settled")===(value.settled_on!==undefined),{message:"settled allocations require settled_on and other states forbid it"})).max(20).default([])}).strict().superRefine((value,context)=>{if(value.allocations.length&&value.entry_type!=="expense")context.addIssue({code:"custom",path:["allocations"],message:"shared allocations are only valid for expenses"});if(value.currency===value.conversion.base_currency)context.addIssue({code:"custom",path:["conversion","base_currency"],message:"conversion currency must differ from original currency"});const fraction=value.amount.split(".")[1]?.length??0;if(fraction>value.source_scale)context.addIssue({code:"custom",path:["source_scale"],message:"source_scale is smaller than the supplied amount precision"});const labels=new Set<string>();for(const [index,item] of value.allocations.entries()){const key=item.participant_label.toLocaleLowerCase();if(labels.has(key))context.addIssue({code:"custom",path:["allocations",index],message:"allocation participant labels must be unique"});labels.add(key);}if(!factDateMatches(value))context.addIssue({code:"custom",path:["occurred_at"],message:"occurred_at does not fall on occurred_on in time_zone"});});
export const updateSharedExpenseAllocationInputSchema=z.object({allocation_id:stableId,expected_revision:z.number().int().positive(),state:z.enum(["unsettled","settled","waived"]),settled_on:localDate.optional()}).strict().refine(value=>(value.state==="settled")===(value.settled_on!==undefined),{message:"settled allocations require settled_on and other states forbid it"});
export const foreignEntriesInputSchema=z.object({trip_id:stableId.optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const foreignEntriesResultSchema=z.object({items:z.array(z.object({
  id:stableId,record_id:stableId,entry_type:z.enum(["expense","income"]),amount:storedAmount,currency:currencyCode,source_scale:z.number().int().min(0).max(6),
  occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,counterparty:z.string().nullable(),category:z.string().nullable(),payment_method:paymentMethodSchema.nullable(),note:z.string().nullable(),revision:z.number().int().positive(),
  fx_snapshot_id:stableId,base_amount:storedAmount,base_currency:currencyCode,rate:fxRate,quote_convention:z.literal("base_per_original"),quoted_at:instant,source_kind:z.enum(["manual","provider","import"]),source_ref:z.string().nullable(),trip_id:stableId.nullable(),
  allocations:z.array(z.object({id:stableId,participant_label:z.string(),original_amount:storedAmount,state:z.enum(["unsettled","settled","waived"]),settled_on:localDate.nullable(),revision:z.number().int().positive(),updated_at:instant}).strict()).max(20)
}).strict()).max(100),as_of:instant}).strict();

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
  "life.save_food":saveFoodInputSchema,
  "life.save_recipe":saveRecipeInputSchema,
  "life.record_meal_from_recipe":recordMealFromRecipeInputSchema,
  "money.record_entry": recordMoneyEntryInputSchema,
  "money.record_refund": recordRefundInputSchema,
  "money.correct_entry": correctMoneyEntryInputSchema,
  "money.void_entry": voidRecordInputSchema,
  "money.set_budget": setBudgetInputSchema,
  "money.set_recurring_plan": setRecurringPlanInputSchema,
  "money.set_spending_intent":setSpendingIntentInputSchema,
  "money.set_use_cycle":setUseCycleInputSchema,
  "money.set_occurrence_state":setRecurringOccurrenceInputSchema,
  "money.stage_import":stageMoneyImportInputSchema,
  "money.resolve_import_candidate":resolveMoneyImportCandidateInputSchema,
  "money.set_import_rule":setMoneyImportRuleInputSchema,
  "health.record_measurement": recordHealthMeasurementInputSchema,
  "health.correct_measurement":correctHealthMeasurementInputSchema,
  "health.record_workout":recordWorkoutInputSchema,
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
  "travel.save_map":saveTravelMapInputSchema,
  "travel.import_track":importTravelTrackInputSchema,
  "travel.restore_bundle":restoreTravelBundleInputSchema,
  "library.capture": captureLibraryItemInputSchema,
  "library.revise":reviseLibraryItemInputSchema,
  "library.annotate":annotateLibraryItemInputSchema,
  "library.register_derivation":registerLibraryDerivationInputSchema,
  "library.queue_processing":queueLibraryProcessingInputSchema,
  "library.retry_processing":retryLibraryProcessingInputSchema,
  "library.claim_processing":claimLibraryProcessingInputSchema,
  "library.renew_processing":renewLibraryProcessingInputSchema,
  "library.fail_processing":failLibraryProcessingInputSchema,
  "library.complete_processing":completeLibraryProcessingInputSchema,
  "library.set_reading_state":setLibraryReadingStateInputSchema,
  "agent.create_context_pack":createAgentContextPackInputSchema,
  "agent.revoke_context_pack":revokeAgentContextPackInputSchema,
  "agent.set_memory":setAgentMemoryInputSchema,
  "notifications.set_preferences":setNotificationPreferencesInputSchema,
  "notifications.update":updateNotificationInputSchema,
  "notifications.register_device":registerNotificationDeviceInputSchema,
  "notifications.set_delivery_state":setNotificationDeliveryStateInputSchema,
  "life.save_owned_item":saveOwnedItemInputSchema,
  "life.record_owned_item_event":recordOwnedItemEventInputSchema,
  "life.generate_review":generateLifeReviewInputSchema
  ,"life.save_project":saveLifeProjectInputSchema
  ,"life.save_action_item":saveActionItemInputSchema
  ,"life.save_meal_plan":saveMealPlanInputSchema
  ,"life.build_shopping_list":buildShoppingListInputSchema
  ,"life.update_shopping_item":updateShoppingItemInputSchema
  ,"money.record_foreign_entry":recordForeignEntryInputSchema
  ,"money.update_shared_allocation":updateSharedExpenseAllocationInputSchema
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
  type: z.enum(["meal", "meal_template", "food", "recipe", "personal_alias", "intake_item", "consumption_record", "purchase", "purchase_item", "money_entry", "refund", "budget", "recurring_plan", "recurring_occurrence", "spending_intent", "use_cycle", "money_import_batch", "money_import_candidate", "money_import_rule", "health_measurement", "health_workout_session", "health_raw", "health_sync_cursor", "health_plan", "trip", "trip_segment", "reservation", "visit", "place", "travel_map", "trip_track", "trip_day_plan", "trip_member", "trip_plan_version", "trip_run", "trip_stop_outcome", "library_item", "library_annotation", "library_derivation", "library_processing_job", "library_reading_state", "library_legacy_link", "agent_context_pack", "agent_memory", "notification_preferences", "notification", "notification_installation", "notification_delivery", "owned_item", "owned_item_event", "life_review", "life_project", "action_item", "meal_plan", "shopping_list", "shopping_list_item", "money_fx_snapshot", "shared_expense_allocation", "source", "thread", "run", "task"]),
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
  code: z.enum(["missing_fact", "validation", "conflict", "permission_denied", "confirmation_required", "retryable_not_applied", "outcome_unknown", "not_found", "invalid_token", "identity_not_linked", "identity_temporarily_unavailable", "unsupported_contract"]),
  message: z.string(),
  fields: z.array(z.string()).optional(),
  execution_id: stableId.optional()
}).strict();

export const lifeMeResultSchema=z.object({
  issuer:z.string().min(1),oidc_sub:z.string().min(1),life_subject_id:stableId,environment_id:z.string().min(1),display_name:z.string().nullable(),effects:z.array(z.string()),authorization_revision:z.number().int().positive()
}).strict();

const projectHttpsUrl=z.url().max(2_000).refine(value=>{const parsed=new URL(value);return parsed.protocol==="https:"&&!parsed.username&&!parsed.password;},"project links must use HTTPS without userinfo");
const projectTargetSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("browser"),url:projectHttpsUrl}).strict(),
  z.object({kind:z.literal("app_link"),url:projectHttpsUrl,package_name:z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u),web_fallback_url:projectHttpsUrl}).strict()
]);
export const projectDirectoryItemSchema=z.object({
  id:z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
  title:z.string().trim().min(1).max(80),
  subtitle:z.string().trim().min(1).max(160),
  icon:z.enum(["chart-line","notebook-pen","library","app-window"]),
  state:z.enum(["configured","not_configured","disabled"]),
  target:projectTargetSchema.optional(),
  auth_hint:z.enum(["shadow_identity","project_managed","public"]),
  order:z.number().int().min(0).max(10_000)
}).strict().superRefine((value,context)=>{
  if(value.state==="configured"&&value.target===undefined)context.addIssue({code:"custom",path:["target"],message:"configured projects need a target"});
  if(value.state!=="configured"&&value.target!==undefined)context.addIssue({code:"custom",path:["target"],message:"unavailable projects cannot expose a target"});
});
export const projectDirectoryResultSchema=z.object({schema_version:z.literal(1),catalog_revision:z.string().trim().min(1).max(128),items:z.array(projectDirectoryItemSchema).max(20)}).strict().superRefine((value,context)=>{const ids=new Set<string>();for(const [index,item] of value.items.entries())if(ids.has(item.id))context.addIssue({code:"custom",path:["items",index,"id"],message:"project ids must be unique"});else ids.add(item.id);});
export type ProjectDirectoryResult=z.infer<typeof projectDirectoryResultSchema>;

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

export const listMealsInputSchema = z.object({ limit: z.number().int().min(1).max(100).default(20),cursor:z.string().max(1_000).optional() }).strict();
export const listMealsResultSchema = z.object({ items: z.array(mealViewSchema),next_cursor:z.string().nullable(),as_of:instant }).strict();
const lifeRecordSourceSchema=z.object({id:stableId,kind:z.string(),external_id:z.string().nullable(),captured_on:localDate.nullable(),captured_at:instant.nullable(),time_zone:ianaTimeZone.nullable(),original_text:z.string().nullable(),asset_version_id:stableId.nullable(),revision:z.number().int().positive()}).strict();
const lifeRecordIntakeSchema=z.object({id:stableId,meal_id:stableId,position:z.number().int().nonnegative(),name:z.string(),food_ref_id:stableId.nullable(),free_text:z.string().nullable(),quantity:canonicalDecimal.nullable(),unit:z.string().nullable(),amount_g:canonicalDecimal.nullable(),energy_kcal:canonicalDecimal.nullable(),protein_g:canonicalDecimal.nullable(),fat_g:canonicalDecimal.nullable(),carb_g:canonicalDecimal.nullable(),fiber_g:canonicalDecimal.nullable(),sodium_mg:canonicalDecimal.nullable(),consumed_fraction:canonicalDecimal.nullable(),provenance:z.string().nullable(),grouping_origin:z.string().nullable(),estimate:z.boolean(),evidence_note:z.string().nullable(),revision:z.number().int().positive()}).strict();
const lifeRecordMoneyEntrySchema=z.object({id:stableId,record_id:stableId,entry_type:z.enum(["expense","income","refund"]),amount:storedAmount,currency:currencyCode,occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,note:z.string().nullable(),category:z.string().nullable(),counterparty:z.string().nullable(),source_id:stableId.nullable().optional(),payment_method:paymentMethodSchema.nullable(),source_scale:z.number().int().min(0).max(6),revision:z.number().int().positive()}).strict();
const lifeRecordPurchaseSchema=z.object({id:stableId,record_id:stableId,merchant:z.string().nullable(),amount:storedAmount.nullable(),currency:currencyCode,category:z.string().nullable(),occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,note:z.string().nullable(),source_id:stableId.nullable().optional(),scene:z.string().nullable(),channel_name_raw:z.string().nullable(),place_ref:z.string().nullable(),rating:z.number().int().min(1).max(5).nullable(),would_repeat:z.boolean().nullable(),revision:z.number().int().positive()}).strict();
const lifeRecordPurchaseItemSchema=z.object({id:stableId,purchase_id:stableId,position:z.number().int().nonnegative(),raw_name:z.string(),quantity:canonicalDecimal.nullable(),unit_price:storedAmount.nullable(),unit:z.string().nullable(),line_amount:storedAmount.nullable(),category_key:z.string().nullable()}).strict();
const lifeRecordLinkedMealSchema=z.object({id:stableId,occurred_on:localDate,meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]),revision:z.number().int().positive(),items:z.array(lifeRecordIntakeSchema).max(100)}).strict();
export const lifeConsumptionRecordResultSchema=z.object({kind:z.literal("record"),record_id:stableId,state:z.enum(["draft","confirmed","voided"]),occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,note:z.string().nullable(),revision:z.number().int().positive(),purchase:lifeRecordPurchaseSchema.nullable().optional(),purchase_items:z.array(lifeRecordPurchaseItemSchema).max(100).optional(),money_entry:lifeRecordMoneyEntrySchema.nullable().optional(),meals:z.array(lifeRecordLinkedMealSchema).max(100).optional(),sources:z.array(lifeRecordSourceSchema).max(100).optional()}).strict();
export const lifeMealRecordResultSchema=z.object({kind:z.literal("meal"),meal_id:stableId,occurred_on:localDate.optional(),occurred_at:instant.nullable().optional(),time_zone:ianaTimeZone.optional(),meal_type:z.enum(["breakfast","lunch","dinner","snack","other"]).optional(),note:z.string().nullable().optional(),revision:z.number().int().positive().optional(),items:z.array(lifeRecordIntakeSchema).max(100).optional(),payments:z.array(lifeRecordMoneyEntrySchema).max(100).optional(),sources:z.array(lifeRecordSourceSchema).max(100).optional()}).strict();
export const lifeRecordResultSchema=z.discriminatedUnion("kind",[lifeConsumptionRecordResultSchema,lifeMealRecordResultSchema]);
export const moneySummaryInputSchema = z.object({}).strict();
export const domainRecordsInputSchema=z.object({query:z.string().trim().min(1).max(200).optional(),limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(1_000).optional()}).strict();
export const domainRecordSummarySchema=z.object({
  kind:z.string().min(1).max(80),
  id:stableId,
  title:z.string().min(1).max(500),
  supporting:z.string().max(500).nullable(),
  happened_on:localDate.nullable(),
  state:z.string().max(80).nullable(),
  revision:z.number().int().positive().nullable(),
  record_id:stableId.nullable(),
  amount:signedStoredAmount.nullable(),
  currency:currencyCode.nullable(),
  entry_type:z.enum(["expense","income","refund"]).optional()
}).strict();
export const domainRecordsResultSchema=z.object({items:z.array(domainRecordSummarySchema),next_cursor:z.string().nullable(),as_of:instant}).strict();
export type DomainRecordSummary=z.infer<typeof domainRecordSummarySchema>;
export const lifeOverviewDomainSchema=z.enum(["meals","money","health","travel","library"]);
export const lifeTodayInputSchema=z.object({date:localDate,time_zone:ianaTimeZone,domains:z.array(lifeOverviewDomainSchema).min(1).max(5).optional()}).strict();
export const lifeTodayResultSchema=z.object({date:localDate,domains:z.object({
  meals:z.object({count:z.number().int().nonnegative(),freshness:instant.nullable()}).strict().optional(),
  money:z.object({entries:z.number().int().nonnegative(),totals:z.array(z.object({currency:currencyCode,gross_expense:storedAmount,refund:storedAmount,income:storedAmount,net_spending:signedStoredAmount,net_cashflow:signedStoredAmount}).strict()),due_items:z.array(z.object({id:stableId,due_on:localDate,state:z.enum(["pending","reminded","snoozed"]),title:z.string(),amount:storedAmount.nullable(),currency:currencyCode.nullable()}).strict()).max(20).default([]),freshness:instant.nullable()}).strict().optional(),
  health:z.object({facts:z.number().int().nonnegative(),sync_issues:z.array(z.object({id:stableId,source_type:z.string(),instance_key:z.string(),permission_state:z.string(),sync_epoch:z.number().int().positive(),cursor_states:z.array(z.string()),last_sync_at:instant.nullable()}).strict()).max(20).default([]),freshness:instant.nullable()}).strict().optional(),
  travel:z.object({visits:z.number().int().nonnegative(),current_trips:z.array(z.object({id:stableId,title:z.string(),starts_on:localDate,ends_on:localDate,time_zone:ianaTimeZone}).strict()).max(20).default([]),freshness:instant.nullable()}).strict().optional(),
  library:z.object({captured:z.number().int().nonnegative(),freshness:instant.nullable()}).strict().optional()
}).strict(),as_of:instant}).strict();
export const lifeTimelineInputSchema=z.object({domains:z.array(lifeOverviewDomainSchema).min(1).max(5).optional(),limit:z.number().int().min(1).max(100).default(30),cursor:z.string().max(1_000).optional()}).strict();
export const lifeTimelineItemSchema=z.object({domain:lifeOverviewDomainSchema,kind:z.string(),id:stableId,happened_at:instant,title:z.string(),amount:storedAmount.optional(),currency:currencyCode.optional(),record_id:stableId.optional()}).strict();
export const lifeTimelineResultSchema=z.object({items:z.array(lifeTimelineItemSchema),next_cursor:z.string().nullable(),as_of:instant}).strict();
export const lifeSearchInputSchema=z.object({q:z.string().trim().min(1).max(200),types:z.array(lifeOverviewDomainSchema).min(1).max(5).optional(),from_on:localDate.optional(),to_on_exclusive:localDate.optional(),limit:z.number().int().min(1).max(100).default(30),cursor:z.string().max(1_000).optional()}).strict().refine(value=>!value.from_on||!value.to_on_exclusive||value.to_on_exclusive>value.from_on,{path:["to_on_exclusive"],message:"to_on_exclusive must be after from_on"});
export const lifeSearchItemSchema=z.object({domain:lifeOverviewDomainSchema,kind:z.string(),id:stableId,title:z.string(),supporting:z.string().nullable(),happened_on:localDate,amount:storedAmount.optional(),currency:currencyCode.optional(),record_id:stableId.optional()}).strict();
export const lifeSearchResultSchema=z.object({items:z.array(lifeSearchItemSchema),next_cursor:z.string().nullable(),as_of:instant,applied_filters:z.object({q:z.string(),types:z.array(lifeOverviewDomainSchema),from_on:localDate.nullable(),to_on_exclusive:localDate.nullable()}).strict()}).strict();
export const lifeRecordSectionSchema=z.enum(["meal","purchase","money","sources"]);
export const lifeRecordInputSchema=z.object({id:stableId,sections:z.array(lifeRecordSectionSchema).min(1).max(4).optional()}).strict();
export const resourceDetailInputSchema=z.object({id:stableId}).strict();
export const moneyPlanningInputSchema=z.object({period:z.string().regex(/^(?:0{3}[1-9]|0{2}[1-9]\d|0[1-9]\d{2}|[1-9]\d{3})-(0[1-9]|1[0-2])$/u)}).strict();
export const moneyImportReviewInputSchema=z.object({batch_id:stableId}).strict();
export const foodCatalogInputSchema=z.object({query:z.string().trim().min(1).max(200).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const foodCatalogResultSchema=z.object({foods:z.array(z.object({id:stableId,name:z.string(),serving_amount:canonicalDecimal.nullable(),serving_unit:z.string().nullable(),nutrients:z.record(z.string(),z.unknown()),provenance:z.string().nullable(),state:z.enum(["active","archived"]),revision:z.number().int().positive()}).strict()),recipes:z.array(z.object({id:stableId,title:z.string(),servings:positiveDecimal,instructions:z.string().nullable(),state:z.enum(["active","archived"]),revision:z.number().int().positive(),items:z.array(z.object({position:z.number().int().nonnegative(),snapshot:intakeItemInputSchema}).strict())}).strict()),as_of:instant}).strict();
export const moneyImportProposedSchema=z.object({entry_type:z.enum(["expense","income","refund"]).optional(),amount:cnyAmount.optional(),currency:z.literal("CNY").optional(),occurred_on:localDate.optional(),time_zone:ianaTimeZone.optional(),counterparty:z.string().optional(),category:z.string().optional(),payment_method:z.string().optional(),note:z.string().optional()}).strict();
export const moneyImportReviewResultSchema=z.object({batch:z.object({id:stableId,source_name:z.string(),format:z.enum(["csv","json","markdown"]),content_hash:z.string(),status:z.enum(["review","completed"]),total:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),confirmed:z.number().int().nonnegative(),ignored:z.number().int().nonnegative(),invalid:z.number().int().nonnegative(),created_at:instant}).strict(),candidates:z.array(z.object({id:stableId,position:z.number().int().nonnegative(),external_id:z.string().nullable(),raw:z.record(z.string(),z.unknown()),proposed:moneyImportProposedSchema,issues:z.array(z.string()),warnings:z.array(z.string()),applied_rule_ids:z.array(stableId),status:z.enum(["pending","invalid","confirmed","ignored"]),duplicate_of_record_id:stableId.nullable(),linked_record_id:stableId.nullable(),revision:z.number().int().positive()}).strict()).max(500),rules:z.array(z.object({id:stableId,match_value:z.string(),replacements:moneyImportRuleReplacementsSchema,state:z.enum(["active","disabled"]),revision:z.number().int().positive()}).strict()).max(500)}).strict();
export const healthDailyInputSchema=z.object({date:localDate}).strict();
const healthRecordRawSchema=z.object({id:stableId,record_type:z.enum(["body","wellbeing","sleep","workout","daily_activity","steps_interval","habit","lab","fitness_test"]),client_record_id:z.string(),current_version:z.number().int().nonnegative(),state:z.enum(["pending","normalized","failed","deleted","quarantined"]),parse_version:z.string().nullable(),source_instance_id:stableId}).strict();
const healthRecordMeasurementFactSchema=z.object({id:stableId,metric:z.enum(["weight","body_fat","heart_rate","blood_pressure_systolic","blood_pressure_diastolic","temperature","sleep_duration","steps","custom"]),value:canonicalDecimal,unit:z.string(),label:z.string().nullable(),occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,note:z.string().nullable(),source_id:stableId.nullable(),raw_id:stableId.nullable(),group_id:stableId.nullable(),autofilled:z.boolean(),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict();
const healthRecordObservationFactSchema=z.object({id:stableId,raw_id:stableId,raw_version:z.number().int().nonnegative(),metric_key:healthObservationMetricSchema,position:z.number().int().nonnegative(),value:canonicalDecimal,unit:z.string(),occurred_on:localDate,occurred_at:instant.nullable(),time_zone:ianaTimeZone,group_id:stableId,group_kind:z.enum(["measurement","legacy_daily_form","lab_report","fitness_test"]),original_field:z.string().nullable(),autofilled:z.boolean(),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict();
const healthRecordWellbeingFactSchema=z.object({id:stableId,raw_id:stableId,raw_version:z.number().int().nonnegative(),occurred_on:localDate,time_zone:ianaTimeZone,mood_score:z.number().int().min(0).max(10).nullable(),energy_level:z.number().int().min(0).max(10).nullable(),sleep_quality:z.number().int().min(0).max(10).nullable(),morning_erection:z.boolean().nullable(),notes:z.string().nullable(),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict();
const healthRecordSleepFactSchema=z.object({id:stableId,raw_id:stableId,raw_version:z.number().int().nonnegative(),wake_date:localDate,time_zone:ianaTimeZone,started_at:instant.nullable(),ended_at:instant.nullable(),total_minutes:z.number().int().nonnegative(),deep_minutes:z.number().int().nonnegative().nullable(),light_minutes:z.number().int().nonnegative().nullable(),rem_minutes:z.number().int().nonnegative().nullable(),awake_minutes:z.number().int().nonnegative().nullable(),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict();
const healthRecordWorkoutFactSchema=z.object({id:stableId,raw_id:stableId.nullable(),raw_version:z.number().int().nonnegative().nullable(),plan_id:stableId.nullable(),occurred_on:localDate,time_zone:ianaTimeZone,session_type:z.string(),started_at:instant.nullable(),duration_minutes:z.number().int().nonnegative().nullable(),distance_km:canonicalDecimal.nullable(),calories_kcal:canonicalDecimal.nullable(),rpe:z.number().int().min(0).max(10).nullable(),heart_rate_avg:z.number().int().positive().nullable(),detail:z.json().nullable(),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict();
const healthRecordActivityFactSchema=z.object({id:stableId,raw_id:stableId,raw_version:z.number().int().nonnegative(),occurred_on:localDate,time_zone:ianaTimeZone,steps:z.number().int().nonnegative().nullable(),active_minutes:z.number().int().nonnegative().nullable(),device_calories_kcal:canonicalDecimal.nullable(),workout_calories_kcal:canonicalDecimal.nullable(),effective_calories_kcal:canonicalDecimal.nullable(),field_sources:z.record(z.string(),z.string()),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant,steps_started_at:instant.nullable(),steps_ended_at:instant.nullable(),steps_origin:z.string().nullable()}).strict();
const healthRecordHabitFactSchema=z.object({id:stableId,raw_id:stableId,raw_version:z.number().int().nonnegative(),occurred_on:localDate,time_zone:ianaTimeZone,habit_key:z.string(),done_count:z.number().int().nonnegative(),explicit_denial:z.boolean(),note:z.string().nullable(),effective:z.boolean(),revision:z.number().int().positive(),created_at:instant}).strict();
const healthRecordBranch=<Kind extends string>(kind:Kind,fact:z.ZodType)=>z.object({kind:z.literal(kind),fact,source:lifeRecordSourceSchema.nullable(),raw:healthRecordRawSchema.nullable()}).strict();
export const healthRecordResultSchema=z.discriminatedUnion("kind",[
  healthRecordBranch("measurement",healthRecordMeasurementFactSchema),healthRecordBranch("observation",healthRecordObservationFactSchema),healthRecordBranch("daily_wellbeing",healthRecordWellbeingFactSchema),healthRecordBranch("sleep_session",healthRecordSleepFactSchema),healthRecordBranch("workout_session",healthRecordWorkoutFactSchema),healthRecordBranch("daily_activity",healthRecordActivityFactSchema),healthRecordBranch("habit_log",healthRecordHabitFactSchema)
]);
const healthDailySleepSourceSchema=z.object({id:stableId,total_minutes:z.number().int().nonnegative(),deep_minutes:z.number().int().nonnegative().nullable(),light_minutes:z.number().int().nonnegative().nullable(),rem_minutes:z.number().int().nonnegative().nullable(),awake_minutes:z.number().int().nonnegative().nullable(),source_type:z.string(),instance_key:z.string().nullable(),raw_id:stableId.nullable()}).strict();
export const healthDailyResultSchema=z.object({occurred_on:localDate,algorithm_version:z.string(),result:z.object({
  facts:z.array(z.object({kind:z.enum(["observation","measurement"]),id:stableId,key:z.string(),value:canonicalDecimal,unit:z.string()}).strict()).max(10_000),
  activity:z.object({steps:z.number().int().nonnegative().nullable(),steps_reconciliation:z.object({steps:z.number().int().nonnegative().nullable(),selected_origin:z.string().nullable(),policy:z.literal("nonoverlap-origin-max-v1"),day_attribution:z.literal("interval_start")}).strict(),active_minutes:z.number().int().nonnegative().nullable(),device_summary_calories_kcal:canonicalDecimal.nullable(),workout_sum_calories_kcal:canonicalDecimal.nullable(),calories_kcal:canonicalDecimal.nullable(),calories_source:z.enum(["device_summary","workout_sum","equal"]).nullable()}).strict().nullable(),
  sleep:healthDailySleepSourceSchema.extend({selection_policy:z.literal("longest_effective_session"),total_day_minutes:z.number().int().nonnegative(),naps:z.array(healthDailySleepSourceSchema),sources:z.array(z.object({session_id:stableId,source_type:z.string(),instance_key:z.string().nullable(),raw_id:stableId.nullable()}).strict())}).strict().nullable(),
  wellbeing:z.array(z.object({mood_score:z.number().int().min(0).max(10).nullable(),energy_level:z.number().int().min(0).max(10).nullable(),sleep_quality:z.number().int().min(0).max(10).nullable(),morning_erection:z.boolean().nullable(),notes:z.string().nullable()}).strict()).max(1_000),
  workouts:z.array(z.object({id:stableId,session_type:z.string(),started_at:instant.nullable(),duration_minutes:z.number().int().nonnegative().nullable(),distance_km:canonicalDecimal.nullable(),calories_kcal:canonicalDecimal.nullable(),rpe:z.number().int().min(0).max(10).nullable(),heart_rate_avg:z.number().int().positive().nullable(),detail:z.json().nullable()}).strict()).max(1_000),
  habits:z.array(z.object({id:stableId,habit_key:z.string(),done_count:z.number().int().nonnegative(),explicit_denial:z.boolean(),note:z.string().nullable()}).strict()).max(1_000)
}).strict(),source_set_hash:z.string().regex(/^[0-9a-f]{64}$/u),revision:z.number().int().positive(),updated_at:instant}).strict();
export const healthTrendInputSchema=z.object({metric_key:z.string().trim().min(1).max(100),from:localDate.optional(),to:localDate.optional(),limit:z.number().int().min(2).max(1000).default(100)}).strict().refine(value=>!value.from||!value.to||value.to>=value.from,{path:["to"],message:"to must not be before from"});
export const healthTrendResultSchema=z.object({metric_key:z.string(),points:z.array(z.object({id:stableId,occurred_on:localDate,value:canonicalDecimal,unit:z.string(),source_kind:z.string(),revision:z.number().int().positive()}).strict()),coverage:z.object({from:localDate.nullable(),to:localDate.nullable(),points:z.number().int().nonnegative(),truncated:z.boolean()}).strict(),as_of:instant}).strict();
export const healthSourcesInputSchema=z.object({}).strict();
export const healthSourcesResultSchema=z.object({items:z.array(z.object({id:stableId,source_type:z.string(),instance_key:z.string(),permission_state:z.string(),sync_epoch:z.number().int().positive(),fingerprint:z.string().nullable(),cursors:z.array(z.object({device_id:z.string(),record_type:z.string(),cursor:z.string().nullable(),state:z.string(),sync_epoch:z.number().int().positive(),updated_at:instant}).strict())}).strict()),as_of:instant}).strict();
export const getOperationInputSchema = z.object({ execution_id: stableId }).strict();

export type RecordMealInput = z.infer<typeof recordMealInputSchema>;
export type LifeOverviewDomain = z.infer<typeof lifeOverviewDomainSchema>;
export type LifeTimelineItem = z.infer<typeof lifeTimelineItemSchema>;
export type LifeSearchItem = z.infer<typeof lifeSearchItemSchema>;
export type RecordMealCommand = z.infer<typeof recordMealCommandEnvelopeSchema>;
export type WriteCapabilityName = z.infer<typeof writeCapabilityNameSchema>;
export type UniversalCommandEnvelope = z.infer<typeof universalCommandEnvelopeSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type ExecutionResult = z.infer<typeof executionResultSchema>;
export type OperationError = z.infer<typeof operationErrorSchema>;
export type MealView = z.infer<typeof mealViewSchema>;
export type MoneySummary = z.infer<typeof moneySummarySchema>;

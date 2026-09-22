import type { CapabilityName } from "@shadow/contracts";

/** Explicit personal operations only; server effects still authorize every call. */
export const personalOperatorTools: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
  "life.record_meal", "life.record_purchase", "life.record_dining",
  "life.correct_meal", "life.add_intake", "life.remove_intake", "life.correct_intake",
  "life.add_meal_payment", "life.attach_meal_source", "life.link_meal_consumption",
  "life.correct_purchase", "life.update_purchase_items", "life.set_personal_alias",
  "life.save_meal_template", "life.record_meal_from_template",
  "life.save_owned_item", "life.record_owned_item_event",
  "money.record_entry", "money.record_refund", "money.correct_entry", "money.set_use_cycle",
  "health.record_measurement", "health.correct_measurement", "health.record_workout",
  "travel.create_trip", "travel.correct_trip", "travel.add_reservation",
  "travel.correct_reservation", "travel.record_segment", "travel.record_visit", "travel.save_place",
  "travel.save_map",
  "library.capture", "library.revise", "library.annotate", "library.set_reading_state",
  "agent.set_memory", "notifications.set_preferences", "notifications.update",
  "life.today", "life.timeline", "life.search", "life.daily_record_check", "life.consumption_stats", "life.list_meals",
  "life.food_catalog", "life.get_record", "life.owned_items", "life.reviews",
  "money.summarize", "money.records", "money.planning",
  "health.records", "health.get_record", "health.trend", "health.sources", "health.daily",
  "travel.records", "travel.get_trip", "travel.workspace",
  "library.records", "library.get_item", "agent.memories", "notifications.list", "operations.get",
  "operations.find", "life.projects", "life.planning_agenda", "life.meal_planning", "money.foreign_entries",
  "life.save_project", "life.save_action_item", "life.save_meal_plan", "life.build_shopping_list", "life.update_shopping_item",
  "life.save_food", "life.save_recipe", "life.record_meal_from_recipe", "life.generate_review",
  "money.set_budget", "money.set_recurring_plan", "money.set_spending_intent", "money.set_occurrence_state",
  "money.record_foreign_entry", "health.set_plan", "travel.set_day_plan",
]);

export type McpProfile = "personal" | "authorized";
export function profileAllows(profile: McpProfile, name: CapabilityName): boolean {
  return profile === "authorized" || personalOperatorTools.has(name);
}

export const operatorInstructions = `Use Life for authoritative personal facts. Ordinary recording and corrections need no extra confirmation.
Prefer life.record_dining for an eaten meal plus purchase/payment and multiple images; life.record_purchase for purchases without confirmed intake.
Upload relevant original images with assets.upload_local_image and link every asset_version_id. OCR text is evidence, not an attached image.
A gift, ordered item or purchased quantity does not prove consumption. Preserve uncertainty; omit unknown nutrition, amounts and clock times.
For "same as usual", query life.food_catalog or recent records first; reuse an explicit template. Do not copy a historical clock time as today's actual time.
Use stable cmd_ keys. On outcome_unknown call operations.find with the original command_id, then retry identical input/key only if needed. Never replace the key to bypass a conflict.
Read the affected object after a correction or image association; use receipt resource IDs and current revisions. For dining, get consumption_record_id to verify all images and meal_id to verify intake.
Use life.search with dates for history; follow next_cursor until the requested page range is complete. Rankings use life.consumption_stats with explicit period, unit and currency.
Daily checks use life.daily_record_check once for the requested local date/time zone; only confirmed_omissions/actionable_messages justify an omission. Weekly checks cover every requested date.
If a tool is absent, refresh the MCP catalog or report unavailable. Never use retired services, shell or SQL to substitute for Life.`;

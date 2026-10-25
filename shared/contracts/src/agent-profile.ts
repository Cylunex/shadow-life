import type { CapabilityName } from "./registry.js";
import { agentScenarios } from "./agent-catalog.js";
import type { AgentScenarioName } from "./agent-schemas.js";

/** Explicit personal operations only; server effects still authorize every call. */
export const personalOperatorTools: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
  "agent.restore", "agent.intentions", "agent.workspace", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.export", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes",
  "agent.context", "agent.discover", "agent.glossary", "agent.scenarios", "agent.catalog", "life.day", "life.memories", "life.set_food_stock",
  "life.record_meal", "life.record_purchase", "life.record_dining",
  "life.correct_meal", "life.add_intake", "life.remove_intake", "life.correct_intake",
  "life.add_meal_payment", "life.attach_meal_source", "life.link_meal_consumption",
  "life.correct_purchase", "life.update_purchase_items", "life.set_personal_alias",
  "life.save_meal_template", "life.record_meal_from_template",
  "life.save_owned_item", "life.record_owned_item_event",
  "money.save_service_card", "money.record_service_card_use", "money.service_cards",
  "money.record_entry", "money.record_refund", "money.correct_entry", "money.set_use_cycle", "money.record_consumable_use",
  "health.record_measurement", "health.correct_measurement", "health.record_workout",
  "travel.create_trip", "travel.correct_trip", "travel.add_reservation",
  "travel.correct_reservation", "travel.record_segment", "travel.record_visit", "travel.save_place",
  "travel.save_map",
  "library.capture", "library.revise", "library.annotate", "library.set_reading_state",
  "agent.set_memory", "notifications.set_preferences", "notifications.update",
  "life.today", "life.timeline", "life.search", "life.daily_record_check", "life.consumption_stats", "life.list_meals",
  "life.food_catalog", "life.get_record", "life.owned_items", "life.reviews",
  "money.summarize", "money.records", "money.planning",
  "money.stage_import", "money.resolve_import_candidate", "money.import_review", "money.import_history", "money.import_month",
  "health.records", "health.get_record", "health.trend", "health.sources", "health.daily", "health.sleep_insights", "life.wellness_review", "health.workout_progression",
  "travel.records", "travel.get_trip", "travel.workspace",
  "library.records", "library.get_item", "agent.memories", "notifications.list", "operations.get",
  "operations.find", "life.projects", "life.planning_agenda", "life.meal_planning", "money.foreign_entries",
  "life.save_project", "life.save_action_item", "life.save_meal_plan", "life.build_shopping_list", "life.update_shopping_item",
  "life.save_food", "life.save_recipe", "life.record_meal_from_recipe", "life.generate_review",
  "money.set_budget", "money.set_recurring_plan", "money.set_spending_intent", "money.set_occurrence_state",
  "money.record_foreign_entry", "health.set_plan", "travel.set_day_plan",
]);

export type McpProfile = "personal" | "personal-money-void" | "authorized";
export function profileAllows(profile: McpProfile, name: CapabilityName, scenario?: AgentScenarioName): boolean {
  const inProfile = profile === "authorized" || personalOperatorTools.has(name) || profile === "personal-money-void" && name === "money.void_entry";
  const common = name.startsWith("agent.") && ["agent.context", "agent.discover", "agent.glossary", "agent.scenarios", "agent.catalog", "agent.intentions", "agent.workspace", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.export", "agent.set_intention", "agent.save_task", "agent.save_learning", "agent.set_subscription", "agent.ack_changes", "agent.restore"].includes(name) || name === "operations.find" || name === "operations.get";
  return inProfile && (!scenario || common || agentScenarios.find(item => item.name === scenario)?.capabilities.includes(name) === true);
}

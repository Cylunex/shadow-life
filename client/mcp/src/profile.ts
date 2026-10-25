import { agentDiscoveryInstructions } from "@shadow/contracts";
export { personalOperatorTools, profileAllows, type McpProfile } from "@shadow/contracts";

export const operatorInstructions = `Use Life for authoritative personal facts. Ordinary recording and corrections need no extra confirmation.
${agentDiscoveryInstructions.join("\n")}
Prefer life.record_dining for an eaten meal plus purchase/payment and multiple images; life.record_purchase for purchases without confirmed intake.
Upload relevant original images with assets.upload_local_image and link every asset_version_id. OCR text is evidence, not an attached image.
A gift, ordered item or purchased quantity does not prove consumption. Preserve uncertainty; omit unknown nutrition, amounts and clock times.
For each consumed food, record energy_kcal and all three macros (protein_g, fat_g, carb_g) when a label, catalog entry, or defensible portion estimate supports them. Mark estimates with estimate=true and explain the basis in evidence_note; never fill unknown macros with zero or infer them solely from calories.
For a habitual branded drink, query life.food_catalog before recording it. A supported zero value must be sent as "0"; a missing catalog field remains unknown.
For "same as usual", query life.food_catalog or recent records first; reuse an explicit template. Do not copy a historical clock time as today's actual time.
For tracked consumables, use life.record_purchase.consumables to create pending cycles atomically with a new purchase; for history link money.set_use_cycle to the original purchase item. Pending is not current stock. Read user exclusions and never convert package counts without evidence. expected_daily_usage is only an estimate; record actual manual consumption with money.record_consumable_use after explicit opening, and never double-deduct a cycle already matched to meal intake. Preserve original command IDs for retries and current revisions for edits.
For prepaid service cards, link money.save_service_card to the existing purchase and its stated total units. Buying a card does not prove it was used. Query money.service_cards before logging an explicit actual use with money.record_service_card_use; do not add another expense unless extra money was paid. Use use_id and the current card revision to correct or void a mistaken deduction.
Use stable cmd_ keys. On outcome_unknown call operations.find with the original command_id, then retry identical input/key only if needed. Never replace the key to bypass a conflict.
Read the affected object after a correction or image association; use receipt resource IDs and current revisions. For dining, get consumption_record_id to verify all images and meal_id to verify intake.
Use life.search with dates for history; follow next_cursor until the requested page range is complete. Rankings use life.consumption_stats with explicit period, unit and currency.
Before voiding a mistaken money entry, read its exact record and current revision, confirm which entry is wrong, then call money.void_entry with a reason and stable command_id. Read back state=voided. Voided entries remain in history; count only confirmed entries as active.
Daily checks use life.daily_record_check once for the requested local date/time zone; only confirmed_omissions/actionable_messages justify an omission. Weekly checks cover every requested date.
If a tool is absent, refresh the MCP catalog or report unavailable. Never use retired services, shell or SQL to substitute for Life.`;

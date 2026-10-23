import { z } from "zod";
import { canonicalDecimal, instant, localDate, stableId } from "./schemas.js";

export const wellnessReviewInputSchema = z.object({
  to: localDate,
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(7)
}).strict().refine(input => input.to >= "0002-01-01", {path:["to"],message:"date must allow a preceding comparison window"});
export const wellnessNutrients = ["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg"] as const;
const count = z.number().int().nonnegative();
export const nutrientCoverageSchema = z.object({
  known_total: canonicalDecimal.nullable(), known_items: count, estimated_items: count
}).strict();
const nutrients = z.object(Object.fromEntries(wellnessNutrients.map(key => [key, nutrientCoverageSchema])) as Record<typeof wellnessNutrients[number], typeof nutrientCoverageSchema>).strict();
const ref = z.object({id:stableId, revision:z.number().int().positive()}).strict();
export const wellnessDaySchema = z.object({
  date:localDate, meals:count, items:count, empty_meals:count, nutrients,
  sleep:ref.extend({minutes:count}).nullable(),
  weight:ref.extend({value:canonicalDecimal, unit:z.literal("kg"), kind:z.enum(["measurement","observation"])}).nullable(),
  workouts:z.object({sessions:count, known_duration_sessions:count, minutes:count.nullable()}).strict()
}).strict();
const nutrientSummary = nutrientCoverageSchema.extend({complete_days:count, average_on_complete_days:canonicalDecimal.nullable()});
const summary = z.object({
  from:localDate, to:localDate, days:count, meal_days:count, meals:count, items:count,
  nutrients:z.object(Object.fromEntries(wellnessNutrients.map(key => [key,nutrientSummary])) as Record<typeof wellnessNutrients[number], typeof nutrientSummary>).strict(),
  sleep_days:count, average_sleep_minutes:count.nullable(), weight_days:count, average_weight_kg:canonicalDecimal.nullable(),
  workout_days:count, workout_sessions:count, known_workout_duration_sessions:count, workout_minutes:count.nullable(),
  paired_energy_weight_days:count, paired_energy_sleep_days:count
}).strict();
export const wellnessReviewResultSchema = z.object({
  algorithm_version:z.literal("wellness-review-v1"), date_policy:z.literal("recorded_local_date_sleep_wake_date"),
  current:summary, previous:summary, days:z.array(wellnessDaySchema).max(90),
  limitations:z.array(z.string()).max(12), as_of:instant
}).strict();
export type WellnessReviewInput = z.infer<typeof wellnessReviewInputSchema>;
export type WellnessDay = z.infer<typeof wellnessDaySchema>;
export type WellnessReviewResult = z.infer<typeof wellnessReviewResultSchema>;

import { z } from "zod";
import { dietFoodGroups, ianaTimeZone, instant, localDate, stableId } from "./schemas.js";
import { wellnessReviewResultSchema } from "./wellness-schemas.js";

export { dietFoodGroups } from "./schemas.js";
export const dietFoodGroupLabels = {vegetables:"蔬菜",fruit:"水果",dairy:"奶类",soy:"豆类",whole_grains:"全谷物"} as const;
export const dietDiaryStatements = {complete:"当天进食已结束，饮食已基本记全",partial:"当天饮食还有漏记"} as const;
export const dietDiaryKey = (date:string,timeZone:string) => `wellness.diary.${date}.${timeZone}`;
export const dietReviewInputSchema = z.object({
  to:localDate,
  days:z.coerce.number().pipe(z.union([z.literal(1),z.literal(7),z.literal(30)])).default(7),
  time_zone:ianaTimeZone.default("Asia/Shanghai")
}).strict().refine(value=>value.to>="0002-01-01" && value.to<"9999-12-31","Date must allow comparison and overnight measurements");

const ref = z.object({id:stableId,revision:z.number().int().positive()}).strict();
const count = z.number().int().nonnegative();
const metric = z.enum(["body_fat","muscle_mass","body_water_rate","visceral_fat"] as const);
const point = ref.extend({
  date:localDate, occurred_at:instant, kg:z.number().positive(), smoothed_kg:z.number().positive(),
  composition:z.array(ref.extend({metric,value:z.number(),unit:z.string(),method:z.string().nullable()}))
});
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export const weighingScheduleSchema=z.object({
  morning_from:clock,morning_to:clock,evening_from:clock,evening_to:clock,scale_id:stableId.nullable()
}).strict().refine(p=>p.morning_from<p.morning_to&&p.morning_to<=p.evening_from&&p.evening_from!==p.evening_to&&
  (p.evening_to>p.evening_from||p.evening_to<=p.morning_from),"Morning and evening windows must be nonempty and disjoint");
export const defaultWeighingSchedule={morning_from:"05:00",morning_to:"11:00",evening_from:"18:00",evening_to:"03:00",scale_id:null} as const;
const comparison=z.object({days:count,mean:z.number().nullable()}).strict();
const bodyComparison=z.object({band:z.enum(["morning","evening"]),metric,method:z.string().nullable(),unit:z.string(),
  current:comparison,previous:comparison}).strict();
const weightWeek = z.object({from:localDate,to:localDate,days:count,mean_kg:z.number().nullable(),min_kg:z.number().nullable(),max_kg:z.number().nullable()}).strict();
const lunch = ref.extend({date:localDate, items: count, classified_items:count, groups:z.array(z.enum(dietFoodGroups)),
  staples:z.array(z.string()), known_staple_grams:z.number().nonnegative().nullable(), weighed_staples:count, estimated_staples:count, estimated_items:count, energy_kcal:z.number().nonnegative().nullable()});
const goal = ref.extend({direction:z.enum(["maintain","gain","lose"])});
export const dietReviewResultSchema = z.object({
  wellness:wellnessReviewResultSchema,
  time_zone:ianaTimeZone,
  diary:z.array(z.object({date:localDate,state:z.enum(["complete","partial","recheck","unknown"]),declaration:ref.nullable()}).strict()),
  recorded_complete_days:count,
  complete_energy_days:count,
  food_groups:z.array(z.object({group:z.enum(dietFoodGroups),days:count,lunches:count}).strict()),
  micronutrients:z.array(z.object({nutrient:z.enum(["calcium_mg","iron_mg"]),known_total:z.number().nullable(),known_items:count,estimated_items:count}).strict()).optional(),
  group_days:count,
  unclassified_days:count,
  lunch_count:count,
  lunches:z.array(lunch),
  menu:z.object({merchant:z.string(),dishes:z.array(z.string())}).nullable(),
  next_meal:z.object({text:z.string(),meal:ref.nullable()}).strict().nullable(),
  weight_followup:z.object({text:z.string(),meals:z.array(ref)}).strict().nullable().optional(),
  energy:z.object({status:z.enum(["above","below","within","unknown"]),lower:z.number().nullable(),upper:z.number().nullable(),reliable_kcal:z.number().nullable(),target:ref.nullable()}).strict(),
  weight:z.object({
    source_count:count,
    settings: z.object({schedule:weighingScheduleSchema,declaration:ref.nullable(),selected_scale:stableId.nullable(),
      scales:z.array(z.object({id:stableId,label:z.string(),days:count}).strict())}).strict().optional(),
    composition:z.array(bodyComparison).optional(),waist_goal:ref.extend({direction:z.enum(["maintain","gain","lose"])}).nullable().optional(),
    morning:z.array(point),evening:z.array(point),weeks:z.array(weightWeek),
    weekly_change_kg:z.number().nullable(),trend:z.enum(["up","down","steady","uncertain"]),
    goal:goal.nullable(), alignment:z.enum(["aligned","off_track","uncertain"]), waist:z.array(ref.extend({date:localDate,cm:z.number().positive()}))
  }).strict().nullable(),
  background:z.object({step_days:count,median_steps:z.number().nullable(),sleep_days:count,mean_sleep_minutes:z.number().nullable(),
    active_days:count.optional(),median_active_minutes:z.number().nullable().optional(),latest:z.object({
      state:z.enum(["reported","pending","missing"]),steps:z.number().nullable(),active_minutes:z.number().nullable()
    }).strict().optional()}).strict().nullable()
}).strict();
export type DietReviewInput = z.infer<typeof dietReviewInputSchema>;
export type DietReviewResult = z.infer<typeof dietReviewResultSchema>;

export const mealDietReviewInputSchema=z.object({meal_id:stableId}).strict();
const mealNutrientKeys=["energy_kcal","protein_g","fat_g","carb_g","fiber_g","sodium_mg","calcium_mg","iron_mg"] as const;
export const mealDietNutrients=mealNutrientKeys;
export const mealDietReviewResultSchema=ref.extend({
  date:localDate,type:z.string(),as_of:instant,items:z.array(ref.extend({
    name:z.string(),food_id:stableId.nullable(),food_revision:z.number().int().positive().nullable(),
    merchant:z.string().nullable(),stall:z.string().nullable(),groups:z.array(z.enum(dietFoodGroups)),staple:z.boolean(),
    consumed_fraction:z.number().min(0).max(1).nullable(),quantity:z.number().nullable(),unit:z.string().nullable(),
    grams:z.number().nullable(),estimated:z.boolean(),weight_basis:z.enum(["measured_net","payment_derived"]).nullable(),
    basis:z.string().nullable(),nutrients:z.partialRecord(z.enum(mealNutrientKeys),z.number().nonnegative())
  })),
  totals:z.array(z.object({nutrient:z.enum(mealNutrientKeys),known_total:z.number().nullable(),known_items:count,estimated_items:count}).strict()),
  consumed_items:count, known_staple_grams:z.number().nullable(),staples_with_grams:count,staples:count
});
export type MealDietReviewResult=z.infer<typeof mealDietReviewResultSchema>;

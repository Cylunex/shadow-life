import { z } from "zod";
import { ianaTimeZone, instant, localDate, stableId } from "./schemas.js";
import { wellnessReviewResultSchema } from "./wellness-schemas.js";

export const dietFoodGroups = ["vegetables", "fruit", "dairy", "soy", "whole_grains"] as const;
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
  group_days:count,
  unclassified_days:count,
  lunch_count:count,
  lunches:z.array(lunch),
  menu:z.object({merchant:z.string(),dishes:z.array(z.string())}).nullable(),
  next_meal:z.object({text:z.string(),meal:ref.nullable()}).strict().nullable(),
  energy:z.object({status:z.enum(["above","below","within","unknown"]),lower:z.number().nullable(),upper:z.number().nullable(),reliable_kcal:z.number().nullable(),target:ref.nullable()}).strict(),
  weight:z.object({
    source_count:count, morning:z.array(point),evening:z.array(point),weeks:z.array(weightWeek),
    weekly_change_kg:z.number().nullable(),trend:z.enum(["up","down","steady","uncertain"]),
    goal:goal.nullable(), alignment:z.enum(["aligned","off_track","uncertain"]), waist:z.array(ref.extend({date:localDate,cm:z.number().positive()}))
  }).strict().nullable(),
  background:z.object({step_days:count,median_steps:z.number().nullable(),sleep_days:count,mean_sleep_minutes:z.number().nullable()}).strict().nullable()
}).strict();
export type DietReviewInput = z.infer<typeof dietReviewInputSchema>;
export type DietReviewResult = z.infer<typeof dietReviewResultSchema>;

import { wellnessNutrients, wellnessReviewResultSchema, type WellnessDay, type WellnessReviewInput } from "@shadow/contracts";

export function shiftWellnessDate(date:string, days:number):string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0,10);
}
export function wellnessWindow(input:WellnessReviewInput) {
  const from = shiftWellnessDate(input.to, 1-input.days);
  return {from, previousFrom:shiftWellnessDate(from,-input.days), previousTo:shiftWellnessDate(from,-1)};
}
const scaled=(value:string):bigint=>{const [whole="0",fraction=""]=value.split(".");return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0"));};
const decimal=(value:bigint):string=>`${value/1000000n}.${(value%1000000n).toString().padStart(6,"0")}`.replace(/\.?0+$/u,"");
function sum(values:string[]):string|null {return values.length?decimal(values.reduce((total,value)=>total+scaled(value),0n)):null;}
function average(values:string[]):string|null {return values.length?decimal((values.reduce((total,value)=>total+scaled(value),0n)+BigInt(values.length)/2n)/BigInt(values.length)):null;}
const complete=(day:WellnessDay,key:typeof wellnessNutrients[number])=>day.items>0&&day.empty_meals===0&&day.nutrients[key].known_items===day.items;
function summarize(days:WellnessDay[]) {
  const sleeps=days.flatMap(day=>day.sleep?[day.sleep.minutes]:[]), weights=days.flatMap(day=>day.weight?[day.weight.value]:[]);
  return {
    from:days[0]!.date,to:days.at(-1)!.date,days:days.length,
    meal_days:days.filter(day=>day.meals>0).length, meals:days.reduce((n,day)=>n+day.meals,0),items:days.reduce((n,day)=>n+day.items,0),
    nutrients:Object.fromEntries(wellnessNutrients.map(key=>[key,{
      known_total:sum(days.flatMap(day=>day.nutrients[key].known_total===null?[]:[day.nutrients[key].known_total!])),
      known_items:days.reduce((n,day)=>n+day.nutrients[key].known_items,0),estimated_items:days.reduce((n,day)=>n+day.nutrients[key].estimated_items,0),
      complete_days:days.filter(day=>complete(day,key)).length,
      average_on_complete_days:average(days.filter(day=>complete(day,key)).map(day=>day.nutrients[key].known_total!))
    }])),
    sleep_days:sleeps.length,average_sleep_minutes:sleeps.length?Math.round(sleeps.reduce((a,b)=>a+b,0)/sleeps.length):null,
    weight_days:weights.length,average_weight_kg:average(weights),
    workout_days:days.filter(day=>day.workouts.sessions>0).length,workout_sessions:days.reduce((n,day)=>n+day.workouts.sessions,0),
    known_workout_duration_sessions:days.reduce((n,day)=>n+day.workouts.known_duration_sessions,0),
    workout_minutes:days.some(day=>day.workouts.minutes!==null)?days.reduce((n,day)=>n+(day.workouts.minutes??0),0):null,
    paired_energy_weight_days:days.filter(day=>complete(day,"energy_kcal")&&day.weight!==null).length,
    paired_energy_sleep_days:days.filter(day=>complete(day,"energy_kcal")&&day.sleep!==null).length
  };
}
export function buildWellnessReview(rows:WellnessDay[],input:WellnessReviewInput,asOf:string) {
  const {from}=wellnessWindow(input), current=rows.filter(day=>day.date>=from),previous=rows.filter(day=>day.date<from);
  return wellnessReviewResultSchema.parse({algorithm_version:"wellness-review-v1",date_policy:"recorded_local_date_sleep_wake_date",
    current:summarize(current),previous:summarize(previous),days:current,as_of:asOf,limitations:[
      "按记录自己的本地日期归组；睡眠归醒来日，跨时区旅行不重新归日。",
      "营养按食用比例计算（未填比例视为 1）；已知合计可能只是部分记录，未知不当零。",
      "均值仅含该营养字段在所有已记录条目中齐全且无空餐次的日期，不证明全天无漏记；估算仍计入并单列数量。",
      "体重仅取每天最后一次非自动补值的 kg 测量；日期相同但时刻未知的记录按创建时间排序。",
      "睡眠取醒来日最长有效会话；训练仅含有效执行记录，缺失时长不当零。",
      "同日覆盖和前期对照仅供观察，不证明因果，不生成热量缺口、TDEE 或医疗结论。"
    ]});
}

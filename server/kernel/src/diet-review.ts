import {
  defaultWeighingSchedule, dietDiaryKey, dietDiaryStatements, dietFoodGroups, dietReviewResultSchema, mealDietNutrients, mealDietReviewResultSchema, weighingScheduleSchema,
  type DietReviewInput, type DietReviewResult, type MealDietReviewResult, type WellnessDay,
} from "@shadow/contracts";
import { buildWellnessReview, shiftWellnessDate } from "./wellness-review.js";

type Ref = {id:string; revision:number};
type FoodGroup = typeof dietFoodGroups[number];
type BodyMetric = "body_fat" | "muscle_mass" | "body_water_rate" | "visceral_fat";
export type DietEvidence = {
  as_of:string;
  days:WellnessDay[];
  meals:(Ref & {date:string; type:string; merchant:string|null; items:{
    name:string; estimated:boolean; energy_kcal:number|null; calcium_mg?:number|null;iron_mg?:number|null; grams:number|null; groups?:FoodGroup[]|null; staple?:boolean|null;
  }[]})[];
  healthTargets?:DietReviewResult["health_targets"];
  intentions:(Ref & {key:string; statement:string; recheck:boolean})[];
  measurements:(Ref & {
    date:string; occurred_at:string; source:string; session:string; metric:string;
    value:number; unit:string; method:string|null;
  })[];
  activity:{date:string; steps:number|null;active_minutes?:number|null}[];
  menu:{merchant:string; dishes:{name:string;groups:FoodGroup[]|null}[]}|null;
};

const foodPatterns:Record<FoodGroup,RegExp> = {
  vegetables:/青菜|油麦菜|白菜|包菜|卷心菜|芥蓝|菠菜|西兰花|花菜|生菜|空心菜|小白菜|苋菜|菜心|茼蒿|青江菜|小油菜|黄瓜|西葫芦|茄子|冬瓜|胡萝卜|芹菜|西红柿|番茄|韭菜|豆芽|四季豆|豆角|白萝卜|蘑菇|菌菇|香菇|笋片|绿叶菜|清炒时蔬|青椒|彩椒|broccoli|spinach|carrot|cabbage|cucumber/u,
  fruit:/苹果|梨(?!汁)|香蕉|草莓|蓝莓|橘子|橙子|脆柿|砂糖橘|西瓜|葡萄|猕猴桃|柚子|火龙果|桃子|圣女果|apple\b|banana\b|berries\b/u,
  dairy:/牛奶|鲜奶|酸奶|无糖酸乳|奶酪|乳酪|yogurt|cow.?s milk|cheese/u,
  soy:/豆腐|豆干|香干|千张|腐竹|毛豆|黄豆|黑豆|豆浆|鹰嘴豆|lentil|chickpea|\btofu\b/u,
  whole_grains:/燕麦片|燕麦粥|糙米|全麦|荞麦|小米粥|玉米(?!淀粉|油)|藜麦|黑米饭|紫米饭|whole wheat|\boats\b|brown rice/u
};
const otherRecognizable = /米饭|馒头|面条|吐司|包子|鸡蛋|炒蛋|鸡[胸腿块肉]|排骨|牛肉|羊肉|猪肉|肉丝|肉片|瘦肉|肘子|鱼片|鱼排|红薯|地瓜|南瓜|马铃薯|土豆|纯水|矿泉水|茶饮|甜饮|咖啡|rice\b|\beggs?\b/u;
const staple = /^(?:白?米饭|白饭|黑米(?:饭)?|紫米饭|杂粮饭|糙米饭|蒸?(?:紫薯|红薯|地瓜|南瓜|玉米)|甜玉米段|小?馒头|面条)/u;
const mixedDish = /炒肉|肉丝|肉片|鸡肉|牛肉|猪肉|排骨|炒蛋|鸡蛋|鱼豆腐|鱼片|酥|饼|酱|汁/u;

export function classifyDietFood(name:string): FoodGroup[] {
  const plain=name.toLowerCase();
  return dietFoodGroups.filter(group=>{
    const candidate=group==="soy"?plain.replace(/鱼豆腐/g,""):plain;
    if(group==="fruit" && /果汁|果酱|风味|味糖/u.test(candidate))return false;
    if(group==="dairy" && /奶茶|风味|味糖|植物/u.test(candidate))return false;
    return foodPatterns[group].test(candidate);
  });
}

const itemGroups = (item:{name:string;groups?:FoodGroup[]|null})=>item.groups??classifyDietFood(item.name);
const isStaple = (item:{name:string;staple?:boolean|null})=>item.staple??staple.test(item.name);
const mean = (values:number[])=>values.length?values.reduce((total,value)=>total+value,0)/values.length:null;
const round = (value:number)=>Math.round(value*100)/100;
const sumKnown = (values:(number|null)[])=>values.some(value=>value!==null)?values.reduce<number>((sum,value)=>sum+(value??0),0):null;
const bodyUnits:Record<BodyMetric,string> = {body_fat:"%",muscle_mass:"kg",body_water_rate:"%",visceral_fat:"level"};

export function dietWindow(input:DietReviewInput) {
  const from=shiftWellnessDate(input.to,1-input.days);
  return {from,previousFrom:shiftWellnessDate(from,-input.days),weightFrom:shiftWellnessDate(input.to,-29)};
}

function measurements(evidence:DietEvidence,input:DietReviewInput,allowed:boolean):DietReviewResult["weight"] {
  if(!allowed)return null;
  const {weightFrom}=dietWindow(input);
  const preference=evidence.intentions.find(row=>row.key==="wellness.weighing");
  const schedule=readSchedule(preference?.statement);
  const overnight=schedule.evening_to<schedule.evening_from;
  const allowedMetrics:Record<string,string>={weight:"kg",...bodyUnits};
  const estimates=new Map<string,DietEvidence["measurements"]>();
  for(const row of evidence.measurements) {
    if(row.metric==="weight" || allowedMetrics[row.metric]!==row.unit)continue;
    const related=estimates.get(row.session)??[];
    related.push(row);
    estimates.set(row.session,related);
  }
  const sources=new Map<string,{label:string;morning:Map<string,DietEvidence["measurements"][number]>;evening:Map<string,DietEvidence["measurements"][number]>}>();
  const clock=new Intl.DateTimeFormat("en-GB",{timeZone:input.time_zone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  for(const row of evidence.measurements) {
    if(row.metric!=="weight"||row.unit!=="kg"||row.value<=0)continue;
    const time=clock.format(new Date(row.occurred_at));
    const morning=time>=schedule.morning_from&&time<schedule.morning_to;
    const evening=overnight?time>=schedule.evening_from||time<schedule.evening_to:time>=schedule.evening_from&&time<schedule.evening_to;
    const period=morning?"morning":evening?"evening":null;
    const bands=sources.get(row.source)??{label:row.method?.replace(/:weight$/u,"")??"体脂秤",morning:new Map(),evening:new Map()};
    sources.set(row.source,bands);
    if(!period)continue;
    const date=period==="evening"&&overnight&&time<schedule.evening_to?shiftWellnessDate(row.date,-1):row.date;
    if(date<weightFrom||date>input.to)continue;
    const previous=bands[period].get(date);
    if(!previous || (period==="morning"?row.occurred_at<previous.occurred_at:row.occurred_at>previous.occurred_at))bands[period].set(date,row);
  }
  // Select one scale for the entire report, favoring usable morning coverage.
  const orderedSources=[...sources.entries()].sort(([,a],[,b])=>b.morning.size-a.morning.size||b.evening.size-a.evening.size);
  const selected=schedule.scale_id??orderedSources[0]?.[0]??null;
  const bands=selected?sources.get(selected):undefined;
  function points(rows:Map<string,DietEvidence["measurements"][number]>|undefined) {
    let lastDate:string|undefined, smoothed=0;
    return [...(rows??[])].sort(([a],[b])=>a.localeCompare(b)).map(([date,row])=>{
      const gap=lastDate?(Date.parse(date)-Date.parse(lastDate))/86400000:0;
      smoothed=lastDate?smoothed+(row.value-smoothed)*(1-0.9**gap):row.value;
      lastDate=date;
      const composition=(estimates.get(row.session)??[]).map(value=>({
        id:value.id,revision:value.revision,metric:value.metric as BodyMetric,value:value.value,unit:value.unit,method:value.method
      }));
      return {id:row.id,revision:row.revision,date,occurred_at:row.occurred_at,kg:row.value,smoothed_kg:round(smoothed),composition};
    });
  }
  const morning=points(bands?.morning),evening=points(bands?.evening);
  const weeks=[3,2,1,0].map(offset=>{
    const to=shiftWellnessDate(input.to,-offset*7),from=shiftWellnessDate(to,-6);
    const values=morning.filter(row=>row.date>=from&&row.date<=to).map(row=>row.kg);
    return {from,to,days:values.length,mean_kg:mean(values),min_kg:values.length?Math.min(...values):null,max_kg:values.length?Math.max(...values):null};
  });
  const compare=(before:typeof weeks[number],after:typeof weeks[number])=>
    before.days>=3&&after.days>=3?after.mean_kg!-before.mean_kg!:null;
  const change=compare(weeks[2]!,weeks[3]!);
  const changes=weeks.slice(1).map((week,i)=>compare(weeks[i]!,week));
  const first=weeks[0]!, last=weeks[3]!;
  const trend=changes.every(value=>value!==null&&value>0.1)&&last.min_kg!>first.max_kg!?"up":
    changes.every(value=>value!==null&&value< -0.1)&&last.max_kg!<first.min_kg!?"down":
    changes.every(value=>value!==null&&Math.abs(value)<0.15)?"steady":"uncertain";
  const goalRow=evidence.intentions.find(row=>row.key==="wellness.weight");
  const direction=goalRow?.statement==="维持体重"?"maintain":goalRow?.statement==="增加体重"?"gain":goalRow?.statement==="降低体重"?"lose":null;
  const goal:NonNullable<DietReviewResult["weight"]>["goal"]=goalRow&&direction?{id:goalRow.id,revision:goalRow.revision,direction}:null;
  const alignment=!goal||trend==="uncertain"?"uncertain":
    (goal.direction==="maintain"?trend==="steady":goal.direction==="gain"?trend==="up":trend==="down")?"aligned":"off_track";
  const waist=evidence.measurements.filter(row=>row.metric==="waist"&&row.unit==="cm"&&row.date>=weightFrom&&row.date<=input.to&&row.value>0)
    .map(row=>({id:row.id,revision:row.revision,date:row.date,cm:row.value}));
  const waistRow=evidence.intentions.find(row=>row.key==="wellness.waist");
  const waistDirection=waistRow?.statement==="维持腰围"?"maintain":waistRow?.statement==="增加腰围"?"gain":waistRow?.statement==="减小腰围"?"lose":null;
  const waist_goal:NonNullable<DietReviewResult["weight"]>["waist_goal"]=waistRow&&waistDirection?{id:waistRow.id,revision:waistRow.revision,direction:waistDirection}:null;
  return {source_count:sources.size,morning,evening,weeks:weeks.map(w=>({...w,mean_kg:w.mean_kg===null?null:round(w.mean_kg)})),
    settings:{schedule,declaration:preference?{id:preference.id,revision:preference.revision}:null,selected_scale:selected,
      scales:orderedSources.map(([id,values])=>({id,label:values.label,days:new Set([...values.morning.keys(),...values.evening.keys()]).size}))},
    composition:[...compareComposition(morning,"morning",weeks[2]!.from,weeks[3]!.from),...compareComposition(evening,"evening",weeks[2]!.from,weeks[3]!.from)],
    weekly_change_kg:change===null?null:round(change),trend,goal,alignment,waist,waist_goal};
}

function readSchedule(statement:string|undefined) {
  if(!statement)return defaultWeighingSchedule;
  try {
    const value=weighingScheduleSchema.safeParse(JSON.parse(statement));
    return value.success?value.data:defaultWeighingSchedule;
  }catch{return defaultWeighingSchedule;}
}

function compareComposition(points:NonNullable<DietReviewResult["weight"]>["morning"],band:"morning"|"evening",from:string,currentFrom:string) {
  const groups=new Map<string,{metric:BodyMetric;unit:string;method:string|null;current:number[];previous:number[]}>();
  for(const point of points){
    if(point.date<from)continue;
    for(const item of point.composition){
      const key=JSON.stringify([item.metric,item.unit,item.method]);
      const value=groups.get(key)??{metric:item.metric,unit:item.unit,method:item.method,current:[],previous:[]};
      value[point.date>=currentFrom?"current":"previous"].push(item.value);
      groups.set(key,value);
    }
  }
  const summary=(values:number[])=>({days:values.length,mean:values.length?round(mean(values)!):null});
  return [...groups.values()].map(value=>({...value,band,current:summary(value.current),previous:summary(value.previous)}));
}

const median=(values:number[])=>{
  const sorted=values.slice().sort((a,b)=>a-b);
  return sorted.length?mean([sorted[Math.floor((sorted.length-1)/2)]!,sorted[Math.floor(sorted.length/2)]!]):null;
};

export function buildDietReview(evidence:DietEvidence,input:DietReviewInput,healthAllowed:boolean) {
  const {from}=dietWindow(input),recentFrom=shiftWellnessDate(input.to,-6);
  const grouped=new Map<FoodGroup,Set<string>>(dietFoodGroups.map(group=>[group,new Set()]));
  const groupDays=new Set<string>(),unclassifiedDays=new Set<string>();
  const currentMeals=evidence.meals.filter(meal=>meal.date>=from);
  const recentMeals=evidence.meals.filter(meal=>meal.date>=recentFrom);
  const lunches:DietReviewResult["lunches"]=[];
  const lunchMatches=(meal:DietEvidence["meals"][number])=>meal.type==="lunch"&&meal.items.length>0&&
    (!evidence.menu || meal.merchant?.toLowerCase()===evidence.menu.merchant.toLowerCase());
  for(const meal of currentMeals) {
    const groups=new Set<FoodGroup>();
    let classified=0;
    for(const item of meal.items) {
      const groupsForItem=itemGroups(item);
      for(const group of groupsForItem){
        groups.add(group);
        grouped.get(group)!.add(meal.date);
      }
      if(item.groups!==null&&item.groups!==undefined||groupsForItem.length || otherRecognizable.test(item.name)||isStaple(item))classified++;
    }
    if(classified>0)groupDays.add(meal.date);
    if(classified<meal.items.length || !meal.items.length)unclassifiedDays.add(meal.date);
    if(lunchMatches(meal)){
      const staples=meal.items.filter(isStaple);
      lunches.push({id:meal.id,revision:meal.revision,date:meal.date,items:meal.items.length,classified_items:classified,
        groups:[...groups],staples:staples.map(item=>item.name),known_staple_grams:sumKnown(staples.map(item=>item.grams)),
        weighed_staples:staples.filter(item=>item.grams!==null).length,estimated_staples:staples.filter(item=>item.grams!==null&&item.estimated).length,
        estimated_items:meal.items.filter(item=>item.estimated).length,unknown_energy_items:meal.items.filter(item=>item.energy_kcal===null).length,energy_kcal:sumKnown(meal.items.map(item=>item.energy_kcal))});
    }
  }
  const diary=evidence.days.filter(day=>day.date>=from).map(day=>{
    const declaration=evidence.intentions.find(row=>row.key===dietDiaryKey(day.date,input.time_zone));
    return {date:day.date,declaration:declaration?{id:declaration.id,revision:declaration.revision}:null,
      state:declaration?.statement===dietDiaryStatements.partial?"partial":
        declaration?.statement===dietDiaryStatements.complete?declaration.recheck?"recheck":"complete":"unknown"} as const;
  });
  const completeEnergy=evidence.days.filter(day=>{
    const declaration=diary.find(row=>row.date===day.date);
    return declaration?.state==="complete"&&day.items>0&&day.empty_meals===0&&day.nutrients.energy_kcal.known_items===day.items&&day.nutrients.energy_kcal.estimated_items===0;
  });
  const energyTarget=evidence.intentions.find(row=>row.key==="wellness.energy");
  const bounds=/^每日热量 (\d{1,5})–(\d{1,5}) kcal$/u.exec(energyTarget?.statement??"");
  const healthTargets=healthAllowed?evidence.healthTargets??[]:[];
  const dailyTarget=healthTargets.find(row=>row.metric_key==="energy_kcal");
  const legacyTarget=bounds&&Number(bounds[1])>0&&Number(bounds[1])<=Number(bounds[2])
    ?{lower:Number(bounds[1]),upper:Number(bounds[2])}:null;
  const target=dailyTarget?{lower:dailyTarget.target_value,upper:dailyTarget.target_value}:legacyTarget;
  const reliable=sumKnown(currentMeals.filter(meal=>meal.date===input.to).flatMap(meal=>meal.items.filter(item=>!item.estimated).map(item=>item.energy_kcal)));
  const todayComplete=completeEnergy.some(row=>row.date===input.to);
  const status=target&&reliable!==null?(reliable>target.upper?"above":todayComplete?reliable<target.lower?"below":"within":"unknown"):"unknown";
  const wellness=buildWellnessReview(evidence.days,input,evidence.as_of);
  const steps=evidence.activity.filter(day=>day.date>=from&&day.steps!==null).map(day=>day.steps!);
  const active=evidence.activity.filter(day=>day.date>=from&&day.active_minutes!=null).map(day=>day.active_minutes!);
  const latestActivity=evidence.activity.find(day=>day.date===input.to);
  const currentDate=Intl.DateTimeFormat("sv-SE",{timeZone:input.time_zone}).format(new Date(evidence.as_of));
  const stepState=latestActivity?.steps!=null||latestActivity?.active_minutes!=null?"reported":input.to===currentDate?"pending":"missing";
  const recentLunches=recentMeals.filter(lunchMatches);
  const todayLunch=recentMeals.filter(meal=>meal.date===input.to&&meal.type==="lunch"&&meal.items.length>0).at(-1);
  const latest=todayLunch??recentLunches.at(-1);
  const mixed=latest?.items.filter(isStaple)??[];
  const vegetableDish=latest&&lunchMatches(latest)?evidence.menu?.dishes.find(dish=>!mixedDish.test(dish.name)&&itemGroups(dish).includes("vegetables"))?.name:undefined;
  const latestGroups=new Set(latest?.items.flatMap(itemGroups));
  const meal=latest?{id:latest.id,revision:latest.revision}:null;
  const vegetable=latest?.items.find(item=>itemGroups(item).includes("vegetables"));
  const soy=latest?.items.find(item=>item!==vegetable&&itemGroups(item).includes("soy"));
  const next_meal=vegetableDish&&latest?.items.length&&!latestGroups.has("vegetables")
    ? {text:`下次到${evidence.menu!.merchant}，如果有${vegetableDish}，可以搭一份。`,meal}
    : mixed.length>=2?{text:`下次自选拿${mixed.slice(0,3).map(item=>item.name).join("、")}时，可以按合起来的份量打主食。`,meal}
    : vegetable&&soy?{text:`下一餐可以沿用这顿的搭配，选一份${vegetable.name}配${soy.name}。`,meal}:null;
  const consumedItems=currentMeals.flatMap(meal=>meal.items);
  const weight=measurements(evidence,input,healthAllowed);
  const periodEnergy=target&&median(completeEnergy.flatMap(day=>day.nutrients.energy_kcal.known_total===null?[]:[Number(day.nutrients.energy_kcal.known_total)]));
  const weight_followup=nextWeightAction(input,weight,completeEnergy.length,currentMeals,recentLunches.at(-1),
    periodEnergy!==null&&target!==null&&periodEnergy<target.lower);
  const micronutrients=(["calcium_mg","iron_mg"] as const).map(nutrient=>{
    const known=consumedItems.filter(item=>item[nutrient]!=null);
    return {nutrient,known_total:sumKnown(known.map(item=>item[nutrient]!)),known_items:known.length,estimated_items:known.filter(item=>item.estimated).length};
  });
  return dietReviewResultSchema.parse({wellness,micronutrients,time_zone:input.time_zone,diary,recorded_complete_days:diary.filter(row=>row.state==="complete").length,
    complete_energy_days:completeEnergy.length,food_groups:dietFoodGroups.map(group=>({group,days:grouped.get(group)!.size,lunches:lunches.filter(lunch=>lunch.groups.includes(group)).length})),
    group_days:groupDays.size,unclassified_days:unclassifiedDays.size,lunch_count:lunches.length,lunches,
    menu:evidence.menu?{merchant:evidence.menu.merchant,dishes:evidence.menu.dishes.map(dish=>dish.name)}:null,next_meal,
    ...(healthTargets.length&&{health_targets:healthTargets}),
    energy:{status,lower:target?.lower??null,upper:target?.upper??null,reliable_kcal:reliable,target:energyTarget&&legacyTarget&&!dailyTarget?{id:energyTarget.id,revision:energyTarget.revision}:null},
    weight,weight_followup,background:healthAllowed?{step_days:steps.length,median_steps:median(steps),active_days:active.length,median_active_minutes:median(active),
      latest:{state:stepState,steps:latestActivity?.steps??null,active_minutes:latestActivity?.active_minutes??null},sleep_days:wellness.current.sleep_days,mean_sleep_minutes:wellness.current.average_sleep_minutes}:null});
}


function nextWeightAction(input:DietReviewInput,weight:DietReviewResult["weight"],completeDays:number,
  meals:DietEvidence["meals"],latest:DietEvidence["meals"][number]|undefined,periodEnergyBelow:boolean) {
  if(input.days!==30||weight?.alignment!=="off_track"||completeDays<21)return null;
  if(weight.trend==="up"&&periodEnergyBelow)return {
    text:"近 30 天完整记录日的热量中位数低于自定范围，但晨重持续上行。先核对常吃餐的份量、用油和饮料，再考虑调整饭量。",
    meals:latest?[{id:latest.id,revision:latest.revision}]:[],
  };
  const repeated=meals.filter(meal=>meal.items.some(item=>/经典可乐|原味可乐|全糖|多糖奶茶|加糖饮料|含糖饮料|全糖果茶/u.test(item.name)&&!/零糖|无糖/u.test(item.name)));
  if(weight.trend==="up"&&new Set(repeated.map(meal=>meal.date)).size>=3){
    return {text:"最近多天记录了含糖饮料。可以选一次换成自己喜欢的无糖饮品，过两到三周再一起回看。",meals:repeated.slice(-3).map(({id,revision})=>({id,revision}))};
  }
  if(!latest||!latest.items.some(isStaple))return null;
  const change=weight.trend==="up"?"少夹一点平时拿得最多的那样主食":"把常吃的那样主食稍微加一点";
  return {text:`下次吃相似的午餐，可以只调整一项：${change}。两到三周后再对照同秤晨重。`,meals:[{id:latest.id,revision:latest.revision}]};
}

type MealItemEvidence=Omit<MealDietReviewResult["items"][number],"groups"|"staple">&{
  groups:FoodGroup[]|null;staple:boolean|null;
};
export type MealDietEvidence=Pick<MealDietReviewResult,"id"|"revision"|"date"|"type"|"as_of">&{items:MealItemEvidence[]};

export function buildMealDietReview(evidence:MealDietEvidence):MealDietReviewResult {
  const items=evidence.items.map(item=>{
    const fraction=item.consumed_fraction??1;
    const nutrients=Object.fromEntries(Object.entries(item.nutrients).map(([key,value])=>[key,round(value*fraction)]));
    return {...item,groups:itemGroups(item),staple:isStaple(item),
      quantity:item.quantity===null?null:round(item.quantity*fraction),
      grams:item.grams===null?null:round(item.grams*fraction),nutrients};
  });
  const consumed=items.filter(item=>item.consumed_fraction!==0);
  const staples=consumed.filter(item=>item.staple);
  const totals=mealDietNutrients.map(nutrient=>{
    const known=consumed.filter(item=>item.nutrients[nutrient]!==undefined);
    const total=sumKnown(known.map(item=>item.nutrients[nutrient]!));
    return {nutrient,known_total:total===null?null:round(total),known_items:known.length,estimated_items:known.filter(item=>item.estimated).length};
  });
  return mealDietReviewResultSchema.parse({...evidence,items,totals,consumed_items:consumed.length,
    known_staple_grams:sumKnown(staples.map(item=>item.grams)),staples_with_grams:staples.filter(item=>item.grams!==null).length,staples:staples.length});
}

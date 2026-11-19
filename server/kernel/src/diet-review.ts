import {
  dietDiaryKey, dietDiaryStatements, dietFoodGroups, dietReviewResultSchema,
  type DietReviewInput, type DietReviewResult, type WellnessDay,
} from "@shadow/contracts";
import { buildWellnessReview, shiftWellnessDate } from "./wellness-review.js";

type Ref = {id:string; revision:number};
type FoodGroup = typeof dietFoodGroups[number];
type BodyMetric = "body_fat" | "muscle_mass" | "body_water_rate" | "visceral_fat";
export type DietEvidence = {
  as_of:string;
  days:WellnessDay[];
  meals:(Ref & {date:string; type:string; merchant:string|null; items:{
    name:string; estimated:boolean; energy_kcal:number|null; grams:number|null;
  }[]})[];
  intentions:(Ref & {key:string; statement:string; recheck:boolean})[];
  measurements:(Ref & {
    date:string; occurred_at:string; source:string; session:string; metric:string;
    value:number; unit:string; method:string|null;
  })[];
  activity:{date:string; steps:number|null}[];
  menu:{merchant:string; dishes:string[]}|null;
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
  const allowedMetrics:Record<string,string>={weight:"kg",...bodyUnits};
  const estimates=new Map<string,DietEvidence["measurements"]>();
  for(const row of evidence.measurements) {
    if(row.metric==="weight" || allowedMetrics[row.metric]!==row.unit)continue;
    const related=estimates.get(row.session)??[];
    related.push(row);
    estimates.set(row.session,related);
  }
  const sources=new Map<string,{morning:Map<string,DietEvidence["measurements"][number]>;evening:Map<string,DietEvidence["measurements"][number]>}>();
  const clock=new Intl.DateTimeFormat("en-GB",{timeZone:input.time_zone,hour:"2-digit",hourCycle:"h23"});
  for(const row of evidence.measurements) {
    if(row.metric!=="weight"||row.unit!=="kg"||row.value<=0)continue;
    const hour=Number(clock.format(new Date(row.occurred_at)));
    const period=hour>=5&&hour<11?"morning":hour>=18||hour<3?"evening":null;
    if(!period)continue;
    const date=hour<3?shiftWellnessDate(row.date,-1):row.date;
    if(date<weightFrom||date>input.to)continue;
    const bands=sources.get(row.source)??{morning:new Map(),evening:new Map()};
    sources.set(row.source,bands);
    const previous=bands[period].get(date);
    if(!previous || (period==="morning"?row.occurred_at<previous.occurred_at:row.occurred_at>previous.occurred_at))bands[period].set(date,row);
  }
  // Select one scale for the entire report, favoring usable morning coverage.
  const bands=[...sources.values()].sort((a,b)=>b.morning.size-a.morning.size||b.evening.size-a.evening.size)[0];
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
  return {source_count:sources.size,morning,evening,weeks:weeks.map(w=>({...w,mean_kg:w.mean_kg===null?null:round(w.mean_kg)})),
    weekly_change_kg:change===null?null:round(change),trend,goal,alignment,waist};
}

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
      const itemGroups=classifyDietFood(item.name);
      for(const group of itemGroups){
        groups.add(group);
        grouped.get(group)!.add(meal.date);
      }
      if(itemGroups.length || otherRecognizable.test(item.name)||staple.test(item.name))classified++;
    }
    if(classified>0)groupDays.add(meal.date);
    if(classified<meal.items.length || !meal.items.length)unclassifiedDays.add(meal.date);
    if(lunchMatches(meal)){
      const staples=meal.items.filter(item=>staple.test(item.name));
      lunches.push({id:meal.id,revision:meal.revision,date:meal.date,items:meal.items.length,classified_items:classified,
        groups:[...groups],staples:staples.map(item=>item.name),known_staple_grams:sumKnown(staples.map(item=>item.grams)),
        weighed_staples:staples.filter(item=>item.grams!==null).length,estimated_staples:staples.filter(item=>item.grams!==null&&item.estimated).length,
        estimated_items:meal.items.filter(item=>item.estimated).length,energy_kcal:sumKnown(meal.items.map(item=>item.energy_kcal))});
    }
  }
  const diary=evidence.days.filter(day=>day.date>=from).map(day=>{
    const declaration=evidence.intentions.find(row=>row.key===dietDiaryKey(day.date,input.time_zone));
    return {date:day.date,declaration:declaration?{id:declaration.id,revision:declaration.revision}:null,
      state:declaration?.statement===dietDiaryStatements.partial?"partial":
        declaration?.statement===dietDiaryStatements.complete?declaration.recheck?"recheck":"complete":"unknown"} as const;
  });
  const completeEnergy=diary.filter(row=>{
    const day=evidence.days.find(day=>day.date===row.date)!;
    return row.state==="complete"&&day.items>0&&day.empty_meals===0&&day.nutrients.energy_kcal.known_items===day.items&&day.nutrients.energy_kcal.estimated_items===0;
  });
  const energyTarget=evidence.intentions.find(row=>row.key==="wellness.energy");
  const bounds=/^每日热量 (\d{1,5})–(\d{1,5}) kcal$/u.exec(energyTarget?.statement??"");
  const target=bounds&&Number(bounds[1])>0&&Number(bounds[1])<=Number(bounds[2])?{lower:Number(bounds[1]),upper:Number(bounds[2])}:null;
  const reliable=sumKnown(currentMeals.filter(meal=>meal.date===input.to).flatMap(meal=>meal.items.filter(item=>!item.estimated).map(item=>item.energy_kcal)));
  const todayComplete=completeEnergy.some(row=>row.date===input.to);
  const status=target&&reliable!==null?(reliable>target.upper?"above":todayComplete?reliable<target.lower?"below":"within":"unknown"):"unknown";
  const wellness=buildWellnessReview(evidence.days,input,evidence.as_of);
  const steps=evidence.activity.filter(day=>day.date>=from&&day.steps!==null).map(day=>day.steps!).sort((a,b)=>a-b);
  const median=steps.length?mean([steps[Math.floor((steps.length-1)/2)]!,steps[Math.floor(steps.length/2)]!]):null;
  const recentLunches=recentMeals.filter(lunchMatches);
  const latest=recentLunches.at(-1);
  const mixed=latest?.items.filter(item=>staple.test(item.name))??[];
  const vegetableDish=evidence.menu?.dishes.find(name=>!mixedDish.test(name)&&classifyDietFood(name).includes("vegetables"));
  const latestGroups=new Set(latest?.items.flatMap(item=>classifyDietFood(item.name)));
  const meal=latest?{id:latest.id,revision:latest.revision}:null;
  const next_meal=vegetableDish&&latest?.items.length&&!latestGroups.has("vegetables")
    ? {text:`下次到${evidence.menu!.merchant}，如果有${vegetableDish}，可以搭一份。`,meal}
    : mixed.length>=2?{text:`下次自选拿${mixed.slice(0,3).map(item=>item.name).join("、")}时，可以按合起来的份量打主食。`,meal}:null;
  return dietReviewResultSchema.parse({wellness,time_zone:input.time_zone,diary,recorded_complete_days:diary.filter(row=>row.state==="complete").length,
    complete_energy_days:completeEnergy.length,food_groups:dietFoodGroups.map(group=>({group,days:grouped.get(group)!.size,lunches:lunches.filter(lunch=>lunch.groups.includes(group)).length})),
    group_days:groupDays.size,unclassified_days:unclassifiedDays.size,lunch_count:lunches.length,lunches,menu:evidence.menu,next_meal,
    energy:{status,lower:target?.lower??null,upper:target?.upper??null,reliable_kcal:reliable,target:energyTarget&&target?{id:energyTarget.id,revision:energyTarget.revision}:null},
    weight:measurements(evidence,input,healthAllowed),background:healthAllowed?{step_days:steps.length,median_steps:median,sleep_days:wellness.current.sleep_days,mean_sleep_minutes:wellness.current.average_sleep_minutes}:null});
}

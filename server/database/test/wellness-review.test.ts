import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";
import { normalizeHealthRaw } from "../src/index.js";
import { dietDiaryKey, dietDiaryStatements } from "@shadow/contracts";

test("wellness review aggregates actual portions, unknown fields and comparable evidence without writes",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const meal=(date:string,items:unknown[])=>run("life.record_meal",{occurred_on:date,time_zone:"Asia/Shanghai",meal_type:"lunch",items});
  await meal("2026-10-10",[{name:"前期",energy_kcal:"900",protein_g:"30"}]);
  const recorded=await meal("2026-10-17",[{name:"半份",energy_kcal:"600",protein_g:"30",fiber_g:"0",consumed_fraction:"0.5",estimate:true,evidence_note:"合成估算"},{name:"未知菜"}]);
  await meal("2026-10-18",[{name:"水",energy_kcal:"0"}]);
  await meal("2026-10-19",[{name:"标签餐",energy_kcal:"500",protein_g:"20",fat_g:"10",carb_g:"60",sodium_mg:"600"}]);
  const empty=await meal("2026-10-19",[{name:"待移除"}]);
  const emptyItem=(await pool.query("select id from intake_items where meal_id=$1",[empty.actual_values.meal_id])).rows[0].id;
  // Legacy/image-only meals can have no effective item; they must not make a day complete.
  await pool.query("update intake_items set effective=false where id=$1",[emptyItem]);
  await run("health.record_measurement",{metric:"weight",value:"70",unit:"kg",occurred_on:"2026-10-17",occurred_at:"2026-10-17T01:00:00Z",time_zone:"Asia/Shanghai"});
  const latest=await run("health.record_measurement",{metric:"weight",value:"71",unit:"kg",occurred_on:"2026-10-17",occurred_at:"2026-10-17T02:00:00Z",time_zone:"Asia/Shanghai"});
  await run("health.record_measurement",{metric:"weight",value:"150",unit:"lb",occurred_on:"2026-10-18",time_zone:"Asia/Shanghai"});
  await run("health.record_workout",{session_type:"walk",occurred_on:"2026-10-17",time_zone:"Asia/Shanghai",duration_minutes:30});
  await run("health.record_workout",{session_type:"strength_training",occurred_on:"2026-10-17",time_zone:"Asia/Shanghai"});
  for(const [id,minutes] of [["main",420],["nap",30]] as const){
    const raw=await run("health.ingest_raw",{source_type:"health_connect",source_instance_key:"fixture-phone",source_fingerprint:"fixture-permission",record_type:"sleep",client_record_id:id,record_version:1,sync_epoch:1,change_kind:"upsert",payload:{wake_date:"2026-10-17",time_zone:"Asia/Shanghai",total_minutes:minutes},parse_version:"health-normalizer"});
    assert.equal((await normalizeHealthRaw(pool,String(raw.actual_values.raw_id),1)).state,"completed");
  }
  const countBefore=(await pool.query("select count(*)::int n from operations")).rows[0].n;
  const input={to:"2026-10-23",days:7},result=await queries.wellnessReview(context,input);
  const today=await queries.lifeToday(context,{date:"2026-10-17",time_zone:"Asia/Shanghai",domains:["meals"]});
  assert.equal(today.domains.meals?.nutrition?.energy_kcal,"300.000000");
  assert.equal(result.current.from,"2026-10-17");assert.equal(result.previous.to,"2026-10-16");assert.equal(result.days.length,7);
  assert.equal(result.current.nutrients.energy_kcal.known_total,"800");
  assert.equal(result.current.nutrients.energy_kcal.known_items,3);assert.equal(result.current.nutrients.energy_kcal.estimated_items,1);
  assert.equal(result.current.nutrients.energy_kcal.complete_days,1,"partial days and empty meal days cannot enter complete-day means");
  assert.equal(result.current.nutrients.energy_kcal.average_on_complete_days,"0","explicit zero is known, not absent");
  assert.equal(result.current.nutrients.fiber_g.known_total,"0");assert.equal(result.current.nutrients.fat_g.complete_days,0,"zero energy does not manufacture missing macros");
  assert.equal(result.previous.nutrients.energy_kcal.average_on_complete_days,"900");
  assert.equal(result.current.average_weight_kg,"71");assert.equal(result.current.weight_days,1);
  assert.equal(result.current.average_sleep_minutes,420);assert.equal(result.current.sleep_days,1);
  assert.equal(result.current.workout_sessions,2);assert.equal(result.current.known_workout_duration_sessions,1);assert.equal(result.current.workout_minutes,30);
  assert.equal(result.current.paired_energy_weight_days,0);
  assert.equal(result.days[0]!.weight!.id,latest.actual_values.measurement_id);
  assert.equal(result.days[6]!.nutrients.energy_kcal.known_total,null);assert.equal(result.days[6]!.workouts.minutes,null);
  assert.equal((await pool.query("select count(*)::int n from operations")).rows[0].n,countBefore,"review is read-only");
  const other=await queries.wellnessReview({...context,subjectId:"subject_other"},input);
  assert.equal(other.current.items,0);assert.equal(other.current.sleep_days,0);assert.equal(other.current.weight_days,0);
  for(const effects of [new Set<string>(),new Set(["life.meal.read"]),new Set(["health.measurement.read"])])await assert.rejects(()=>queries.wellnessReview({...context,effects},input),/permission/i);
  const item=(await pool.query("select id from intake_items where meal_id=$1 and energy_kcal is not null",[recorded.actual_values.meal_id])).rows[0].id;
  await run("life.correct_intake",{item_id:item,expected_revision:1,item:{name:"更正半份",energy_kcal:"400",consumed_fraction:"0.5"},reason:"核对标签"});
  assert.equal((await queries.wellnessReview(context,input)).current.nutrients.energy_kcal.known_total,"700");
});

test("diet review follows diary evidence, meal portions and one scale across midnight",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const date="2026-10-23",time_zone="Asia/Shanghai";
  const meal=await run("life.record_meal",{occurred_on:date,time_zone,meal_type:"lunch",items:[
    {name:"白米饭",energy_kcal:"400",amount_g:"200",consumed_fraction:"0.5"},
    {name:"蒸红薯",energy_kcal:"120"},{name:"西兰花",energy_kcal:"80",consumed_fraction:"0"},
    {name:"家常豆腐",energy_kcal:"160"},
  ]});
  await run("life.record_meal",{occurred_on:date,time_zone,meal_type:"dinner",items:[{name:"香干",energy_kcal:"40"},{name:"牛奶",energy_kcal:"90"}]});
  const save=(key:string,kind:"goal"|"preference",statement:string)=>run("agent.set_intention",{scope:"health",key,kind,statement,
    category:"dietary",assertion:"explicit",valid_from:date,state:"active"});
  await save("wellness.weight","goal","维持体重");
  await save("wellness.energy","goal","每日热量 600–1800 kcal");
  const scale=async (id:string,source_type:string,instance:string,occurred_on:string,occurred_at:string,kg:string)=>{
    const raw=await run("health.ingest_raw",{source_type,source_instance_key:instance,source_fingerprint:"fixture-scale",record_type:"body",
      client_record_id:id,record_version:1,sync_epoch:1,change_kind:"upsert",parse_version:"health-normalizer",payload:{
        occurred_on,occurred_at,time_zone,group_kind:"measurement",observations:[
          {metric_key:"weight",value:kg,unit:"kg",original_field:"S400:weight"},
          {metric_key:"body_fat",value:"29",unit:"%",original_field:"xiaomi-bia-v1",autofilled:true},
        ],
      }});
    assert.equal((await normalizeHealthRaw(pool,String(raw.actual_values.raw_id),1)).state,"completed");
  };
  await scale("morning","scale","test-scale",date,"2026-10-23T01:05:00Z","78");
  await scale("copy","samsung","test-phone",date,"2026-10-23T01:05:00Z","78");
  await scale("evening","scale","test-scale",date,"2026-10-23T15:55:00Z","79");
  await scale("overnight","scale","test-scale","2026-10-24","2026-10-23T16:10:00Z","79.2");
  const query=(days:number)=>queries.dietReview(context,{to:date,days,time_zone});
  const partial=await query(7);
  assert.equal(partial.energy.status,"unknown");
  assert.equal(partial.energy.reliable_kcal,610);
  assert.equal(partial.food_groups.find(group=>group.group==="soy")?.days,1);
  assert.equal(partial.food_groups.find(group=>group.group==="vegetables")?.days,0);
  assert.equal(partial.food_groups.find(group=>group.group==="dairy")?.lunches,0);
  assert.equal(partial.lunches[0]?.known_staple_grams,100);
  assert.equal(partial.lunches[0]?.weighed_staples,1);
  assert.equal(partial.weight?.morning.length,1);
  assert.equal(partial.weight?.evening[0]?.kg,79.2);
  assert.equal(partial.weight?.morning[0]?.composition[0]?.value,29);
  assert.equal(partial.weight?.goal?.direction,"maintain");
  assert.equal(partial.weight?.composition?.find(row=>row.band==="morning")?.current.mean,29);
  const selected=partial.weight?.settings?.selected_scale;
  assert.ok(selected);
  await save("wellness.weighing","preference",JSON.stringify({morning_from:"10:00",morning_to:"11:00",evening_from:"20:00",evening_to:"02:00",scale_id:selected}));
  const changed=await query(7);
  assert.equal(changed.weight?.morning.length,0,"configured hours exclude the 09:05 measurement");
  assert.equal(changed.weight?.evening[0]?.kg,79.2,"custom overnight still uses the prior evening");
  assert.equal(changed.weight?.settings?.schedule.scale_id,selected);
  assert.match(partial.next_meal?.text??"",/白米饭、蒸红薯/);
  await save("wellness.diary.2026-10-23.Asia/Shanghai","preference","当天进食已结束，饮食已基本记全");
  assert.equal((await query(1)).energy.status,"within");
  await run("life.correct_meal",{meal_id:meal.actual_values.meal_id,expected_revision:1,occurred_on:"2026-10-24",time_zone,meal_type:"lunch",reason:"修正实际日期"});
  const moved=await query(1);
  assert.equal(moved.diary.at(-1)?.state,"recheck");
  assert.equal(moved.energy.status,"unknown");
  const restricted=await queries.dietReview({...context,effects:new Set(["life.meal.read"])},{to:date,days:1,time_zone});
  assert.equal(restricted.weight,null);
  assert.equal(restricted.wellness.current.weight_days,0);
  assert.equal(restricted.diary[0]?.state,"unknown");
});

test("canteen profiles keep same-name stalls, preserve meal snapshots and expose only consumed nutrients",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const merchant="合成食堂",dish="招牌小碗",date="2026-11-19";
  const create={merchant,dish,stall:"自选档",evidence:{kind:"note",note:"本人实称一平勺熟菜"},
    profile:{aliases:["熟豆小碗"],cooking:"清蒸",groups:["soy"],staple:false,portion:{
      quantity:"1",unit:"平勺",grams:"80",basis:"本人称重与包装标签",nutrients:{calcium_mg:"40",iron_mg:"2",energy_kcal:"60"}
    }}};
  const one=await run("life.remember_merchant_dish",create);
  const duplicate=await run("life.remember_merchant_dish",{merchant,dish,stall:"自选档",evidence:create.evidence});
  const another=await run("life.remember_merchant_dish",{merchant,dish,stall:"面档",evidence:create.evidence});
  assert.equal(duplicate.actual_values.food_id,one.actual_values.food_id);
  assert.notEqual(another.actual_values.food_id,one.actual_values.food_id);
  const legacy=await queries.merchantMenu(context,{merchant});
  assert.ok(legacy.items.every(row=>row.profile===undefined));
  const page=await queries.merchantMenu(context,{merchant,with_profiles:"1",query:"熟豆小碗"});
  assert.equal(page.items.length,1);
  assert.equal(page.items[0]?.profile?.portion?.grams,"80");
  const meal=await run("life.record_meal",{meal_type:"lunch",occurred_on:date,time_zone:"Asia/Shanghai",items:[
    {name:dish,food_ref_id:one.actual_values.food_id,quantity:"1",unit:"平勺",amount_g:"80",calcium_mg:"40",iron_mg:"2",energy_kcal:"60",consumed_fraction:"0.5",
      estimate:true,evidence_note:"一勺按菜单估算后吃了一半"},
    {name:"米饭",amount_g:"80",energy_kcal:"90",consumed_fraction:"0"},
    {name:"白米饭",quantity:"1",unit:"碗",amount_g:"90",energy_kcal:"100",weight_basis:"measured_net",evidence_note:"米饭实称"},
  ]});
  await run("life.remember_merchant_dish",{...create,food_id:one.actual_values.food_id,expected_revision:1,
    stall:null,profile:{aliases:[],groups:["vegetables"],staple:true}});
  const cleared=(await queries.merchantMenu(context,{merchant,with_profiles:"1"})).items.find(row=>row.id===one.actual_values.food_id);
  assert.equal(cleared?.profile?.stall,null);
  assert.equal(cleared?.name,`${merchant}｜${dish}`);
  await run("life.remember_merchant_dish",{merchant,dish,food_id:one.actual_values.food_id,expected_revision:2,stall:"新档口",evidence:create.evidence});
  const renamed=(await queries.merchantMenu(context,{merchant,with_profiles:"1"})).items.find(row=>row.id===one.actual_values.food_id);
  assert.equal(renamed?.name,`${merchant}｜${dish}（新档口）`);
  const result=await queries.mealDietReview(context,{meal_id:meal.actual_values.meal_id});
  assert.deepEqual(result.items[0]?.groups,["soy"]);
  assert.equal(result.items[0]?.grams,40);
  assert.equal(result.items[0]?.food_revision,1);
  assert.equal(result.items[0]?.basis,"一勺按菜单估算后吃了一半");
  assert.equal(result.items[1]?.consumed_fraction,0);
  assert.equal(result.known_staple_grams,90);
  const calcium=result.totals.find(nutrient=>nutrient.nutrient==="calcium_mg");
  assert.deepEqual(calcium,{nutrient:"calcium_mg",known_total:20,known_items:1,estimated_items:1});
  await run("life.correct_intake",{item_id:result.items[0]!.id,expected_revision:result.items[0]!.revision,reason:"旧界面修正摄入比例与依据",
    item:{name:dish,food_ref_id:one.actual_values.food_id,quantity:"1",unit:"平勺",amount_g:"80",energy_kcal:"60",consumed_fraction:"0.5",estimate:true,evidence_note:"沿用原份量"}});
  const period=await queries.dietReview(context,{to:date,days:7});
  assert.equal(period.food_groups.find(group=>group.group==="soy")?.days,1);
  assert.equal(period.micronutrients?.find(row=>row.nutrient==="iron_mg")?.known_total,1);
  await run("agent.set_intention",{scope:"daily",key:"dining.usual_canteen",kind:"preference",category:"dietary",assertion:"explicit",
    statement:`常去食堂：${merchant}`});
  const payment=await run("money.record_entry",{entry_type:"expense",amount:"10.00",currency:"CNY",counterparty:"付款渠道别名",
    occurred_on:date,time_zone:"Asia/Shanghai"});
  await run("life.link_meal_consumption",{meal_id:meal.actual_values.meal_id,consumption_record_id:payment.actual_values.record_id,evidence:"user_confirmed"});
  const withPayment=await queries.dietReview(context,{to:date,days:7});
  assert.equal(withPayment.lunch_count,1,"explicit menu identity takes precedence over a payment alias");
  assert.match(withPayment.next_meal?.text??"",/招牌小碗/,"manual vegetable group beats a name with no recognizable vegetable");

  const later="2026-11-20";
  const oral=await run("life.record_meal",{occurred_on:later,time_zone:"Asia/Shanghai",meal_type:"lunch",
    note:`食堂「${merchant}」麻辣烫档；按口述记录。`,items:[{name:"绿叶菜"},{name:"豆腐"}]});
  const alias=await run("money.record_entry",{entry_type:"expense",amount:"12.00",currency:"CNY",counterparty:"结算公司",
    occurred_on:later,time_zone:"Asia/Shanghai"});
  await run("life.link_meal_consumption",{meal_id:oral.actual_values.meal_id,consumption_record_id:alias.actual_values.record_id,evidence:"user_confirmed"});
  const oralReview=await queries.dietReview(context,{to:later,days:7});
  assert.equal(oralReview.lunches.at(-1)?.id,oral.actual_values.meal_id);
  assert.equal(oralReview.next_meal?.meal?.id,oral.actual_values.meal_id);
  assert.match(oralReview.next_meal?.text??"",/绿叶菜配豆腐/);
  const otherDay="2026-11-21";
  const away=await run("life.record_meal",{occurred_on:otherDay,time_zone:"Asia/Shanghai",meal_type:"lunch",
    note:`今天在家吃，上次食堂「${merchant}」不错。`,items:[{name:"西兰花"},{name:"豆干"}]});
  const awayReview=await queries.dietReview(context,{to:otherDay,days:7});
  assert.equal(awayReview.lunch_count,oralReview.lunch_count,"an incidental mention is not a canteen visit");
  assert.equal(awayReview.next_meal?.meal?.id,away.actual_values.meal_id);
  assert.match(awayReview.next_meal?.text??"",/西兰花配豆干/);

  const mealId=String(meal.actual_values.meal_id), recordId=String(payment.actual_values.record_id);
  const detail=await queries.lifeRecord(context,mealId);
  assert.equal(detail.kind,"meal");
  const saved=detail.items![0]!;
  assert.equal(Number(saved.calcium_mg),40);
  const linked=await queries.lifeRecord(context,recordId);
  assert.equal(linked.kind,"record");
  assert.equal(Number(linked.meals?.[0]?.items[0]?.iron_mg),2);
  const listed=await queries.listMeals(context,{occurred_on:date});
  assert.equal(listed.items[0]?.items[0]?.iron_mg,"2");
  assert.equal(listed.items[0]?.items[0]?.evidence_note,undefined);
  const withEvidence=await queries.listMeals(context,{occurred_on:date,with_evidence:"1"});
  assert.equal(withEvidence.items.find(row=>row.id===mealId)?.items[0]?.evidence_note,"沿用原份量");
  await run("life.correct_intake",{item_id:saved.id,expected_revision:saved.revision,reason:"更正原份量并核对营养标签",
    item:{name:saved.name,food_ref_id:saved.food_ref_id,quantity:"2",unit:"平勺",amount_g:"160",calcium_mg:"80",iron_mg:"4"}});
  const edited=await queries.lifeRecord(context,mealId);
  assert.equal(edited.kind,"meal");
  assert.equal(Number(edited.items?.[0]?.calcium_mg),80);
  assert.equal(Number(edited.items?.[0]?.iron_mg),4);

  await assert.rejects(()=>queries.mealDietReview({...context,subjectId:"subject_other"},{meal_id:meal.actual_values.meal_id}),/not found/i);
  await assert.rejects(()=>queries.mealDietReview({...context,effects:new Set()},{meal_id:meal.actual_values.meal_id}),/permission/i);
});

test("a complete diary day is flagged after adding, deleting or moving a meal into it",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const time_zone="Asia/Shanghai";
  const meal=(occurred_on:string)=>run("life.record_meal",{occurred_on,time_zone,meal_type:"lunch",items:[{name:"合成午餐"}]});
  for(const [date,change] of [["2026-11-15","add"],["2026-11-16","delete"],["2026-11-17","move"]] as const){
    const prior=change==="add"?null:await meal(change==="move"?"2026-11-18":date);
    await run("agent.set_intention",{scope:"health",key:dietDiaryKey(date,time_zone),kind:"preference",category:"dietary",
      assertion:"explicit",valid_from:date,statement:dietDiaryStatements.complete});
    const state=async()=>(await queries.dietReview(context,{to:date,days:1,time_zone})).diary[0]?.state;
    assert.equal(await state(),"complete");
    if(change==="delete"){
      await pool.query("update meals set state='deleted' where id=$1",[prior!.actual_values.meal_id]);
    }else if(change==="move"){
      await run("life.correct_meal",{meal_id:prior!.actual_values.meal_id,expected_revision:1,occurred_on:date,time_zone,meal_type:"lunch",reason:"更正到用餐当天"});
    }else await meal(date);
    assert.equal(await state(),"recheck",change);
  }
});


test("diet review projects an explicit weekly rate separately from target weight",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const base={kind:"goal",state:"active"};
  const weekly=await run("health.set_plan",{...base,name:"每周减重",metric_key:"weight_change_per_week",target_value:"-1",unit:"kg/week"});
  const goal=await run("health.set_plan",{...base,name:"目标体重",metric_key:"weight",target_value:"80",unit:"kg"});
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"}).format(new Date());
  const review=await queries.dietReview(context,{to:today,days:1});
  assert.deepEqual(review.health_targets?.map(({id,target_value,unit})=>({id,target_value,unit})),[
    {id:goal.actual_values.health_plan_id,target_value:80,unit:"kg"},
    {id:weekly.actual_values.health_plan_id,target_value:-1,unit:"kg/week"},
  ]);
  await run("health.set_plan",{...base,state:"cancelled",name:"每周减重",metric_key:"weight_change_per_week",target_value:"-1",unit:"kg/week",
    plan_id:weekly.actual_values.health_plan_id,expected_revision:1});
  assert.equal((await queries.dietReview(context,{to:today,days:1})).health_targets?.length,1);
});

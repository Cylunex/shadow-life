import assert from "node:assert/strict";
import test from "node:test";
import { buildUseCycleStatus, type UseCycleIntakeRaw, type UseCycleRaw } from "../src/use-cycles.js";

const cycle=(extra:Partial<UseCycleRaw>={}):UseCycleRaw=>({id:"plan_cycle_1",purchase_record_id:null,purchase_item_id:null,item_name:"西麦燕麦",started_on:"2026-09-15",ended_on:null,state:"active",revision:1,initial_quantity:"500",quantity_unit:"g",expected_daily_usage:"45",replenish_threshold:"90",replenish_lead_days:null,time_zone:"Asia/Shanghai",match_mode:"exact_name",match_value:"西麦燕麦",reminder_enabled:true,...extra});
const intake=(id:string,extra:Partial<UseCycleIntakeRaw>={}):UseCycleIntakeRaw=>({id,name:"西麦燕麦",food_ref_id:null,quantity:"45",unit:"g",amount_g:null,consumed_fraction:null,...extra});
const now="2026-09-15T08:00:00.000Z";

test("deduplicates intake events and applies consumed fractions",()=>{const item=intake("intake_1",{quantity:"100",consumed_fraction:"0.45"}),result=buildUseCycleStatus(cycle(),[item,item],now);assert.equal(result.consumed_quantity,"45");assert.equal(result.remaining_quantity,"455");assert.equal(result.matched_intakes,1);});
test("corrected and deleted intake projections follow only the supplied effective snapshot",()=>{assert.equal(buildUseCycleStatus(cycle(),[intake("intake_1",{quantity:"90"})],now).remaining_quantity,"410");assert.equal(buildUseCycleStatus(cycle(),[intake("intake_1",{quantity:"45"})],now).remaining_quantity,"455");assert.equal(buildUseCycleStatus(cycle(),[],now).remaining_quantity,"500");});
test("never sums incompatible dimensions",()=>{const result=buildUseCycleStatus(cycle(),[intake("intake_1",{quantity:"1",unit:"袋"}),intake("intake_2",{quantity:"0.045",unit:"kg"})],now);assert.equal(result.consumed_quantity,"45");assert.equal(result.ignored_incompatible_intakes,1);assert.deepEqual(result.incompatible_units,["袋"]);});
test("threshold and lead time produce replenish state",()=>{assert.equal(buildUseCycleStatus(cycle({initial_quantity:"100"}),[intake("intake_1")],now).balance_status,"replenish_now");assert.equal(buildUseCycleStatus(cycle({replenish_threshold:null,replenish_lead_days:2,initial_quantity:"90"}),[],now).balance_status,"replenish_now");});
test("time zone controls the projected local depletion date",()=>{const input=cycle({initial_quantity:"45",replenish_threshold:null,reminder_enabled:false});assert.equal(buildUseCycleStatus(input,[],"2026-09-15T15:59:59Z").projected_depletion_on,"2026-09-16");assert.equal(buildUseCycleStatus(input,[],"2026-09-15T16:00:00Z").projected_depletion_on,"2026-09-17");});
test("unknown specification is explicit and never fabricates a date",()=>{const result=buildUseCycleStatus(cycle({initial_quantity:null,replenish_threshold:null,replenish_lead_days:3}),[intake("intake_1")],now);assert.equal(result.balance_status,"needs_specification");assert.equal(result.remaining_quantity,null);assert.equal(result.projected_depletion_on,null);});

test("manual consumption and rate estimates stay separate; pending history cannot claim current stock",()=>{
 const input=cycle({usage_state:"in_use",initial_quantity:"80",quantity_unit:"count",quantity_label:"袋",expected_daily_usage:"1",match_mode:"none",match_value:null,manual_consumed_quantity:"2",reminder_enabled:false});
 const status=buildUseCycleStatus(input,[],"2026-09-22T12:00:00Z");assert.equal(status.consumed_quantity,"2");assert.equal(status.remaining_quantity,"78");assert.equal(status.estimated_remaining_quantity,"73");assert.equal(status.projected_depletion_on,"2026-12-04");
 const pending=buildUseCycleStatus({...input,usage_state:"pending"},[],"2026-09-22T12:00:00Z");assert.equal(pending.remaining_quantity,null);assert.equal(pending.estimated_remaining_quantity,null);assert.equal(pending.projected_depletion_on,null);
});

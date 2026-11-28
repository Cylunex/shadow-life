import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";

test("project editing preserves invisible links and action sources without granting access to them", pgOnly, async t => {
  const { run, queries, context, command, executor, pool } = await reviewFixture(t);
  const item = await run("life.save_owned_item", {name:"相机"});
  const link = {kind:"owned_item",id:item.actual_values.owned_item_id,revision:1,role:"equipment"};
  const project = await run("life.save_project", {title:"拍摄",goal:"练习构图",links:[link]});
  const id = project.actual_values.project_id;
  const habit = "habit_hidden_test";
  await pool.query("insert into health_habit_definitions(id,subject_id,name,schedule,state) values($1,$2,'练习','{}','active')", [habit, context.subjectId]);
  const action = await run("life.save_action_item", {project_id:id,title:"练习",health_habit_id:habit});
  const restricted = {...context, effects:new Set(["life.project.read","life.project.write"])};
  const hidden = (await queries.lifeProjects(restricted, {id})).items[0]!;
  assert.deepEqual(hidden.links, []);
  assert.equal(hidden.actions[0]?.health_habit_id, undefined);
  const editInput = {project_id:id,expected_revision:1,title:"练习项目",goal:"练习构图",
    state:"paused",milestones:[{title:"第一次外拍"}],preserve_links:true,reason:"调整计划"};
  const edit = command("life.save_project", editInput);
  const saved = await executor.execute(restricted, edit);
  assert.equal(saved.actual_values.links_preserved, true);
  assert.equal((await executor.execute(restricted, edit)).execution_id, saved.execution_id);
  await assert.rejects(run("life.save_project", editInput, restricted));
  const update = {project_id:id, action_item_id:action.actual_values.action_item_id, expected_revision:1,
    title:"练习一次", state:"completed", preserve_sources:true};
  await run("life.save_action_item", update, restricted);
  await assert.rejects(run("life.save_action_item", update, restricted));
  const after = (await queries.lifeProjects(context, {id})).items[0]!;
  assert.deepEqual(after.links[0], {ref_kind:"owned_item",ref_id:link.id,ref_revision:1,role:"equipment"});
  assert.equal(after.actions[0]?.health_habit_id, habit);
  assert.equal(after.milestones[0]?.title, "第一次外拍");
  await assert.rejects(run("life.save_project",{...editInput,expected_revision:2,links:[link]},context));
  await assert.rejects(run("life.save_action_item",{...update,expected_revision:2,health_habit_id:habit},context));
  // The earlier replace behavior remains available to existing clients.
  await run("life.save_project",{project_id:id,expected_revision:2,title:"调整",goal:"完成",links:[],reason:"整理关联"});
  assert.deepEqual((await queries.lifeProjects(context,{id})).items[0]!.links,[]);
});

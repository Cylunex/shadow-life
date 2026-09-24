import assert from "node:assert/strict";
import test from "node:test";
import { previewRecipeJsonLd, buildSaveRecipeCommand } from "../src/food-catalog.js";
test("recipe source is previewed and edited before an explicit save command",()=>{
  const preview=previewRecipeJsonLd(JSON.stringify({"@type":"Recipe",name:"汤",recipeYield:"2 servings",recipeIngredient:["2 g 盐","适量胡椒"],recipeInstructions:[{"text":"加热"}],url:"https://example.com/soup"}),"");
  assert.equal(preview.sourceUrl,"https://example.com/soup");assert.equal(preview.ingredients[1]?.quantity,"");
  preview.ingredients[1]={name:"胡椒",quantity:"1",unit:"g"};
  const command=buildSaveRecipeCommand(preview,[]);
  assert.equal(command.capability,"life.save_recipe");assert.equal((command.input as {source_url:string}).source_url,"https://example.com/soup");
  assert.throws(()=>previewRecipeJsonLd("{}",""),/未找到/);
});

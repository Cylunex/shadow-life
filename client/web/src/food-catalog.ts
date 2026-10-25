import { foodCatalogResultSchema, type WriteCapabilityName } from "@shadow/contracts";

export type FoodCatalog=ReturnType<typeof foodCatalogResultSchema.parse>;
export type CatalogFood=FoodCatalog["foods"][number];
export type CatalogRecipe=FoodCatalog["recipes"][number];
export interface FoodFields{foodId:string;revision:number|undefined;name:string;servingAmount:string;servingUnit:string;energyKcal:string;proteinG:string;fatG:string;carbG:string;fiberG:string;sodiumMg:string;provenance:string;state:"active"|"archived";reason:string;}
export interface RecipeIngredientFields{name:string;quantity:string;unit:string;}
export interface RecipeFields{recipeId:string;revision:number|undefined;title:string;servings:string;ingredients:RecipeIngredientFields[];instructions:string;sourceUrl:string;state:"active"|"archived";reason:string;}
export interface RecipeMealFields{recipeId:string;recipeRevision:number|undefined;occurredOn:string;timeZone:string;mealType:"breakfast"|"lunch"|"dinner"|"snack"|"other";consumedFraction:string;note:string;}
export interface CatalogCommand{capability:WriteCapabilityName;input:unknown;}

export async function loadFoodCatalog(fetcher:typeof fetch,headers:HeadersInit,query=""):Promise<FoodCatalog>{const search=new URLSearchParams({limit:"50"});if(query.trim())search.set("q",query.trim());const response=await fetcher(`/api/life/foods?${search}`,{headers});const body=await response.json();if(!response.ok)throw new Error(message(body,`HTTP ${response.status}`));return foodCatalogResultSchema.parse(body);}
export function emptyFoodFields():FoodFields{return{foodId:"",revision:undefined,name:"",servingAmount:"",servingUnit:"",energyKcal:"",proteinG:"",fatG:"",carbG:"",fiberG:"",sodiumMg:"",provenance:"",state:"active",reason:""};}
export function foodFields(food:CatalogFood):FoodFields{return{foodId:food.id,revision:food.revision,name:food.name,servingAmount:food.serving_amount??"",servingUnit:food.serving_unit??"",energyKcal:text(food.nutrients.energy_kcal),proteinG:text(food.nutrients.protein_g),fatG:text(food.nutrients.fat_g),carbG:text(food.nutrients.carb_g),fiberG:text(food.nutrients.fiber_g),sodiumMg:text(food.nutrients.sodium_mg),provenance:food.provenance??"",state:food.state,reason:""};}
export function emptyRecipeFields():RecipeFields{return{recipeId:"",revision:undefined,title:"",servings:"1",ingredients:[{name:"",quantity:"",unit:""}],instructions:"",sourceUrl:"",state:"active",reason:""};}
export function recipeFields(recipe:CatalogRecipe):RecipeFields{return{recipeId:recipe.id,revision:recipe.revision,title:recipe.title,servings:recipe.servings,ingredients:recipe.items.map(item=>({name:item.snapshot.name,quantity:item.snapshot.quantity??"1",unit:item.snapshot.unit??"份"})),instructions:recipe.instructions??"",sourceUrl:recipe.source_url??"",state:recipe.state,reason:""};}
export function initialRecipeMealFields(date:string,timeZone:string):RecipeMealFields{return{recipeId:"",recipeRevision:undefined,occurredOn:date,timeZone,mealType:"other",consumedFraction:"1",note:""};}

export function parseIngredientLines(value:string,foods:readonly CatalogFood[]=[]){const byName=new Map(foods.filter(food=>food.state==="active").map(food=>[food.name.trim().toLocaleLowerCase(),food.id]));return value.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean).map((line,index)=>{const parts=line.split("|");if(parts.length!==3)throw new Error(`第 ${index+1} 行必须是“名称|数量|单位”`);const [name,quantity,unit]=parts.map(part=>part!.trim());if(!name||!quantity||!unit)throw new Error(`第 ${index+1} 行的名称、数量和单位都不能为空`);return{name,quantity,unit,estimate:false,...(byName.get(name.toLocaleLowerCase())?{food_ref_id:byName.get(name.toLocaleLowerCase())}:{})};});}
export function buildSaveFoodCommand(fields:FoodFields):CatalogCommand{const nutrients=Object.fromEntries(([ ["energy_kcal",fields.energyKcal],["protein_g",fields.proteinG],["fat_g",fields.fatG],["carb_g",fields.carbG],["fiber_g",fields.fiberG],["sodium_mg",fields.sodiumMg] ] as const).flatMap(([key,value])=>value.trim()?[[key,value.trim()]]:[]));return{capability:"life.save_food",input:{...(fields.foodId?{food_id:fields.foodId,expected_revision:fields.revision,reason:fields.reason.trim()}:{}),name:fields.name.trim(),...(fields.servingAmount.trim()?{serving_amount:fields.servingAmount.trim(),serving_unit:fields.servingUnit.trim()}:{}),nutrients,...(fields.provenance.trim()?{provenance:fields.provenance.trim()}:{}),state:fields.state}};}
export function buildSaveRecipeCommand(fields:RecipeFields,foods:readonly CatalogFood[]):CatalogCommand{const byName=new Map(foods.filter(food=>food.state==="active").map(food=>[food.name.trim().toLocaleLowerCase(),food.id])),items=fields.ingredients.filter(item=>item.name.trim()||item.quantity.trim()||item.unit.trim()).map((item,index)=>{const name=item.name.trim(),quantity=item.quantity.trim(),unit=item.unit.trim();if(!name||!quantity||!unit)throw new Error(`第 ${index+1} 项原料的名称、数量和单位都需要填写`);const foodId=byName.get(name.toLocaleLowerCase());return{name,quantity,unit,estimate:false,...(foodId?{food_ref_id:foodId}:{})};});if(!items.length)throw new Error("请至少添加一项原料");return{capability:"life.save_recipe",input:{...(fields.recipeId?{recipe_id:fields.recipeId,expected_revision:fields.revision,reason:fields.reason.trim()}:{}),title:fields.title.trim(),servings:fields.servings.trim(),items,...(fields.instructions.trim()?{instructions:fields.instructions.trim()}:{}),source_url:fields.sourceUrl.trim()||null,state:fields.state}};}
export function buildRecipeMealCommand(fields:RecipeMealFields):CatalogCommand{return{capability:"life.record_meal_from_recipe",input:{recipe_id:fields.recipeId,expected_recipe_revision:fields.recipeRevision,occurred_on:fields.occurredOn,time_zone:fields.timeZone,meal_type:fields.mealType,consumed_fraction:fields.consumedFraction.trim(),...(fields.note.trim()?{note:fields.note.trim()}: {})}};}
function text(value:unknown):string{return typeof value==="string"?value:"";}
function message(value:unknown,fallback:string):string{return value!==null&&typeof value==="object"&&"message" in value&&typeof value.message==="string"?value.message:fallback;}

/** Local, reviewable JSON-LD import. Never fetches a third-party URL or saves a recipe. */
export function previewRecipeJsonLd(raw:string,sourceUrl:string):RecipeFields{
  if(raw.length>200_000)throw new Error("食谱来源文本过长");
  const values:unknown[]=[];
  const add=(value:unknown)=>{if(Array.isArray(value))values.push(...value);else values.push(value);};
  try{add(JSON.parse(raw));}catch{
    for(const match of raw.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu))try{add(JSON.parse(match[1]??""));}catch{/* another block may contain the recipe */}
  }
  const candidates=values.flatMap(value=>value&&typeof value==="object"&&"@graph" in value&&Array.isArray(value["@graph"])?value["@graph"]:[value]);
  const recipe=candidates.find(value=>value&&typeof value==="object"&&!Array.isArray(value)&&[value["@type"]].flat().some(type=>type==="Recipe")) as Record<string,unknown>|undefined;
  if(!recipe)throw new Error("未找到 schema.org Recipe；请核对来源内容");
  const title=typeof recipe.name==="string"?recipe.name.trim():"";
  const rawIngredients=Array.isArray(recipe.recipeIngredient)?recipe.recipeIngredient:[];
  if(!title||!rawIngredients.length)throw new Error("来源缺少标题或原料，请手动创建食谱");
  const ingredients=rawIngredients.slice(0,100).map(value=>{
    const line=typeof value==="string"?value.trim():"";
    const match=/^(\d+(?:[.,]\d+)?)\s+([^\s]+)\s+(.+)$/u.exec(line);
    return match?{name:match[3]!.trim(),quantity:match[1]!.replace(",","."),unit:match[2]!.trim()}:{name:line,quantity:"",unit:""};
  });
  const yieldText=typeof recipe.recipeYield==="number"?String(recipe.recipeYield):typeof recipe.recipeYield==="string"?recipe.recipeYield:"";
  const servings=/^\s*(\d+(?:\.\d+)?)/u.exec(yieldText)?.[1]??"";
  const instructions=Array.isArray(recipe.recipeInstructions)?recipe.recipeInstructions.map(value=>typeof value==="string"?value:typeof value==="object"&&value&&"text" in value?String(value.text):"").filter(Boolean).join("\n"):typeof recipe.recipeInstructions==="string"?recipe.recipeInstructions:"";
  const candidateUrl=sourceUrl.trim()||(typeof recipe.url==="string"?recipe.url.trim():"");
  return {...emptyRecipeFields(),title,servings,ingredients,instructions,sourceUrl:candidateUrl};
}

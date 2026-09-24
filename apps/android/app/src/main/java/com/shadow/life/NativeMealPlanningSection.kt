package com.shadow.life

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import org.json.JSONObject

private val mealTypes=listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他")
private fun mealTypeName(value:String)=mealTypes.firstOrNull{it.first==value}?.second?:value
private fun plusDays(value:String,days:Long)=LocalDate.parse(value).plusDays(days).toString()

@Composable internal fun NativeMealPlanningSection(
  overview:WorkspaceOverview.Meals,actionState:SubmitState,
  onSave:(NativeMealPlanDraft)->Unit,onBuild:(MealPlanningResultDtoMealPlansEntry,String)->Unit,
  onUpdate:(MealPlanningResultDtoShoppingListsEntryItemsEntry,String)->Unit,onSetStock:(MealPlanningResultDtoStockLotsEntry?,String,String,String,String?)->Unit,onSaveRecipe:(String,String,String,String,String)->Unit,onReset:()->Unit
){
  val today=LocalDate.now().toString()
  var editing by remember{mutableStateOf<MealPlanningResultDtoMealPlansEntry?>(null)}
  var showEditor by rememberSaveable{mutableStateOf(false)}
  var title by rememberSaveable{mutableStateOf("一周餐单")}
  var startsOn by rememberSaveable{mutableStateOf(today)}
  var endsOn by rememberSaveable{mutableStateOf(LocalDate.now().plusDays(6).toString())}
  var entryDate by rememberSaveable{mutableStateOf(today)}
  var mealType by rememberSaveable{mutableStateOf("dinner")}
  var entryTitle by rememberSaveable{mutableStateOf("")}
  var servings by rememberSaveable{mutableStateOf("1")}
  val entries=remember{mutableStateListOf<NativeMealPlanEntryDraft>()}
  var editingLot by remember{mutableStateOf<MealPlanningResultDtoStockLotsEntry?>(null)};var stockName by rememberSaveable{mutableStateOf("")};var stockQuantity by rememberSaveable{mutableStateOf("")};var stockUnit by rememberSaveable{mutableStateOf("")};var stockExpiry by rememberSaveable{mutableStateOf("")}
  var importText by rememberSaveable{mutableStateOf("")};var importUrl by rememberSaveable{mutableStateOf("")};var recipePreview by rememberSaveable{mutableStateOf(false)};var recipeError by rememberSaveable{mutableStateOf<String?>(null)};var recipeTitle by rememberSaveable{mutableStateOf("")};var recipeServings by rememberSaveable{mutableStateOf("")};var recipeIngredients by rememberSaveable{mutableStateOf("")};var recipeInstructions by rememberSaveable{mutableStateOf("")}
  var stockSubmitted by remember{mutableStateOf(false)};var recipeSubmitted by remember{mutableStateOf(false)}
  LaunchedEffect(actionState){if(recipeSubmitted)when(actionState){is SubmitState.Saved->{importText="";importUrl="";recipePreview=false;recipeTitle="";recipeServings="";recipeIngredients="";recipeInstructions="";recipeSubmitted=false};is SubmitState.Rejected->recipeSubmitted=false;else->Unit};if(stockSubmitted)when(actionState){is SubmitState.Saved->{editingLot=null;stockName="";stockQuantity="";stockUnit="";stockExpiry="";stockSubmitted=false};is SubmitState.Rejected->stockSubmitted=false;else->Unit}}
  val busy=actionState is SubmitState.Sending
  fun open(plan:MealPlanningResultDtoMealPlansEntry?,copy:Boolean=false){
    onReset();editing=if(copy)null else plan;showEditor=true
    title=if(copy&&plan!=null)"${plan.title}（下周）" else plan?.title?:"一周餐单"
    startsOn=plan?.startsOn?.let{plusDays(it,if(copy)7 else 0)}?:today
    endsOn=plan?.endsOn?.let{plusDays(it,if(copy)7 else 0)}?:LocalDate.now().plusDays(6).toString()
    entryDate=startsOn;entries.clear()
    plan?.entries?.forEach{item->entries+=NativeMealPlanEntryDraft(plusDays(item.planDate,if(copy)7 else 0),item.mealType.wireValue,item.title,item.servings,item.recipeId,item.recipeRevision)}
  }
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("餐单与购物清单",style=MaterialTheme.typography.titleLarge);TextButton(onClick={if(showEditor){showEditor=false}else open(null)}){Text(if(showEditor)"收起编辑" else "新建餐单")}}
    when(actionState){is SubmitState.Sending->LinearProgressIndicator(Modifier.fillMaxWidth());is SubmitState.Rejected->Text(actionState.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text(if(actionState.receipt.queued)"已保存，正在同步" else "已保存",color=MaterialTheme.colorScheme.primary);else->Unit}
    if(showEditor)LifeCard{
      Text(if(editing==null)"安排餐单" else "编辑餐单",style=MaterialTheme.typography.titleMedium)
      OutlinedTextField(title,{title=it},Modifier.fillMaxWidth(),label={Text("名称")},singleLine=true)
      Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        OutlinedTextField(startsOn,{startsOn=it},Modifier.weight(1f),label={Text("开始日期")},singleLine=true)
        OutlinedTextField(endsOn,{endsOn=it},Modifier.weight(1f),label={Text("结束日期")},singleLine=true)
      }
      Text("添加计划餐次",style=MaterialTheme.typography.titleSmall)
      OutlinedTextField(entryDate,{entryDate=it},Modifier.fillMaxWidth(),label={Text("计划日期 YYYY-MM-DD")},singleLine=true)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){mealTypes.forEach{(key,label)->FilterChip(selected=mealType==key,onClick={mealType=key},label={Text(label)})}}
      OutlinedTextField(entryTitle,{entryTitle=it},Modifier.fillMaxWidth(),label={Text("想吃什么")},singleLine=true)
      OutlinedTextField(servings,{servings=it},Modifier.fillMaxWidth(),label={Text("份数")},singleLine=true)
      OutlinedButton(onClick={entries+=NativeMealPlanEntryDraft(entryDate,mealType,entryTitle.trim(),servings);entryTitle=""},enabled=entryTitle.isNotBlank()&&runCatching{LocalDate.parse(entryDate) in LocalDate.parse(startsOn)..LocalDate.parse(endsOn)}.getOrDefault(false)){Text("加入餐单")}
      entries.forEachIndexed{index,item->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("${item.date} ${mealTypeName(item.mealType)} · ${item.title} · ${item.servings} 份",Modifier.weight(1f));TextButton(onClick={entries.removeAt(index)}){Text("移除")}}}
      Button(onClick={onSave(NativeMealPlanDraft(title,startsOn,endsOn,entries.toList(),editing?.id,editing?.revision,editing?.state?.wireValue?:"active"))},enabled=!busy&&title.isNotBlank()&&entries.isNotEmpty(),modifier=Modifier.fillMaxWidth()){Text("保存餐单")}
      Text("餐单只是安排；买到和实际吃下的内容分别记录。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if(overview.plans.isEmpty())Text("还没有餐单，可以先安排一餐。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    overview.plans.forEach{plan->LifeCard{
      var extraNames by rememberSaveable(plan.id){mutableStateOf("")}
      Text(plan.title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
      Text("${plan.startsOn} 至 ${plan.endsOn} · ${plan.entries.size} 餐",color=MaterialTheme.colorScheme.onSurfaceVariant)
      plan.entries.take(4).forEach{Text("${it.planDate.takeLast(5)} ${mealTypeName(it.mealType.wireValue)} · ${it.title}",style=MaterialTheme.typography.bodyMedium)}
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        OutlinedButton(onClick={open(plan)},enabled=!busy){Text("编辑")}
        OutlinedButton(onClick={open(plan,true)},enabled=!busy){Text("复制到下周")}
        if(overview.lists.none{it.mealPlanId==plan.id&&it.mealPlanRevision==plan.revision})Button(onClick={onBuild(plan,extraNames)},enabled=!busy){Text("生成购物清单")}
      }
      if(overview.lists.none{it.mealPlanId==plan.id&&it.mealPlanRevision==plan.revision})OutlinedTextField(extraNames,{extraNames=it},Modifier.fillMaxWidth(),label={Text("补充采购品（可选，每行一项）")})
    }}
    HorizontalDivider();Text("导入食谱来源",style=MaterialTheme.typography.titleLarge)
    Text("粘贴 schema.org Recipe JSON-LD，预览并校对后再明确保存；不会直接访问来源网站。",style=MaterialTheme.typography.bodySmall)
    LifeCard{OutlinedTextField(importUrl,{importUrl=it},Modifier.fillMaxWidth(),label={Text("来源链接")});OutlinedTextField(importText,{importText=it},Modifier.fillMaxWidth(),label={Text("Recipe JSON-LD")},minLines=3);OutlinedButton(onClick={try{val value=previewRecipeImport(importText,importUrl);recipeTitle=value.title;recipeServings=value.servings;recipeIngredients=value.ingredients;recipeInstructions=value.instructions;importUrl=value.sourceUrl;recipePreview=true;recipeError=null}catch(error:Exception){recipeError=error.message?:"无法预览来源"}},enabled=importText.isNotBlank()){Text("预览并校对")};recipeError?.let{Text(it,color=MaterialTheme.colorScheme.error)};if(recipePreview){OutlinedTextField(recipeTitle,{recipeTitle=it},Modifier.fillMaxWidth(),label={Text("标题")});OutlinedTextField(recipeServings,{recipeServings=it},Modifier.fillMaxWidth(),label={Text("份数")});OutlinedTextField(recipeIngredients,{recipeIngredients=it},Modifier.fillMaxWidth(),label={Text("原料：名称|数量|单位，每行一项")},minLines=3);OutlinedTextField(recipeInstructions,{recipeInstructions=it},Modifier.fillMaxWidth(),label={Text("步骤")},minLines=2);Button(onClick={recipeSubmitted=true;onSaveRecipe(recipeTitle,recipeServings,recipeIngredients,recipeInstructions,importUrl)},enabled=!busy&&recipeTitle.isNotBlank()&&recipeServings.toBigDecimalOrNull()?.let{it>java.math.BigDecimal.ZERO}==true&&recipeIngredients.lines().filter(String::isNotBlank).all{it.split("|",limit=3).size==3}&&(importUrl.startsWith("https://")||importUrl.startsWith("http://"))){Text("保存食谱")}}}
    HorizontalDivider();Text("实际食品库存",style=MaterialTheme.typography.titleLarge)
    Text("只填写亲自核实的库存；购物清单标记买到不会自动入库。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    LifeCard{OutlinedTextField(stockName,{stockName=it},Modifier.fillMaxWidth(),label={Text("食品名称")});OutlinedTextField(stockQuantity,{stockQuantity=it},Modifier.fillMaxWidth(),label={Text("实际数量（可填 0）")});OutlinedTextField(stockUnit,{stockUnit=it},Modifier.fillMaxWidth(),label={Text("单位")});OutlinedTextField(stockExpiry,{stockExpiry=it},Modifier.fillMaxWidth(),label={Text("到期日 YYYY-MM-DD（可选）")});Button(onClick={stockSubmitted=true;onSetStock(editingLot,stockName,stockQuantity,stockUnit,stockExpiry.ifBlank{null})},enabled=!busy&&stockName.isNotBlank()&&stockQuantity.toBigDecimalOrNull()!=null&&stockQuantity.toBigDecimalOrNull()!!>=java.math.BigDecimal.ZERO&&stockUnit.isNotBlank()&&runCatching{stockExpiry.isBlank()||LocalDate.parse(stockExpiry)!=null}.getOrDefault(false)){Text("保存库存批次")}}
    overview.stockLots.forEach{lot->LifeCard{Text("${lot.name} · ${lot.quantity} ${lot.unit}");Text(lot.expiresOn?.let{"到期 $it"}?:"未记录到期日");TextButton(onClick={editingLot=lot;stockName=lot.name;stockQuantity=lot.quantity;stockUnit=lot.unit;stockExpiry=lot.expiresOn.orEmpty()}){Text("校正")}}}
    if(overview.stockTruncated)Text("库存批次超过 100 条，缺口保持未知。")
    if(overview.lists.isNotEmpty())HorizontalDivider()
    overview.lists.forEach{list->LifeCard{
      Text(list.title,style=MaterialTheme.typography.titleMedium)
      Text("${list.items.count{it.state.wireValue=="needed"}} 项待买",color=MaterialTheme.colorScheme.onSurfaceVariant)
      list.items.forEach{item->Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text("${item.name}${item.quantity?.let{" · $it ${item.unit.orEmpty()}"}.orEmpty()}",style=MaterialTheme.typography.bodyLarge)
        Text(when(item.state.wireValue){"bought"->"已买到";"skipped"->"已跳过";else->"待买"}+" · "+stockGap(item,overview.stockLots,overview.stockTruncated,overview.plans.firstOrNull{it.id==list.mealPlanId}?.endsOn?:LocalDate.now().toString()),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          if(item.state.wireValue!="bought")TextButton(onClick={onUpdate(item,"bought")},enabled=!busy){Text("买到了")}
          if(item.state.wireValue!="skipped")TextButton(onClick={onUpdate(item,"skipped")},enabled=!busy){Text("跳过")}
          if(item.state.wireValue!="needed")TextButton(onClick={onUpdate(item,"needed")},enabled=!busy){Text("恢复待买")}
        }
      }}
    }}
  }
}

private fun stockGap(item:MealPlanningResultDtoShoppingListsEntryItemsEntry,lots:List<MealPlanningResultDtoStockLotsEntry>,truncated:Boolean,neededBy:String):String{
  val needed=item.quantity?.toBigDecimalOrNull()?:return "库存未知";val unit=item.unit?:return "库存未知";if(truncated)return "库存未知"
  val matching=lots.filter{it.name.trim().equals(item.name.trim(),true)&&it.unit==unit&&(it.expiresOn?.let{expiry->expiry>=neededBy}?:true)};if(matching.isEmpty())return "库存未知"
  val owned=matching.fold(java.math.BigDecimal.ZERO){sum,lot->sum+(lot.quantity.toBigDecimalOrNull()?:java.math.BigDecimal.ZERO)}
  return if(owned>=needed)"已有库存足够" else "缺口 ${needed-owned} $unit"
}

private data class RecipeImportPreview(val title:String,val servings:String,val ingredients:String,val instructions:String,val sourceUrl:String)
private fun previewRecipeImport(raw:String,sourceUrl:String):RecipeImportPreview{
  require(raw.length<=200000){"来源内容过长"}
  val root=JSONObject(raw);val graph=root.optJSONArray("@graph");val candidates=if(graph!=null)(0 until graph.length()).mapNotNull{graph.optJSONObject(it)} else listOf(root)
  val recipe=candidates.firstOrNull{it.optString("@type")=="Recipe"}?:error("未找到 schema.org Recipe")
  val title=recipe.optString("name").trim();val ingredients=recipe.optJSONArray("recipeIngredient")?:error("来源缺少原料")
  require(title.isNotBlank()&&ingredients.length()>0){"来源缺少标题或原料"}
  val rows=(0 until ingredients.length()).take(100).map{index->val line=ingredients.optString(index).trim();val match=Regex("^(\\d+(?:\\.\\d+)?)\\s+(\\S+)\\s+(.+)$").find(line);if(match!=null)"${match.groupValues[3]}|${match.groupValues[1]}|${match.groupValues[2]}" else "$line||"}
  val yield=Regex("^\\s*(\\d+(?:\\.\\d+)?)").find(recipe.optString("recipeYield"))?.groupValues?.get(1).orEmpty()
  val steps=recipe.optJSONArray("recipeInstructions")?.let{array->(0 until array.length()).joinToString("\n"){index->array.optJSONObject(index)?.optString("text")?:array.optString(index)}}?:recipe.optString("recipeInstructions")
  return RecipeImportPreview(title,yield,rows.joinToString("\n"),steps,sourceUrl.ifBlank{recipe.optString("url")})
}

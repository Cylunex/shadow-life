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

private val mealTypes=listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他")
private fun mealTypeName(value:String)=mealTypes.firstOrNull{it.first==value}?.second?:value
private fun plusDays(value:String,days:Long)=LocalDate.parse(value).plusDays(days).toString()

@Composable internal fun NativeMealPlanningSection(
  overview:WorkspaceOverview.Meals,actionState:SubmitState,
  onSave:(NativeMealPlanDraft)->Unit,onBuild:(MealPlanningResultDtoMealPlansEntry,String)->Unit,
  onUpdate:(MealPlanningResultDtoShoppingListsEntryItemsEntry,String)->Unit,onReset:()->Unit
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
    if(overview.lists.isNotEmpty())HorizontalDivider()
    overview.lists.forEach{list->LifeCard{
      Text(list.title,style=MaterialTheme.typography.titleMedium)
      Text("${list.items.count{it.state.wireValue=="needed"}} 项待买",color=MaterialTheme.colorScheme.onSurfaceVariant)
      list.items.forEach{item->Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text("${item.name}${item.quantity?.let{" · $it ${item.unit.orEmpty()}"}.orEmpty()}",style=MaterialTheme.typography.bodyLarge)
        Text(when(item.state.wireValue){"bought"->"已买到";"skipped"->"已跳过";else->"待买"},style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          if(item.state.wireValue!="bought")TextButton(onClick={onUpdate(item,"bought")},enabled=!busy){Text("买到了")}
          if(item.state.wireValue!="skipped")TextButton(onClick={onUpdate(item,"skipped")},enabled=!busy){Text("跳过")}
          if(item.state.wireValue!="needed")TextButton(onClick={onUpdate(item,"needed")},enabled=!busy){Text("恢复待买")}
        }
      }}
    }}
  }
}

package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

@Composable internal fun RecipeCatalog(accountId:String,refreshKey:Any?){
  val context=LocalContext.current
  val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var query by rememberSaveable{mutableStateOf("")}
  var state by remember(accountId){mutableStateOf<LoadState<JSONObject>>(LoadState.Loading)}
  var retry by remember{mutableIntStateOf(0)}
  var expanded by rememberSaveable{mutableStateOf<String?>(null)}
  LaunchedEffect(accountId,query,retry,refreshKey){
    state=LoadState.Loading
    kotlinx.coroutines.delay(250)
    try{state=LoadState.Ready(repository.recipeCatalog(query))}
    catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed("食谱暂时无法读取，请稍后重试")}
  }
  OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("查找已保存食谱")},singleLine=true)
  StateContent(state,{retry++}){}
  val recipes=(state as? LoadState.Ready)?.value?.getJSONArray("recipes")
  if(recipes!=null){
    if(recipes.length()==0)Text("没有匹配的已保存食谱")
    for(index in 0 until recipes.length()){
      val recipe=recipes.getJSONObject(index)
      LifeCard{
        Text(recipe.getString("title"),style=MaterialTheme.typography.titleMedium)
        Text("${recipe.getString("servings")} 份")
        TextButton(onClick={expanded=if(expanded==recipe.getString("id"))null else recipe.getString("id")}){Text(if(expanded==recipe.getString("id"))"收起做法" else "查看做法")}

      }
    }
  }
  val recipe=recipes?.trainingObjects()?.firstOrNull{it.getString("id")==expanded}
  if(recipe!=null)RecipeCookingView(recipe){expanded=null}

}


@Composable internal fun RecipeCookingView(recipe:JSONObject,initialServings:String?=null,onBack:()->Unit){
  val original=recipe.getString("servings").toBigDecimal()
  var servingsText by rememberSaveable(recipe.getString("id")){mutableStateOf(initialServings?:original.toPlainString())}
  var step by rememberSaveable(recipe.getString("id")){mutableIntStateOf(-1)}
  val servings=servingsText.toBigDecimalOrNull()?.takeIf{it.signum()>0}?:original
  val scale=servings.divide(original,java.math.MathContext.DECIMAL64)
  val ingredients=recipe.getJSONArray("items").trainingObjects().map{it.getJSONObject("snapshot")}
  val steps=recipe.optString("instructions").takeUnless{recipe.isNull("instructions")}.orEmpty()
    .lineSequence().map(String::trim).filter(String::isNotEmpty).toList()
  LifeFullScreen(recipe.getString("title"),onBack){
    if(step in steps.indices){
      val view=androidx.compose.ui.platform.LocalView.current
      DisposableEffect(view){
        val original=view.keepScreenOn
        view.keepScreenOn=true
        onDispose{view.keepScreenOn=original}
      }
    }
    LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){
      if(step<0){
        item{
          Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
            OutlinedButton(onClick={servingsText=(servings-java.math.BigDecimal.ONE).stripTrailingZeros().toPlainString()},
              enabled=servings>java.math.BigDecimal.ONE){Text("−")}
            Text("${servings.stripTrailingZeros().toPlainString()} 份")
            OutlinedButton(onClick={servingsText=(servings+java.math.BigDecimal.ONE).stripTrailingZeros().toPlainString()}){Text("＋")}
          }
        }
        item{Text("食材",style=MaterialTheme.typography.titleLarge)}
        itemsIndexed(ingredients){_,row->
          val unit=row.optString("unit")
          val quantity=row.optString("quantity").toBigDecimalOrNull()?.takeIf{unit.isNotBlank()}
          LifeCard{Text(row.getString("name"));Text(quantity?.multiply(scale)?.setScale(3,java.math.RoundingMode.HALF_UP)?.stripTrailingZeros()?.toPlainString()?.let{"$it $unit"}?:"份量未提供")}
        }
        if(steps.isNotEmpty())item{Button(onClick={step=0}){Text("开始烹饪")}}
        else item{Text("尚未填写做法")}
      }else{
        val current=step.coerceAtMost(steps.lastIndex)
        if(current>=0)item{
          Text("第 ${current+1} 步 · 共 ${steps.size} 步",style=MaterialTheme.typography.titleMedium)
          Text(steps[current],style=MaterialTheme.typography.headlineSmall)
          Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick={step--}){Text(if(current==0)"返回食材" else "上一步")}
            Button(onClick={step=if(current==steps.lastIndex)-1 else current+1}){
              Text(if(current==steps.lastIndex)"完成" else "下一步")
            }
          }
        }
      }
    }
  }
}

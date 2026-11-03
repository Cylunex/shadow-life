package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
    catch(error:Exception){state=LoadState.Failed(error.message?:"食谱暂时无法读取")}
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
        if(expanded==recipe.getString("id"))Text(if(recipe.isNull("instructions"))"尚未填写做法" else recipe.getString("instructions"))
      }
    }
  }
}

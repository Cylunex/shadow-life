package com.shadow.life

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId

@Composable internal fun StockRecipesCard(accountId:String,lot:String,date:String){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var open by rememberSaveable(lot){mutableStateOf(false)}
  var offset by rememberSaveable(lot){mutableIntStateOf(0)}
  var retry by remember{mutableIntStateOf(0)}
  var next by remember{mutableStateOf<Int?>(null)}
  var items by remember(lot){mutableStateOf<List<JSONObject>>(emptyList())}
  var message by remember(lot){mutableStateOf("")}
  var command by rememberSaveable(lot){mutableStateOf<String?>(null)}
  var recipeId by rememberSaveable(lot){mutableStateOf("")}
  var planId by rememberSaveable(lot){mutableStateOf("")}
  var listId by rememberSaveable(lot){mutableStateOf("")}
  var pending by remember{mutableStateOf(false)}
  LaunchedEffect(accountId,open,lot,date,offset,retry){
    if(!open)return@LaunchedEffect
    try{
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      val page=repo.stockRecipes(lot,date,offset)
      items=page.getJSONArray("items").trainingObjects()
      next=page.optString("next_offset").toIntOrNull()
      message=if(items.isEmpty())"没有用到这批有效食材的食谱" else ""
    }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"食谱读取失败"}
  }
  LaunchedEffect(accountId,command){
    val id=command?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    val dao=app.database.commands()
    dao.observeCommandState(accountId,session.subjectId,id).collect{state->
      when(state){
        "committed"->{
          val row=dao.command(id)?.takeIf{it.accountId==accountId&&it.subjectId==session.subjectId}
          if(row!=null){val values=JSONObject(app.queue.receiptBody(row)).getJSONObject("actual_values")
            if(row.capability=="life.save_meal_plan")planId=values.getString("meal_plan_id") else listId=values.getString("shopping_list_id")}
          command=null;message=if(listId.isEmpty())"已加入当日餐单" else "缺项已加入购物清单"
        }
        "failed","blocked"->{command=null;message="同步失败，请核对当前库存或餐单"}
      }
    }
  }
  fun save(cap:String,input:JSONObject){
    pending=true
    scope.launch{
      try{command=repo.captureWrite(cap,input,accountId).commandId;message="已保存到本机，待同步"}
      catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"保存失败"}finally{pending=false}
    }
  }
  TextButton(onClick={open=!open}){Text("用这批食材找菜")}
  if(open){
    items.forEach{row->
      val name=row.getString("title");val id=row.getString("id");val unknown=row.getInt("unknown_count");val short=row.getInt("short_count")
      Text("$name · "+when{unknown>0->"$unknown 项待核对";short>0->"缺 $short 种";else->"现有库存可做"})
      row.getJSONArray("ingredients").trainingObjects().forEach{i->Text(i.getString("name")+" · "+when{
        i.isNull("missing")->"缺量未知";i.getString("missing").toBigDecimal().signum()==0->"已有足量";else->"差 ${i.getString("missing")} ${i.getString("unit")}"
      })}
      Button(enabled=!pending&&command==null&&(id!=recipeId||planId.isEmpty()),onClick={
        recipeId=id;planId="";listId=""
        val entry=JSONObject().put("recipe_id",id).put("recipe_revision",row.getInt("revision")).put("title",name)
          .put("plan_date",date).put("meal_type","other").put("servings",row.getString("servings"))
        save("life.save_meal_plan",JSONObject().put("title",name).put("starts_on",date).put("ends_on",date).put("time_zone",ZoneId.systemDefault().id)
          .put("state","active").put("entries",JSONArray().put(entry)))
      }){Text("加入当日餐单")}
      if(recipeId==id&&planId.isNotEmpty()&&unknown+short>0)
        TextButton(enabled=!pending&&command==null&&listId.isEmpty(),onClick={save("life.build_shopping_list",JSONObject().put("meal_plan_id",planId)
          .put("expected_meal_plan_revision",1).put("title",name+"缺项").put("shortfall_on",date))}){Text("把缺项加入购物清单")}
    }
    if(offset>0)TextButton(onClick={offset=maxOf(0,offset-15)}){Text("上一页食谱")}
    next?.let{n->TextButton(onClick={offset=n}){Text("更多食谱")}}
    if(message.isNotBlank()){Text(message);TextButton(onClick={retry++}){Text("重新读取")}}
  }
}

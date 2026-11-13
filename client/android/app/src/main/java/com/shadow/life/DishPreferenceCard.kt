package com.shadow.life

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable internal fun DishPreferenceCard(accountId:String,purchase:DishPurchase){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var open by rememberSaveable{mutableStateOf(false)}
  var shop by rememberSaveable{mutableStateOf(purchase.shop)}
  var source by rememberSaveable{mutableStateOf(purchase.source)}
  var dish by rememberSaveable{mutableStateOf("")}
  var itemId by rememberSaveable{mutableStateOf<String?>(null)}
  var note by rememberSaveable{mutableStateOf("")}
  var choice by rememberSaveable{mutableStateOf("try")}
  val choices=mapOf("repeat" to "还会点","avoid" to "避开","try" to "下次想试")
  var rows by remember{mutableStateOf<List<JSONObject>>(emptyList())}
  var next by remember{mutableStateOf<JSONObject?>(null)}
  var busy by remember{mutableStateOf(false)}
  var message by remember{mutableStateOf("")}
  var queued by rememberSaveable{mutableStateOf<String?>(null)}
  fun load(more:Boolean=false){
    val cursor=if(more)next else null
    busy=true
    scope.launch{
      try{
        check(app.sessions.active()?.accountId==accountId){"账号已切换"}
        val page=repository.dishPreferences(shop.trim(),cursor?.getString("before_at"),cursor?.getString("before_id"))
        rows=((if(more)rows else emptyList())+page.getJSONArray("items").trainingObjects()).distinctBy{it.getString("id")}
        next=page.optJSONObject("next")
      }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"读取失败"}finally{busy=false}
    }
  }
  val existing=rows.find{it.getString("shop_name")==shop.trim()&&it.getString("shop_source")==source.trim()&&it.getString("dish_name")==dish.trim()}
  fun save(value:String){
    busy=true
    scope.launch{
      try{
        val input=JSONObject().put("shop_name",shop.trim()).put("shop_source",source.trim()).put("dish_name",dish.trim())
          .put("preference",value).put("note",note.trim())
        itemId?.let{input.put("purchase_item_id",it)}
        existing?.let{input.put("expected_revision",it.getInt("revision"))}
        queued=repository.captureWrite("life.save_dish_preference",input,accountId).commandId
        message="偏好已保存到本机，待同步"
      }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"保存失败"}finally{busy=false}
    }
  }
  LaunchedEffect(accountId,queued){
    val id=queued?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect{state->
      when(state){
        "committed"->{queued=null;message="偏好已同步";load()}
        "blocked","failed"->{queued=null;message="同步失败，可查找门店后重试";load()}
      }
    }
  }
  LifeCard{
    TextButton(onClick={open=!open;if(open)load()},enabled=!busy){Text("门店菜品偏好")}
    if(open){
      OutlinedTextField(shop,{shop=it},label={Text("门店或分店名称")})
      TextButton(enabled=!busy,onClick={load()}){Text("查找门店")}
      rows.forEach{row->TextButton(onClick={
        shop=row.getString("shop_name");source=row.getString("shop_source");dish=row.getString("dish_name");choice=row.getString("preference")
        note=row.optString("note").takeUnless{it=="null"}.orEmpty();itemId=row.optString("purchase_item_id").takeUnless{it=="null"}
      }){Text("${row.getString("shop_name")} · ${row.getString("dish_name")} · ${choices[row.getString("preference")]} ${row.optString("note").takeUnless{it=="null"}.orEmpty()}")}}
      if(next!=null)TextButton(enabled=!busy,onClick={load(true)}){Text("更多菜品")}
      purchase.items.forEach{(id,name)->TextButton(onClick={dish=name;itemId=id;choice="repeat";note=""}){Text("从本单带入 · $name")}}
      OutlinedTextField(source,{source=it},label={Text("地点引用或来源")})
      OutlinedTextField(dish,{dish=it;itemId=null},label={Text("菜名与做法")})
      choices.forEach{(value,label)->FilterChip(choice==value,{choice=value},label={Text(label)})}
      OutlinedTextField(note,{note=it},label={Text("口味备注")})
      Button(enabled=!busy&&queued==null&&shop.isNotBlank()&&source.isNotBlank()&&dish.isNotBlank(),onClick={save(choice)}){Text("保存菜品偏好")}
      if(existing!=null)TextButton(enabled=!busy&&queued==null,onClick={save("cleared")}){Text("清除偏好")}
      if(message.isNotEmpty())Text(message)
    }
  }
}

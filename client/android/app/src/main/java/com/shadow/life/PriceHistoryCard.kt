package com.shadow.life

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable internal fun PriceHistoryCard(accountId:String,purchase:DishPurchase){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var open by rememberSaveable{mutableStateOf(false)}
  var item by rememberSaveable{mutableStateOf(purchase.items.first().first)}
  var product by rememberSaveable{mutableStateOf("")}
  var before by remember{mutableStateOf<JSONObject?>(null)}
  var data by remember{mutableStateOf<JSONObject?>(null)}
  var error by remember{mutableStateOf("")}
  var reload by remember{mutableIntStateOf(0)}
  var queue by rememberSaveable{mutableStateOf<String?>(null)}
  var busy by remember{mutableStateOf(false)}
  var edit by remember{mutableStateOf<JSONObject?>(null)}
  LaunchedEffect(accountId,open,item,product,before,reload){
    if(!open)return@LaunchedEffect
    try{
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      data=repo.purchasePrices(item.takeIf{it.isNotEmpty()},product.takeIf{it.isNotEmpty()},before);error=""
    }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"读取失败"}
  }
  LaunchedEffect(queue,accountId){
    val id=queue?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect{state->
      when(state){
        "committed"->{queue=null;edit=null;reload++}
        "failed","blocked"->{queue=null;error="规格未同步，请刷新后重试"}
      }
    }
  }
  LifeCard{
    TextButton(onClick={open=!open}){Text("我的常购价")}
    if(open){
      purchase.items.forEach{(id,title)->TextButton(onClick={item=id;product="";before=null;edit=null}){Text("本单 · $title")}}
      data?.getJSONObject("coverage")?.let{Text("可比 ${it.getInt("comparable")}／${it.getInt("total")} 行")}
      data?.getJSONArray("items")?.trainingObjects()?.forEach{r->
        Text("${r.getString("product")} · ${r.getString("occurred_on")}")
        Text(if(r.isNull("unit_price")){if(r.getBoolean("has_refund"))"有未分配退款" else "规格或行价待补"}
          else "${r.getString("unit_price")} ${r.getString("currency")}/${r.getString("base_unit")} · "+if(r.getString("price_basis")=="paid")"实付行价" else "行标价，仅扣已分配优惠")
        TextButton(onClick={product=r.getString("product");item="";before=null;edit=null}){Text("比较同款")}
        TextButton(onClick={edit=r}){Text("补规格与口径")}
      }
      data?.optJSONObject("next")?.let{next->TextButton(onClick={before=next}){Text("更早行价")}}
      edit?.let{r->key(r.getString("id")){
        var name by rememberSaveable{mutableStateOf(r.getString("product"))}
        var count by rememberSaveable{mutableStateOf(r.getString("pack_count"))}
        var size by rememberSaveable{mutableStateOf(r.optString("pack_size").takeUnless{it=="null"}.orEmpty())}
        var unit by rememberSaveable{mutableStateOf(r.optString("unit").takeUnless{it=="null"}?:"ml")}
        var basis by rememberSaveable{mutableStateOf(r.getString("price_basis"))}
        var discount by rememberSaveable{mutableStateOf(r.getString("discount"))}
        OutlinedTextField(name,{name=it},label={Text("同款名称")})
        OutlinedTextField(count,{count=it},label={Text("整行购买份数")})
        OutlinedTextField(size,{size=it},label={Text("每份净含量")})
        listOf("g","kg","ml","L","件").forEach{u->FilterChip(unit==u,{unit=u},label={Text(u)})}
        FilterChip(basis=="paid",{basis=if(basis=="paid")"listed" else "paid"},label={Text("已扣优惠的实付行价")})
        if(basis=="listed")OutlinedTextField(discount,{discount=it},label={Text("可归属本行的优惠")})
        Button(enabled=!busy&&queue==null&&name.isNotBlank()&&(count.toDoubleOrNull()?:0.0)>0&&(size.toDoubleOrNull()?:0.0)>0,onClick={
          val input=JSONObject().put("purchase_item_id",r.getString("id")).put("product",name).put("pack_count",count).put("pack_size",size)
            .put("unit",unit).put("price_basis",basis).put("discount",if(basis=="paid")"0" else discount)
          if(!r.isNull("revision"))input.put("expected_revision",r.getInt("revision"))
          busy=true
          scope.launch{try{queue=repo.captureWrite("life.set_price_spec",input,accountId).commandId}
            catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"保存失败"}finally{busy=false}}
        }){Text(if(queue!=null)"已保存到本机，待同步" else "保存规格")}
      }}
      if(error.isNotBlank()){Text(error);TextButton(onClick={reload++}){Text("重新读取")}}
    }
  }
}

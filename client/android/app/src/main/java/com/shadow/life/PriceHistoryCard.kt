package com.shadow.life

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

@Composable internal fun PriceHistoryCard(accountId:String,purchase:DishPurchase){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(accountId){NativeLifeRepository(context,app)}
  var open by rememberSaveable{mutableStateOf(false)}
  var item by rememberSaveable{mutableStateOf(purchase.items.first().first)}
  var product by rememberSaveable{mutableStateOf("")}
  var before by remember{mutableStateOf<JSONObject?>(null)}
  var data by remember{mutableStateOf<JSONObject?>(null)}
  var error by remember{mutableStateOf("")}
  var reload by remember{mutableIntStateOf(0)}
  var edit by remember{mutableStateOf<JSONObject?>(null)}
  LaunchedEffect(accountId,open,item,product,before,reload){
    if(!open)return@LaunchedEffect
    try{
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      data=repo.purchasePrices(item.takeIf{it.isNotEmpty()},product.takeIf{it.isNotEmpty()},before);error=""
    }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"读取失败"}
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
      edit?.let{row->
        PriceSpecEditor(accountId,row,{edit=null}){edit=null;reload++}
      }
      if(error.isNotBlank()){Text(error);TextButton(onClick={reload++}){Text("重新读取")}}
    }
  }
}

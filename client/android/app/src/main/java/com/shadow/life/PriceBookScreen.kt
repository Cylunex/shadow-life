package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

@Composable internal fun PriceBookScreen(accountId:String,onBack:()->Unit,onRecord:(String)->Unit){
  val context=LocalContext.current
  val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var query by rememberSaveable{mutableStateOf("")}
  var product by rememberSaveable{mutableStateOf("")}
  var cursor by rememberSaveable(product){mutableStateOf<String?>(null)}
  var retry by remember{mutableIntStateOf(0)}
  var state by remember(product,cursor,retry){mutableStateOf<LoadState<JSONObject>>(LoadState.Loading)}
  LaunchedEffect(accountId,product,cursor,retry){
    try{
      state=LoadState.Ready(repository.purchasePrices(product=product.takeIf(String::isNotBlank),before=cursor?.let{JSONObject(it)}))
    }catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"无法读取价格记录")}
  }
  LifeFullScreen("常购价格",onBack){
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
      OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("按商品全名查找")},singleLine=true,
        trailingIcon={TextButton(onClick={product=query.trim();cursor=null;retry++}){Text("查找")}})
      val data=(state as? LoadState.Ready)?.value
      if(data==null)StateContent(state,{retry++}){}
      if(data!=null)LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){
        val entries=data.getJSONArray("items").trainingObjects()
        if(entries.isEmpty())item{Text("没有找到价格记录")}
        items(entries,key={it.getString("id")}){row->
          LifeCard{
            val name=row.getString("product")
            Text(name,style=MaterialTheme.typography.titleMedium)
            val merchant=row.optString("merchant").takeUnless{row.isNull("merchant")||it.isBlank()}
            Text(listOfNotNull(row.getString("occurred_on"),merchant).joinToString(" · "))
            Text(if(row.isNull("unit_price"))"暂无可比行价"
            else "${row.getString("unit_price")} ${row.getString("currency")}/${row.getString("base_unit")} · "+
              if(row.getString("price_basis")=="paid")"实付行价" else "行标价扣已分配优惠")
            Row{
              TextButton(onClick={query=name;product=name;cursor=null}){Text("比较同款")}
              TextButton(onClick={onRecord(row.getString("record_id"))}){Text("打开购买记录")}
            }
          }
        }
        item{
          if(cursor!=null)TextButton(onClick={cursor=null}){Text("返回最新")}
          data.optJSONObject("next")?.let{next->TextButton(onClick={cursor=next.toString()}){Text("查看更早价格")}}
        }
      }
    }
  }
}

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

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun PriceBookScreen(
  accountId:String,onBack:()->Unit,onRecord:(String)->Unit,onSelect:((JSONObject)->Unit)?=null,initialProduct:String=""
){
  val context=LocalContext.current
  val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var query by rememberSaveable(initialProduct){mutableStateOf(initialProduct)}
  var search by rememberSaveable{mutableStateOf("")}
  var product by rememberSaveable(initialProduct){mutableStateOf(initialProduct)}
  var cursor by rememberSaveable{mutableStateOf<String?>(null)}
  var previousSearch by rememberSaveable(initialProduct){mutableStateOf<String?>(null)}
  var previousCursor by rememberSaveable(initialProduct){mutableStateOf<String?>(null)}
  var recent by remember(accountId){mutableStateOf(emptyList<String>())}
  var retry by remember{mutableIntStateOf(0)}
  var edit by remember{mutableStateOf<JSONObject?>(null)}
  var refunds by remember{mutableStateOf<JSONObject?>(null)}
  var state by remember(accountId,product,search,cursor,retry){mutableStateOf<LoadState<JSONObject>>(LoadState.Loading)}
  fun selectProduct(value:String){
    if(product.isEmpty()&&value.isNotBlank()){
      previousSearch=search
      previousCursor=cursor
    }
    if(value.isEmpty()){
      previousSearch=null
      previousCursor=null
    }
    query=value
    search=""
    product=value
    cursor=null
  }
  LaunchedEffect(accountId,product,search,cursor,retry){
    try{
      val page=repository.purchasePrices(product=product.takeIf(String::isNotBlank),
        before=cursor?.let(::JSONObject),query=search.takeIf(String::isNotBlank))
      if(product.isEmpty()&&search.isEmpty()&&cursor==null){
        recent=page.getJSONArray("items").trainingObjects().map{it.getString("product")}.distinct().take(8)
      }
      state=LoadState.Ready(page)
    }catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"无法读取价格记录")}
  }
  fun goBack(){
    val listSearch=previousSearch
    if(product.isBlank()||listSearch==null){
      onBack()
      return
    }
    product=""
    search=listSearch
    query=listSearch
    cursor=previousCursor
    previousSearch=null
    previousCursor=null
  }
  LifeFullScreen(if(onSelect==null)"常购价格" else "选择购买明细",::goBack){
    Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.spacedBy(8.dp)){
      OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth(),label={Text("搜索商品")},
        singleLine=true,trailingIcon={TextButton(onClick={product="";search=query.trim();cursor=null;retry++}){Text("搜索")}})
      val data=(state as? LoadState.Ready)?.value
      if(data==null)StateContent(state,{retry++}){}
      if(data!=null)LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)){
        val entries=data.getJSONArray("items").trainingObjects()
        if(onSelect==null){
          val names=if(search.isBlank())recent else entries.map{it.getString("product")}.distinct()
          if(names.isNotEmpty())item{
            Text(if(search.isBlank())"最近商品" else "本页匹配商品",style=MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
              names.forEach{name->FilterChip(name==product,{selectProduct(name)},label={Text(name,maxLines=1)})}
            }
          }
          if(product.isNotEmpty())item{
            Text("同款 · $product",style=MaterialTheme.typography.titleMedium)
            Text("按币种、单位和计价口径对照",style=MaterialTheme.typography.bodySmall)
          }
        }
        if(product.isNotEmpty()||search.isNotEmpty())item{TextButton(onClick={selectProduct("")}){Text("查看最近购买")}}
        if(entries.isEmpty())item{EmptyState("没有找到价格记录")}
        if(product.isNotBlank()){
          entries.groupBy(::priceComparisonGroup).forEach{(group,rows)->
            item(key="group/$group"){Text(group,style=MaterialTheme.typography.titleSmall)}
            items(rows,key={it.getString("id")}){row->
              PriceBookRow(row,onSelect,onRecord,null,{edit=row},{refunds=row})
            }
          }
        }else{
          items(entries,key={it.getString("id")}){row->
            PriceBookRow(row,onSelect,onRecord,::selectProduct,{edit=row},{refunds=row})
          }
        }
        item{
          if(cursor!=null)TextButton(onClick={cursor=null}){Text("返回最新")}
          data.optJSONObject("next")?.let{next->TextButton(onClick={cursor=next.toString()}){Text("查看更早价格")}}
        }
      }
    }
  }
  edit?.let{row->PriceSpecEditor(accountId,row,{edit=null}){edit=null;cursor=null;retry++}}
  refunds?.let{row->ReturnCasesScreen(accountId,{refunds=null;retry++},onRecord,row)}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun PriceBookRow(
  row:JSONObject,onSelect:((JSONObject)->Unit)?,onRecord:(String)->Unit,
  onCompare:((String)->Unit)?,onEdit:()->Unit,onRefund:()->Unit
){
  LifeCard{
    val name=row.getString("product")
    val currency=row.getString("currency")
    Text(name,style=MaterialTheme.typography.titleMedium)
    if(name!=row.getString("raw_name"))Text(row.getString("raw_name"),style=MaterialTheme.typography.bodySmall)
    Text(listOfNotNull(row.getString("occurred_on"),row.optNullableString("merchant"),
      row.optNullableString("line_amount")?.let{"$it $currency"}).joinToString(" · "))
    if(onSelect!=null)TextButton(onClick={onSelect(row)}){Text("选择这条购买明细")}
    else{
      val reason=row.optNullableString("unavailable_reason")
      Text(when{
        !row.isNull("unit_price")->"${row.getString("unit_price")} $currency/${row.getString("base_unit")} · ${priceBasisLabel(row)}"
        reason=="unallocated_refund"->"退款待分配"
        reason=="missing_spec"->"缺少可换算的规格"
        reason=="missing_line_amount"->"未记录购买行金额"
        reason=="deductions_exceed_amount"->"优惠与退款合计超出行金额"
        else->"暂无可比行价"
      })
      FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        if(onCompare!=null)TextButton(onClick={onCompare(name)}){Text("比较同款")}
        TextButton(onClick={onRecord(row.getString("record_id"))}){Text("打开购买记录")}
        if(reason=="unallocated_refund")TextButton(onClick=onRefund){Text("查看退款")}
        if(reason=="missing_spec"||reason=="deductions_exceed_amount"||
          (reason==null&&row.isNull("unit_price")&&(row.isNull("unit")||row.isNull("pack_size")))){
          TextButton(onClick=onEdit){Text(if(reason=="deductions_exceed_amount")"核对规格与口径" else "补规格")}
        }
      }
    }
  }
}

private fun priceComparisonGroup(row:JSONObject):String=
  if(row.isNull("unit_price"))"暂无可比行价"
  else "${row.getString("currency")}/${row.getString("base_unit")} · ${priceBasisLabel(row)}"

private fun priceBasisLabel(row:JSONObject):String=
  if(row.getString("price_basis")=="paid")"实付行价" else "行标价扣已分配优惠"

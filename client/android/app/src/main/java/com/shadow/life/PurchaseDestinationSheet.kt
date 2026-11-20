package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun PurchaseDestinationSheet(
  accountId:String,line:PurchaseLineRef,onDismiss:()->Unit,onOpen:(String,String)->Unit
){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var destination by rememberSaveable(line.id){mutableStateOf("")}
  var quantity by rememberSaveable(line.id){mutableStateOf(line.quantity.orEmpty())}
  var unit by rememberSaveable(line.id){mutableStateOf(line.unit.orEmpty())}
  var expires by rememberSaveable(line.id){mutableStateOf("")}
  var command by rememberSaveable(line.id){mutableStateOf<String?>(null)}
  var resultId by rememberSaveable(line.id){mutableStateOf<String?>(null)}
  var error by rememberSaveable(line.id){mutableStateOf<String?>(null)}
  var sending by remember{mutableStateOf(false)}
  val choices=listOf("owned_item" to "持有物品","use_cycle" to "消耗品","food_stock_lot" to "食材批次")
  val busy=sending||command!=null
  val suitableQuantity=quantity.trim().toBigDecimalOrNull()?.stripTrailingZeros()?.takeIf{it.signum()>0&&it.scale()<=6&&it.precision()-it.scale()<=18}
  LaunchedEffect(accountId,command){
    val id=command?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    val (status,receipt)=app.database.commands().observeCommandState(accountId,session.subjectId,id)
      .combine(app.queue.observeStatus(session)){state,summary->state to summary.committedReceipts.firstOrNull{it.commandId==id}}
      .first{(state,receipt)->(state=="committed"&&receipt!=null)||state in setOf("blocked","failed")||state==null}
    if(status=="committed"){
      resultId=receipt?.resources?.firstOrNull{it.type==destination}?.id
      if(resultId==null)error="已同步，可以到对应工作区查看"
    }else error="暂未同步，请在同步设置查看该操作"
    command=null
  }
  ModalBottomSheet(onDismissRequest={if(!sending)onDismiss()}){
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
      Text(line.name,style=MaterialTheme.typography.titleLarge)
      Text("购买于 ${line.occurredOn}",style=MaterialTheme.typography.bodySmall)
      if(resultId!=null){
        Button(onClick={onOpen(destination,resultId!!);onDismiss()}){Text("打开关联的${choices.toMap()[destination]}")}
      }else{
        LifeChoiceField("转入",destination,choices){if(!busy){destination=it;error=null}}
        if(destination=="food_stock_lot"||destination=="use_cycle"){
          OutlinedTextField(quantity,{quantity=it},Modifier.fillMaxWidth(),label={Text("实际数量")},enabled=!busy,
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
          OutlinedTextField(unit,{unit=it},Modifier.fillMaxWidth(),label={Text("单位")},enabled=!busy)
        }
        if(destination=="food_stock_lot")LifeOptionalDateField(expires,{expires=it},"到期日期（可选）")
        val valid=destination=="owned_item"||destination!=""&&suitableQuantity!=null&&unit.isNotBlank()
        Button(enabled=valid&&!busy,onClick={
          if(sending||command!=null)return@Button
          val method=destination
          val normalized=suitableQuantity?.toPlainString()
          val payload=JSONObject().put("purchase_item_id",line.id)
          val capability=when(method){
            "owned_item"->{
              payload.put("name",line.name).put("ownership_state","owned").put("started_on",line.occurredOn).put("reuse_purchase_link",true)
              "life.save_owned_item"
            }
            "use_cycle"->{
              payload.put("purchase_record_id",line.recordId).put("item_name",line.name).put("started_on",LocalDate.now().toString())
                .put("state","active").put("time_zone",ZoneId.systemDefault().id).put("usage_state","pending")
                .put("initial_quantity",normalized).put("reuse_purchase_link",true)
              val unitName=unit.trim()
              payload.put("quantity_unit",if(unitName in setOf("g","ml"))unitName else "count")
              if(unitName !in setOf("g","ml"))payload.put("quantity_label",unitName.take(16))
              "money.set_use_cycle"
            }
            else->{
              payload.put("name",line.name).put("quantity",normalized).put("unit",unit.trim())
              expires.takeIf(String::isNotBlank)?.let{payload.put("expires_on",it)}
              "life.set_food_stock"
            }
          }
          sending=true;error=null
          scope.launch{
            try{command=repository.captureWrite(capability,payload,accountId).commandId}
            catch(failure:CancellationException){throw failure}
            catch(failure:Exception){error=failure.message?:"无法保存关联"}
            finally{sending=false}
          }
        }){Text(if(command!=null)"已存本机，待同步" else if(sending)"正在保存" else "关联或建立记录")}
      }
      error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    }
  }
}

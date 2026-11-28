package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.ZoneId
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeForeignMoney(accountId:String,refreshKey:Any,onRecord:(String)->Unit,onTrip:(String)->Unit){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val loaded=rememberLifeRead(accountId,refreshKey){repository.foreignMoney()}
  val scope=rememberCoroutineScope()
  var saving by remember(accountId){mutableStateOf(false)}
  var feedback by remember(accountId){mutableStateOf("")}
  var failed by remember(accountId){mutableStateOf(false)}
  var editing by rememberSaveable(accountId){mutableStateOf(false)}
  var settling by rememberSaveable(accountId){mutableStateOf<String?>(null)}
  fun write(capability:String,input:JSONObject,onCommitted:()->Unit={}){
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return
    if(saving)return
    saving=true;failed=false;feedback="正在保存"
    scope.launch{
      try{
        val receipt=repository.captureWrite(capability,input,accountId)
        feedback="已保存本机，待同步"
        val state=app.database.commands().observeCommandState(accountId,session.subjectId,receipt.commandId)
          .first{it in setOf("committed","failed","blocked")}
        check(state=="committed"){"未完成同步，请查看同步设置"}
        feedback="已同步";onCommitted();loaded.retry()
      }catch(error:CancellationException){throw error}
      catch(error:Exception){failed=true;feedback=error.message?:"保存失败"}
      finally{saving=false}
    }
  }
  val entries=(loaded.state as? LoadState.Ready)?.value?.items.orEmpty()
  LazyColumn(verticalArrangement=Arrangement.spacedBy(12.dp),contentPadding=PaddingValues(vertical=12.dp)){
    item{
      StateContent(loaded.state,loaded.retry){model->
        TextButton(enabled=!saving,onClick={editing=!editing}){Text(if(editing)"收起录入" else "记录外币款项")}
        if(editing)ForeignEntryForm(saving){write("money.record_foreign_entry",it){editing=false}}
        if(feedback.isNotBlank())Text(feedback,color=if(failed)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        if(model.items.isEmpty())Text("还没有外币记录")
        else Text("最近 ${model.items.size} 笔外币记录",style=MaterialTheme.typography.bodySmall)
      }
    }
    items(entries,key={it.id}){entry->
        LifeCard{
          Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
            Text(entry.counterparty?:when(entry.entryType.wireValue){"income"->"外币收入";"refund"->"外币退款";else->"外币支出"},Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
            Text("${entry.currency} ${foreignAmountText(entry.amount,entry.sourceScale.toInt())}",style=MaterialTheme.typography.titleLarge)
          }
          Text(entry.occurredOn)
          entry.settlement?.let{Text("实结 CNY ${displayDecimal(it.amount)} · ${it.settledOn}")}
          if(entry.baseAmount!=null)Text("参考换算 ${entry.baseCurrency} ${displayDecimal(entry.baseAmount.orEmpty())}",style=MaterialTheme.typography.bodySmall)
          if(entry.currency!="CNY"&&entry.settlement==null){
            Text("待结算")
            if(settling==entry.id){
              ForeignSettlementForm(saving,entry.occurredOn){
                write("money.settle_foreign_entry",it.put("money_entry_id",entry.id).put("expected_revision",entry.revision)){settling=null}
              }
            }
            TextButton(enabled=!saving,onClick={settling=if(settling==entry.id)null else entry.id}){
              Text(if(settling==entry.id)"取消" else "补实际结算")
            }
          }
          FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick={onRecord(entry.recordId)}){Text("查看原币流水")}
            entry.tripId?.let{TextButton(onClick={onTrip(it)}){Text("关联旅程")}}
          }
          entry.allocations.forEach{allocation->
            HorizontalDivider()
            val state=allocation.state.wireValue
            val label=when(state){"settled"->"已结清";"waived"->"已免除";else->"待结清"}
            Text("${allocation.participantLabel} · ${entry.currency} ${displayDecimal(allocation.originalAmount)} · $label")
            if(state=="unsettled")FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
              val choices=listOf("settled" to "标为已结清","waived" to "免除")
              choices.forEach{(target,title)->TextButton(enabled=!saving,onClick={
                val payload=JSONObject().put("allocation_id",allocation.id).put("expected_revision",allocation.revision).put("state",target)
                if(target=="settled")payload.put("settled_on",LocalDate.now().toString())
                write("money.update_shared_allocation",payload)
              }){Text(title)}}
            }
          }
        }
    }
  }
}

internal fun quoteInstant(local:ZonedDateTime,date:LocalDate,time:LocalTime):Instant?{
  val requested=date.atTime(time)
  val offsets=local.zone.rules.getValidOffsets(requested)
  val offset=local.offset.takeIf{it in offsets} ?: offsets.firstOrNull() ?: return null
  return requested.toInstant(offset)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun QuoteTimeField(instant:Instant,zone:ZoneId,enabled:Boolean,onChange:(Instant)->Unit){
  val local=instant.atZone(zone)
  var pickingTime by rememberSaveable{mutableStateOf(false)}
  var timeError by rememberSaveable{mutableStateOf(false)}
  fun update(date:LocalDate,time:LocalTime){
    val value=quoteInstant(local,date,time)
    timeError=value==null
    if(value!=null)onChange(value)
  }
  LifeDateField(local.toLocalDate().toString(),{update(LocalDate.parse(it),local.toLocalTime())},"报价日期",enabled)
  OutlinedButton(onClick={pickingTime=true},enabled=enabled,modifier=Modifier.fillMaxWidth()){
    Text("报价时间",Modifier.weight(1f))
    Text(local.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))+" · "+zone.id)
  }
  if(timeError)Text("该时刻因夏令时跳过，当前仍使用上方显示的报价时间。",color=MaterialTheme.colorScheme.error)
  if(pickingTime){
    val picker=rememberTimePickerState(local.hour,local.minute,is24Hour=true)
    AlertDialog(onDismissRequest={pickingTime=false},title={Text("报价时间")},text={TimeInput(picker)},
      confirmButton={TextButton(enabled=enabled,onClick={
        update(local.toLocalDate(),LocalTime.of(picker.hour,picker.minute))
        pickingTime=false
      }){Text("确定")}},dismissButton={TextButton(onClick={pickingTime=false}){Text("取消")}})
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ForeignEntryForm(busy:Boolean,onSave:(JSONObject)->Unit){
  var type by rememberSaveable{mutableStateOf("expense")}
  var amount by rememberSaveable{mutableStateOf("")}
  var currency by rememberSaveable{mutableStateOf("")}
  var date by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  var counterparty by rememberSaveable{mutableStateOf("")}
  var converted by rememberSaveable{mutableStateOf("")}
  var rate by rememberSaveable{mutableStateOf("")}
  var quotedAt by rememberSaveable{mutableStateOf(Instant.now().toString())}
  var person by rememberSaveable{mutableStateOf("")}
  var share by rememberSaveable{mutableStateOf("")}
  var allocations by rememberSaveable{mutableStateOf(arrayListOf<String>())}
  var error by rememberSaveable{mutableStateOf("")}
  val zone=ZoneId.systemDefault()
  LifeCard{
    LifeChoiceField("类型",type,listOf("expense" to "支出","income" to "收入")){type=it}
    MoneyDecimalField("原币金额",amount,{amount=it})
    OutlinedTextField(currency,{currency=it.take(3).uppercase(Locale.ROOT)},Modifier.fillMaxWidth(),label={Text("原币币种，如 JPY")},singleLine=true)
    LifeDateField(date,{date=it},"发生日")
    OutlinedTextField(counterparty,{counterparty=it.take(200)},Modifier.fillMaxWidth(),label={Text("交易对方")},singleLine=true)
    Text("参考换算（可选）",style=MaterialTheme.typography.titleMedium)
    MoneyDecimalField("人民币金额",converted,{converted=it})
    MoneyDecimalField("汇率（CNY / 原币）",rate,{rate=it})
    if(converted.isNotBlank() || rate.isNotBlank())QuoteTimeField(Instant.parse(quotedAt),zone,!busy){quotedAt=it.toString()}
    if(type=="expense"){
      Text("共同份额",style=MaterialTheme.typography.titleMedium)
      allocations.forEachIndexed{index,json->
        val row=JSONObject(json)
        Row(verticalAlignment=Alignment.CenterVertically){
          Text("${row.getString("participant_label")} · ${row.getString("original_amount")}",Modifier.weight(1f))
          TextButton(enabled=!busy,onClick={allocations=ArrayList(allocations.filterIndexed{i,_->i!=index})}){Text("移除")}
        }
      }
      if(allocations.size<20){
        OutlinedTextField(person,{person=it.take(100)},Modifier.fillMaxWidth(),label={Text("参与者")},singleLine=true)
        MoneyDecimalField("承担额（原币）",share,{share=it})
        TextButton(enabled=!busy&&person.isNotBlank()&&share.isNotBlank(),onClick={
          runCatching{
            val name=person.trim()
            require(allocations.none{JSONObject(it).getString("participant_label").equals(name,true)}){"该参与者已添加"}
            val value=foreignPositive(share,6)
            allocations=ArrayList(allocations+JSONObject().put("participant_label",name).put("original_amount",value).put("state","unsettled").toString())
            person="";share="";error=""
          }.onFailure{error=it.message?:"无法添加份额"}
        }){Text("加入共同份额")}
      }
    }
    if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
    Button(enabled=!busy,onClick={
      runCatching{
        val code=currency.trim().uppercase(Locale.ROOT)
        require(Regex("[A-Z]{3}").matches(code)&&code!="CNY"){"请选择与人民币不同的三位币种代码"}
        val original=foreignPositive(amount,6)
        require(runCatching{LocalDate.parse(date)}.isSuccess){"请选择发生日"}
        val conversion=if(converted.isBlank()&&rate.isBlank())null else {
          val base=foreignPositive(converted,6)
          val observedRate=foreignPositive(rate,12)
          require((original.toBigDecimal()*observedRate.toBigDecimal()-base.toBigDecimal()).abs()<=java.math.BigDecimal("0.000001")){"人民币金额与原币金额、汇率不一致"}
          val quote=runCatching{Instant.parse(quotedAt.trim())}.getOrElse{error("请输入带时区的有效报价时刻")}
          JSONObject().put("base_amount",base).put("base_currency","CNY")
            .put("rate",observedRate).put("quoted_at",quote.toString()).put("source_kind","manual")
        }
        val rows=if(type=="expense")allocations.map{JSONObject(it)} else emptyList()
        require(type!="expense"||(person.isBlank()&&share.isBlank())){"请先加入刚填写的共同份额"}
        require(rows.fold(java.math.BigDecimal.ZERO){sum,item->sum+item.getString("original_amount").toBigDecimal()}<=original.toBigDecimal()){"份额合计超过原币金额"}
        JSONObject().put("entry_type",type).put("amount",original).put("currency",code)
          .put("source_scale",original.substringAfter('.', "").length).put("occurred_on",date).put("time_zone",zone.id)
          .put("allocations",JSONArray(rows)).apply{
            if(conversion!=null)put("conversion",conversion)
            if(counterparty.isNotBlank())put("counterparty",counterparty.trim())
          }
      }.onSuccess{error="";onSave(it)}.onFailure{error=it.message?:"请检查金额和报价"}
    }){Text("保存外币款项")}
  }
}

@Composable private fun ForeignSettlementForm(busy:Boolean,occurredOn:String,onSave:(JSONObject)->Unit){
  var amount by rememberSaveable{mutableStateOf("")}
  var date by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  var error by rememberSaveable{mutableStateOf("")}
  MoneyDecimalField("实际结算金额（CNY）",amount,{amount=it})
  LifeDateField(date,{date=it},"结算日")
  if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
  Button(enabled=!busy,onClick={
    runCatching{
      val actual=foreignPositive(amount,2).toBigDecimal().setScale(2).toPlainString()
      require(runCatching{LocalDate.parse(date)>=LocalDate.parse(occurredOn)}.getOrDefault(false)){"结算日须为交易日或之后"}
      JSONObject().put("amount",actual).put("settled_on",date)
    }.onSuccess{error="";onSave(it)}.onFailure{error=it.message?:"请核对银行账单"}
  }){Text("保存结算")}
}

@Composable private fun MoneyDecimalField(label:String,value:String,onValue:(String)->Unit){
  OutlinedTextField(value,onValue,Modifier.fillMaxWidth(),label={Text(label)},singleLine=true,
    keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
}

private fun foreignPositive(value:String,precision:Int):String{
  val trimmed=value.trim()
  require(Regex("(?:0|[1-9][0-9]{0,17})(?:[.][0-9]{1,$precision})?").matches(trimmed)&&trimmed.toBigDecimal().signum()>0){"请输入有效的正数金额或汇率"}
  return trimmed
}
private fun foreignAmountText(value:String,scale:Int):String =
  value.toBigDecimalOrNull()?.let{amount->amount.setScale(maxOf(scale,amount.stripTrailingZeros().scale())).toPlainString()}?:value

package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import org.json.JSONObject

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun PriceSpecEditor(accountId:String,row:JSONObject,onBack:()->Unit,onSaved:()->Unit){
  key(row.getString("id")){
    var name by rememberSaveable{mutableStateOf(row.getString("product"))}
    var count by rememberSaveable{mutableStateOf(row.getString("pack_count"))}
    var size by rememberSaveable{mutableStateOf(row.optNullableString("pack_size").orEmpty())}
    var unit by rememberSaveable{mutableStateOf(row.optNullableString("unit").orEmpty())}
    var basis by rememberSaveable{mutableStateOf(row.getString("price_basis"))}
    var discount by rememberSaveable{mutableStateOf(row.getString("discount"))}
    val decimal=KeyboardOptions(keyboardType=KeyboardType.Decimal)
    RecordWriteScreen(accountId,"规格与计价","life.set_price_spec",onBack,onSaved){enabled,save->
      OutlinedTextField(name,{name=it.take(200)},Modifier.fillMaxWidth(),label={Text("同款名称")},enabled=enabled,singleLine=true)
      OutlinedTextField(count,{count=it},Modifier.fillMaxWidth(),label={Text("购买份数")},enabled=enabled,keyboardOptions=decimal)
      OutlinedTextField(size,{size=it},Modifier.fillMaxWidth(),label={Text("每份净含量")},enabled=enabled,keyboardOptions=decimal)
      FlowRow{
        listOf("g","kg","ml","L","件").forEach{value->
          FilterChip(unit==value,{unit=value},enabled=enabled,label={Text(value)})
        }
      }
      FlowRow{
        FilterChip(basis=="listed",{basis="listed"},enabled=enabled,label={Text("行标价")})
        FilterChip(basis=="paid",{basis="paid"},enabled=enabled,label={Text("实付行价")})
      }
      if(basis=="listed")OutlinedTextField(discount,{discount=it},Modifier.fillMaxWidth(),
        label={Text("可归属本行的优惠")},enabled=enabled,keyboardOptions=decimal)
      Button(enabled=enabled&&name.isNotBlank()&&unit.isNotBlank()&&pricePackNumber(count)&&pricePackNumber(size),onClick={
        save{
          JSONObject().put("purchase_item_id",row.getString("id")).put("product",name.trim())
            .put("pack_count",count.trim()).put("pack_size",size.trim()).put("unit",unit).put("price_basis",basis)
            .put("discount",if(basis=="paid")"0" else discount.trim().ifEmpty{"0"})
            .apply{if(!row.isNull("revision"))put("expected_revision",row.getInt("revision"))}
        }
      }){Text("保存规格")}
    }
  }
}

private fun pricePackNumber(value:String):Boolean=
  value.trim().matches(Regex("(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?"))&&value.toBigDecimalOrNull()?.signum()==1

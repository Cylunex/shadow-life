package com.shadow.life

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val statsScopeLabels=listOf("" to "全部场景","restaurant_delivery" to "餐饮外卖","grocery_delivery" to "商超到家","dine_in" to "到店餐饮","physical_retail" to "线下零售","drink_snack" to "饮品零食","unknown" to "待识别")
private val statsCategoryLabels=listOf("" to "全部品类","dish" to "菜品","staple" to "主食","snack" to "零食","beverage" to "饮品","fresh_food" to "生鲜","daily_goods" to "日用品","unknown" to "待识别")

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ConsumptionStatsScreen(state:LoadState<ConsumptionStatsResultDto>,onLoad:(Int,String?,String?,String,String)->Unit,onBack:()->Unit){
  var months by rememberSaveable{mutableIntStateOf(3)};var scope by rememberSaveable{mutableStateOf("")};var category by rememberSaveable{mutableStateOf("")};var merchantRank by rememberSaveable{mutableStateOf("orders")};var itemRank by rememberSaveable{mutableStateOf("purchased_orders")}
  fun reload(nextMonths:Int=months,nextScope:String=scope,nextCategory:String=category,nextMerchant:String=merchantRank,nextItem:String=itemRank){onLoad(nextMonths,nextScope.ifBlank{null},nextCategory.ifBlank{null},nextMerchant,nextItem)}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Column{Text("消费统计");Text("订单、食用与金额独立计数",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
      item{StatsSurface{Text("统计范围",style=MaterialTheme.typography.titleLarge);Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf(1,3,6,12).forEach{value->FilterChip(months==value,{months=value;reload(nextMonths=value)},{Text("$value 个月")})}};StatsSelector("场景",scope,statsScopeLabels){scope=it;reload(nextScope=it)};StatsSelector("品类",category,statsCategoryLabels){category=it;reload(nextCategory=it)}}}
      when(state){LoadState.Loading->item{LinearProgressIndicator(Modifier.fillMaxWidth())};is LoadState.Empty->item{Text(state.reason,color=MaterialTheme.colorScheme.onSurfaceVariant)};is LoadState.Failed->item{StatsSurface{Text(state.message,color=MaterialTheme.colorScheme.error);TextButton(onClick={reload()}){Text("重试")}}};is LoadState.Ready->{val value=state.value
        item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){StatsMetric("订单",value.coverage.orders.toString(),Modifier.weight(1f));StatsMetric("关联饮食",value.coverage.mealLinkedOrders.toString(),Modifier.weight(1f));StatsMetric("场景覆盖",percent(value.coverage.orders-value.coverage.scopeUnknown,value.coverage.orders),Modifier.weight(1f))}}
        item{StatsSurface{Text("月度趋势",style=MaterialTheme.typography.titleLarge);val max=value.monthly.maxOfOrNull{it.orders}?.coerceAtLeast(1)?:1;value.monthly.forEach{month->Column(verticalArrangement=Arrangement.spacedBy(4.dp)){Row(Modifier.fillMaxWidth()){Text(month.month,Modifier.weight(1f));Text("${month.orders} 单")};LinearProgressIndicator({month.orders.toFloat()/max.toFloat()},Modifier.fillMaxWidth());Text(month.spend.firstOrNull{it.currency=="CNY"}?.let{"净额 ${it.net} CNY"}?:"金额不可用",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}
        item{StatsRankingControls("常去商家",merchantRank,listOf("orders" to "订单数","gross_spend" to "消费总额","net_spend" to "退款后净额")){merchantRank=it;reload(nextMerchant=it)}}
        items(value.merchants,key={"${it.canonicalName}:${it.scope.wireValue}"}){merchant->StatsRankRow(merchant.canonicalName,"${statsScopeLabels.toMap()[merchant.scope.wireValue]?:merchant.scope.wireValue} · ${merchant.orders} 单 · ${merchant.confirmedMeals} 次食用",if(merchantRank=="orders")merchant.orders.toString() else merchant.spend.firstOrNull{it.currency=="CNY"}?.let{if(merchantRank=="gross_spend")it.gross else it.net}?:"—")}
        item{StatsRankingControls("常买商品 / 菜品",itemRank,listOf("purchased_orders" to "购买订单","confirmed_consumptions" to "确认食用","line_spend" to "商品金额")){itemRank=it;reload(nextItem=it)}}
        items(value.items,key={"${it.canonicalName}:${it.category.wireValue}"}){product->StatsRankRow(product.canonicalName,"${statsCategoryLabels.toMap()[product.category.wireValue]?:product.category.wireValue} · ${product.purchasedOrders} 单购买 · ${product.confirmedConsumptions} 次食用",when(itemRank){"confirmed_consumptions"->product.confirmedConsumptions.toString();"line_spend"->product.lineSpend.firstOrNull{it.currency=="CNY"}?.amount?:"—";else->product.purchasedOrders.toString()})}
        item{StatsSurface{Text("数据覆盖",style=MaterialTheme.typography.titleLarge);Text("商品行 ${value.coverage.includedItemLines}/${value.coverage.itemLines} · 排除服务 ${value.coverage.excludedServiceLines} · 折叠摘要 ${value.coverage.excludedFoldedLines}");Text("明细不完整 ${value.coverage.foldedOrders} 单 · 已补录 ${value.coverage.supplementedOrders} 单",color=MaterialTheme.colorScheme.error);Text("明确分类 ${value.coverage.itemCategoryExplicit} · 规则推断 ${value.coverage.itemCategoryDerived} · 待识别 ${value.coverage.itemCategoryUnknown}",color=MaterialTheme.colorScheme.onSurfaceVariant);Text("只纳入已确认且未作废的事实；退款归回原订单月份，币种与购买/食用数量不混算。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant);if(!value.coverage.moneyAuthorized)Text("没有账目读取权限，金额不会按零展示。",color=MaterialTheme.colorScheme.error);if(value.unknowns.merchants.isNotEmpty()||value.unknowns.items.isNotEmpty())Text("待识别："+(value.unknowns.merchants.map{it.name}+value.unknowns.items.map{it.name}).distinct().take(10).joinToString("、"),style=MaterialTheme.typography.bodySmall)}}
      }}
    }
  }
}

@Composable private fun StatsSelector(label:String,value:String,options:List<Pair<String,String>>,onChange:(String)->Unit){var open by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={open=true},Modifier.fillMaxWidth()){Text("$label：${options.toMap()[value]?:value}")};DropdownMenu(open,{open=false}){options.forEach{(key,text)->DropdownMenuItem({Text(text)},{open=false;onChange(key)})}}}}
@Composable private fun StatsRankingControls(title:String,value:String,options:List<Pair<String,String>>,onChange:(String)->Unit){StatsSurface{Text(title,style=MaterialTheme.typography.titleLarge);Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){options.forEach{(key,label)->FilterChip(value==key,{onChange(key)},{Text(label)})}}}}
@Composable private fun StatsMetric(label:String,value:String,modifier:Modifier){Surface(modifier,shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.55f)){Column(Modifier.padding(14.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(value,style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.SemiBold)}}}
@Composable private fun StatsRankRow(name:String,subtitle:String,value:String){StatsSurface{Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(name,style=MaterialTheme.typography.titleMedium);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(value,fontWeight=FontWeight.SemiBold)}}}
@Composable private fun StatsSurface(content:@Composable ColumnScope.()->Unit){Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.48f)){Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(10.dp),content=content)}}
private fun percent(known:Long,total:Long)=if(total==0L)"100%" else "${known*100/total}%"

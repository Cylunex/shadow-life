package com.shadow.life

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

private val groups=mapOf("vegetables" to "蔬菜","fruit" to "水果","dairy" to "奶类","soy" to "豆类","whole_grains" to "全谷物")
private val nutrients=mapOf("energy_kcal" to "热量（kcal）","protein_g" to "蛋白质（g）","fat_g" to "脂肪（g）","carb_g" to "碳水（g）",
    "fiber_g" to "纤维（g）","sodium_mg" to "钠（mg）","calcium_mg" to "钙（mg）","iron_mg" to "铁（mg）")
private val decimal=Regex("(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,6})?")
private val menuJson=Json { explicitNulls=false }

private val catalogTabs=listOf("门店","常吃","外卖")
private data class DishEdit(
    val merchant:String,
    val row:MerchantMenuResultDtoItemsEntry?=null,
    val dish:String="",
    val source:String=""
)

@Composable internal fun DishCatalogEntry(onOpen:()->Unit) {
    LifeCard(onClick=onOpen) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Icon(moduleIcon(LifeModule.Meals),contentDescription=null,tint=MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)) {
                Text("菜品与门店",style=MaterialTheme.typography.titleMedium)
                Text("食堂菜单、外卖订单与常吃菜品",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,contentDescription=null)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun DishCatalogScreen(
    accountId:String,initialMerchant:String,initialQuery:String,onBack:()->Unit,onLink:(DetailLink)->Unit
) {
    val context=LocalContext.current
    val app=context.applicationContext as ShadowApp
    val repository=remember(accountId){NativeLifeRepository(context,app)}
    val scope=rememberCoroutineScope()
    var tab by rememberSaveable(initialMerchant){mutableIntStateOf(0)}
    var merchant by rememberSaveable(initialMerchant){mutableStateOf(initialMerchant)}
    var shopSearch by rememberSaveable{mutableStateOf("")}
    var query by rememberSaveable(initialQuery){mutableStateOf(initialQuery)}
    var appliedQuery by rememberSaveable(initialQuery){mutableStateOf(initialQuery)}
    var overview by remember(accountId){mutableStateOf<LoadState<MerchantMenuResultDtoDirectory>>(LoadState.Loading)}
    var storeOrders by remember(accountId,merchant){mutableStateOf<LoadState<List<MerchantMenuResultDtoDirectoryTakeoutEntry>>>(LoadState.Loading)}
    var retryOrders by remember(accountId,merchant){mutableIntStateOf(0)}
    var menu by remember(accountId,merchant,appliedQuery){mutableStateOf<MerchantMenuResultDto?>(null)}
    var error by remember(accountId,merchant,appliedQuery){mutableStateOf<String?>(null)}
    var message by rememberSaveable(accountId){mutableStateOf<String?>(null)}
    var loading by remember(accountId,merchant,appliedQuery){mutableStateOf(false)}
    var pageCursor by remember(accountId,merchant,appliedQuery){mutableStateOf<String?>(null)}
    var revision by remember{mutableIntStateOf(0)}
    var refreshDirectory by remember{mutableIntStateOf(0)}
    var dish by remember(accountId,merchant){mutableStateOf<MerchantMenuResultDtoItemsEntry?>(null)}
    var edit by remember(accountId){mutableStateOf<DishEdit?>(null)}
    var recording by remember(accountId){mutableStateOf<MerchantMenuResultDtoItemsEntry?>(null)}
    var saveError by remember(accountId){mutableStateOf<String?>(null)}
    var saving by remember(accountId){mutableStateOf(false)}
    var pending by rememberSaveable(accountId){mutableStateOf(arrayListOf<String>())}
    val keyboard=LocalSoftwareKeyboardController.current

    fun openShop(name:String) {
        if(!validMerchantName(name))return
        tab=0;merchant=name;query="";appliedQuery="";message=null
    }
    fun startEdit(request:DishEdit){edit=request;saveError=null}
    fun back() {
        if(merchant.isBlank()||initialMerchant.isNotBlank())onBack()
        else {merchant="";query="";appliedQuery="";message=null}
    }

    suspend fun loadMenu(name:String,search:String,after:String?=null) {
        loading=true;error=null
        try {
            val page=repository.canteenProfiles(name,search,after)
            check(app.sessions.active()?.accountId==accountId){"账号已切换"}
            val entries=if(after==null)page.items else (menu?.items.orEmpty()+page.items).distinctBy{it.id}
            menu=page.copy(items=entries)
        } catch(cancel:CancellationException){throw cancel}
        catch(failure:Exception){error=failure.message ?: "菜品暂时无法读取"}
        finally{loading=false}
    }
    LaunchedEffect(accountId,refreshDirectory) {
        overview=LoadState.Loading
        try {
            val directory=repository.diningDirectory()
            check(app.sessions.active()?.accountId==accountId){"账号已切换"}
            overview=LoadState.Ready(directory)
        } catch(cancel:CancellationException){throw cancel}
        catch(failure:Exception){overview=LoadState.Failed(failure.message ?: "门店暂时无法读取")}
    }
    LaunchedEffect(accountId,merchant,appliedQuery,revision,pageCursor) {
        if(merchant.isNotBlank())loadMenu(merchant,appliedQuery,pageCursor)
    }
    LaunchedEffect(accountId,merchant,retryOrders) {
        if(merchant.isNotBlank()){
            storeOrders=LoadState.Loading
            try{
                val orders=repository.diningDirectory(merchant).takeout
                check(app.sessions.active()?.accountId==accountId){"账号已切换"}
                storeOrders=LoadState.Ready(orders)
            } catch(cancel:CancellationException){throw cancel}
            catch(failure:Exception){storeOrders=LoadState.Failed(failure.message ?: "外卖订单暂时无法读取")}
        }
    }
    LaunchedEffect(accountId,pending) {
        val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
        pending.forEach { id->
            launch {
                val state=app.database.commands().observeCommandState(accountId,session.subjectId,id)
                    .first{it=="committed"||it=="failed"||it=="blocked"}
                pending=ArrayList(pending-id)
                if(state=="committed"){
                    message="已同步";pageCursor=null;revision++;refreshDirectory++
                } else message="同步失败，可在同步队列查看"
            }
        }
    }
    if(merchant.isNotBlank())BackHandler(onBack=::back)
    val directory=(overview as? LoadState.Ready)?.value
    Scaffold(
        topBar={TopAppBar(
            title={Text(merchant.ifBlank{"菜品与门店"},maxLines=1,overflow=TextOverflow.Ellipsis)},
            navigationIcon={LifeBackButton(::back)},
            actions={if(merchant.isNotBlank())TextButton(enabled=!loading,onClick={startEdit(DishEdit(merchant))}){Text("收录菜品")}}
        )}
    ){padding->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            if(merchant.isBlank())PrimaryTabRow(tab) {
                catalogTabs.forEachIndexed{index,label->Tab(tab==index,{tab=index},text={Text(label)})}
            }
            key(tab,merchant) {
                LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    message?.let{item{Text(it,color=MaterialTheme.colorScheme.primary)}}
                    if(merchant.isNotBlank()) {
                        item {
                            CatalogSearch(query,{query=it},"菜名或别名") {
                                keyboard?.hide()
                                pageCursor=null
                                if(appliedQuery==query.trim())revision++ else appliedQuery=query.trim()
                            }
                        }
                        if(loading)item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                        error?.let{failure->item{EmptyState(failure,"重试"){revision++}}}
                        menu?.let { page ->
                            item{Text("已收录菜品",style=MaterialTheme.typography.titleLarge)}
                            if(page.items.isEmpty())item{
                                EmptyState(if(appliedQuery.isBlank())"这家门店还没有收录菜品" else "没有匹配的已收录菜品")
                            }
                            items(page.items,key={"dish/${it.id}"}){row->CatalogDishRow(row){dish=row}}
                            page.next?.let { next->item{
                                OutlinedButton(enabled=!loading,onClick={pageCursor=next},modifier=Modifier.fillMaxWidth()){
                                    Text("加载更多菜品")
                                }
                            }}
                            if(appliedQuery.isBlank())page.stallPrices.orEmpty().takeIf { it.isNotEmpty() }?.let{prices->item{CatalogPrices(prices)}}
                        }
                        val orderState=storeOrders
                        if(orderState is LoadState.Failed)item{EmptyState(orderState.message,"重试读取外卖"){retryOrders++}}
                        val knownOrders=(orderState as? LoadState.Ready)?.value.orEmpty()
                        val ordered=knownOrders.flatMap{order->order.items.map{it to order}}.distinctBy{it.first.lowercase()}
                            .filter{appliedQuery.isBlank()||it.first.contains(appliedQuery,ignoreCase=true)}
                        if(ordered.isNotEmpty())item{Text("外卖订单里的菜品",style=MaterialTheme.typography.titleLarge)}
                        items(ordered,key={"ordered/${it.first}"}){(name,order)->
                            LifeCard{
                                Text(name,style=MaterialTheme.typography.titleMedium)
                                Row {
                                    TextButton(onClick={order.catalogLink()?.let(onLink)}){Text("查看 ${order.date} 订单")}
                                    if(menu!=null&&menu?.items.orEmpty().none{it.dish.equals(name,true)}&&validMerchantName(name))TextButton(
                                        onClick={startEdit(DishEdit(merchant,dish=name,source="${order.date} 的 ${order.merchant} 外卖订单"))}
                                    ){Text("收录")}
                                }
                            }
                        }
                        if(knownOrders.isNotEmpty()&&appliedQuery.isBlank())item{
                            Text("最近外卖订单",style=MaterialTheme.typography.titleLarge)
                        }
                        if(appliedQuery.isBlank())items(knownOrders,key={"order/${it.id}"}){order->
                            CatalogOrderRow(order,false,onOrder={order.catalogLink()?.let(onLink)})
                        }
                    } else {
                        if(tab==0)item{
                            CatalogSearch(shopSearch,{shopSearch=it},"搜索或输入门店名") {
                                keyboard?.hide()
                                if(validMerchantName(shopSearch.trim()))openShop(shopSearch.trim())
                            }
                        }
                        when(val state=overview) {
                            LoadState.Loading->item{LinearProgressIndicator(Modifier.fillMaxWidth())}
                            is LoadState.Failed->item{EmptyState(state.message,"重试"){refreshDirectory++}}
                            is LoadState.Empty->item{EmptyState(state.reason)}
                            is LoadState.Ready->Unit
                        }
                        directory?.let{catalogDirectoryItems(tab,it,shopSearch,::openShop,onLink)}
                    }
                }
            }
        }
    }

    dish?.let { selected ->
        if(edit==null&&recording==null)CatalogDishDetails(selected,{dish=null},onLink,
            {startEdit(DishEdit(merchant,selected))},{saveError=null;recording=selected})
    }
    edit?.let{request->
        LifeFullScreen(if(request.row==null)"收录菜品" else "编辑菜品",{if(!saving)edit=null}) {
            LazyColumn(verticalArrangement=Arrangement.spacedBy(12.dp),contentPadding=PaddingValues(bottom=16.dp)){
                item{CatalogSection(request.merchant,null)}
                item{
                    Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                        CanteenProfileEditor(request,saving,saveError,onCancel={edit=null}){name,stall,profile,evidence->
                            if(saving)return@CanteenProfileEditor
                            saving=true;saveError=null
                            scope.launch {
                                try {
                                    val body=JSONObject().put("merchant",request.merchant).put("dish",name)
                                        .put("evidence",evidence)
                                    if(profile.length()>0||request.row!=null)body.put("profile",profile)
                                    if(stall.isNotBlank())body.put("stall",stall)
                                    request.row?.let{body.put("food_id",it.id).put("expected_revision",it.revision)}
                                    val receipt=repository.captureWrite("life.remember_merchant_dish",body,accountId)
                                    if(receipt.queued)pending=ArrayList(pending+receipt.commandId)
                                    message=if(receipt.queued)"菜品已保存到本机，待同步" else "菜品已保存"
                                    edit=null;dish=null;pageCursor=null;revision++;refreshDirectory++
                                } catch(cancel:CancellationException){throw cancel}
                                catch(failure:Exception){saveError=failure.message ?: "菜品保存失败"}
                                finally{saving=false}
                            }
                        }
                    }
                }
            }
        }
    }
    recording?.let { row->
        CatalogRecordMeal(row,saving,saveError,{if(!saving)recording=null}){date,type,grams->
            if(saving)return@CatalogRecordMeal
            saving=true;saveError=null
            scope.launch {
                try {
                    val intake=JSONObject().put("name",row.dish).put("food_ref_id",row.id)
                    if(grams.isNotBlank())intake.put("amount_g",grams).put("estimate",true).put("evidence_note","本人填写本次估重")
                    val body=JSONObject().put("occurred_on",date).put("time_zone",ZoneId.systemDefault().id)
                        .put("meal_type",type).put("items",JSONArray().put(intake))
                    val receipt=repository.captureWrite("life.record_meal",body,accountId)
                    if(receipt.queued)pending=ArrayList(pending+receipt.commandId)
                    message=if(receipt.queued)"餐次已保存到本机，待同步" else "餐次已保存"
                    recording=null;dish=null;refreshDirectory++
                } catch(cancel:CancellationException){throw cancel}
                catch(failure:Exception){saveError=failure.message ?: "餐次保存失败"}
                finally{saving=false}
            }
        }
    }
}

internal fun LazyListScope.catalogDirectoryItems(
    tab:Int,directory:MerchantMenuResultDtoDirectory,shopSearch:String,onShop:(String)->Unit,onLink:(DetailLink)->Unit
){
    when(tab){
        0->{
            val names=(listOfNotNull(directory.defaultMerchant)+directory.merchants.map{it.name}+directory.takeout.map{it.merchant})
                .filter(::validMerchantName).distinctBy{it.lowercase()}.filter{it.contains(shopSearch.trim(),ignoreCase=true)}
            items(names,key={"shop/$it"}){name->
                val info=directory.merchants.firstOrNull{it.name.equals(name,true)}
                val orderCount=directory.takeout.count{it.merchant.equals(name,true)}
                val description=listOfNotNull(
                    "常去食堂".takeIf{name.equals(directory.defaultMerchant,true)},
                    info?.menuItems?.takeIf{it>0}?.let{"已收录 $it 道"},
                    "有外卖订单".takeIf{orderCount>0},
                    info?.meals?.takeIf{it>0}?.let{"实吃 $it 餐"}
                ).joinToString(" · ")
                CatalogRow(name,description){onShop(name)}
            }
            val exact=shopSearch.trim()
            if(validMerchantName(exact)&&names.none{it.equals(exact,true)})item{
                CatalogRow(exact,"打开门店"){onShop(exact)}
            }
            if(names.isEmpty()&&exact.isBlank())item{EmptyState("还没有可查看的门店，可输入门店名开始收录")}
        }
        1->{
            item{CatalogSection("近 30 天实吃记录","${directory.from} 至 ${directory.to}")}
            item{Text("常吃菜品",style=MaterialTheme.typography.titleLarge)}
            if(directory.dishes.isEmpty())item{EmptyState("还没有在两餐以上记到同一道菜")}
            items(directory.dishes,key={"frequent/${it.foodId ?: it.merchant.toString()+"/"+it.name}"}){row->
                CatalogRow(row.name,listOfNotNull(row.merchant,"${row.meals} 餐 · 查看最近一次").joinToString(" · ")){
                    onLink(DetailLink("meal",row.mealId,row.name))
                }
            }
            item{Text("常吃门店",style=MaterialTheme.typography.titleLarge)}
            val frequent=directory.merchants.filter{it.meals>1}.take(12)
            if(frequent.isEmpty())item{EmptyState("还没有在同一家门店记到两餐以上")}
            items(frequent,key={"frequent-shop/${it.name}"}){row->
                CatalogRow(row.name,"${row.meals} 餐"){onShop(row.name)}
            }
        }
        else->{
            item{CatalogSection("最近外卖","从订单与已识别截图提取")}
            if(directory.takeout.isEmpty())item { EmptyState("近 30 天没有可识别的餐饮外卖订单") }
            items(directory.takeout,key={"order/${it.id}"}){order->
                CatalogOrderRow(order,validMerchantName(order.merchant),
                    onShop={onShop(order.merchant)},onOrder={order.catalogLink()?.let(onLink)})
            }
        }
    }
}

private fun validMerchantName(name:String)=name.isNotBlank()&&name.length<=160&&name.none{it=='｜'||it=='|'||it.isISOControl()}

@Composable private fun CatalogSearch(value:String,onChange:(String)->Unit,label:String,onSearch:()->Unit){
    OutlinedTextField(value,{onChange(it.take(160))},Modifier.fillMaxWidth(),singleLine=true,label={Text(label)},
        leadingIcon={Icon(Icons.Default.Search,contentDescription=null)},
        trailingIcon={IconButton(onClick=onSearch){Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,"搜索")}},
        keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={onSearch()}))
}

@Composable private fun CatalogSection(title:String,subtitle:String?) {
    Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
        Text(title,style=MaterialTheme.typography.titleLarge)
        subtitle?.let { Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable private fun CatalogRow(title:String,subtitle:String,onClick:()->Unit) {
    LifeCard(onClick=onClick){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
                Text(title,style=MaterialTheme.typography.titleMedium)
                if(subtitle.isNotBlank())Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,contentDescription=null)
        }
    }
}

private fun catalogPortion(row:MerchantMenuResultDtoItemsEntry):String? {
    val portion=row.profile?.portion
    if(portion!=null)return listOfNotNull("${portion.quantity} ${portion.unit}",portion.grams?.let{"$it g"}).joinToString(" · ")+
        if(portion.estimated)" · 估算" else ""
    return row.servingAmount?.let{"${displayDecimal(it)} ${row.servingUnit.orEmpty()}".trim()}
}

@Composable private fun CatalogDishRow(row:MerchantMenuResultDtoItemsEntry,onOpen:()->Unit){
    val profile=row.profile
    val metadata=listOfNotNull(profile?.stall,profile?.cooking,catalogPortion(row))
    CatalogRow(row.dish,metadata.joinToString(" · "),onOpen)
}

private fun MerchantMenuResultDtoDirectoryTakeoutEntry.catalogLink():DetailLink? =
    recordId?.let{DetailLink("purchase",it,merchant)}
        ?:sourceId?.let{DetailLink("activity_capture",it,merchant)}

@Composable private fun CatalogOrderRow(
    order:MerchantMenuResultDtoDirectoryTakeoutEntry,showShop:Boolean,onShop:()->Unit={},onOrder:()->Unit
){
    LifeCard{
        Text(order.merchant,style=MaterialTheme.typography.titleMedium)
        Text("${order.date} · ${when {order.linkedMeal->"已关联餐次";order.recordId==null->"来自订单截图";else->"待关联餐次"}}",
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(order.items.joinToString("、").ifBlank{"订单菜品明细未展开"},maxLines=3,overflow=TextOverflow.Ellipsis)
        Row {
            TextButton(onClick=onOrder){Text(if(order.recordId==null)"查看订单来源" else "查看订单")}
            if(showShop)TextButton(onClick=onShop){Text("查看门店")}
        }
    }
}

@Composable private fun CatalogPrices(prices:List<MerchantMenuResultDtoStallPricesEntry>) {
    var expanded by rememberSaveable{mutableStateOf(false)}
    LifeCard{
        TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起档口价目" else "查看档口价目")}
        if(expanded)prices.forEach { price->
            val terms=when(val value=price.terms){
                is MerchantMenuResultDtoStallPricesEntryTermsByWeight->"${value.priceCny} 元 / ${value.perGrams} g"
                is MerchantMenuResultDtoStallPricesEntryTermsPerPortion->"${value.priceCny} 元 / 份"
            }
            Text("${price.stall} · ${price.priceName} · $terms")
            Text("${price.validFrom} 起 · ${price.evidenceNote}",style=MaterialTheme.typography.bodySmall)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun CatalogDishDetails(
    row:MerchantMenuResultDtoItemsEntry,onBack:()->Unit,onLink:(DetailLink)->Unit,onEdit:()->Unit,onRecord:()->Unit
) {
    LifeFullScreen(row.dish,onBack){
        LazyColumn(verticalArrangement=Arrangement.spacedBy(12.dp),contentPadding=PaddingValues(bottom=16.dp)){
            item{
                val profile=row.profile
                LifeCard{
                    val portion=catalogPortion(row)
                    Text(portion?:"常用份量未录入",style=MaterialTheme.typography.titleLarge)
                    profile?.portion?.basis?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                    val details=listOfNotNull(
                        profile?.stall,profile?.cooking,profile?.groups?.mapNotNull{groups[it.wireValue]}?.takeIf{it.isNotEmpty()}?.joinToString("、")
                    )
                    if(details.isNotEmpty())Text(details.joinToString(" · "))
                    profile?.aliases?.takeIf{it.isNotEmpty()}?.let{Text("别名 ${it.joinToString("、")}",style=MaterialTheme.typography.bodySmall)}
                    val values=profile?.portion?.nutrients?.let{
                        menuJson.encodeToJsonElement(MerchantMenuResultDtoItemsEntryProfilePortionNutrients.serializer(),it) as JsonObject
                    }?:row.nutrients
                    if(values.isNotEmpty())FlowRow(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                        nutrients.forEach{(key,label)->
                            (values[key] as? JsonPrimitive)?.let{value->Text("$label ${value.content}",style=MaterialTheme.typography.bodySmall)}
                        }
                    }
                }
            }
            item {
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    Button(onClick=onRecord){Text("用这道菜记餐")}
                    OutlinedButton(onClick=onEdit){Text("编辑菜品")}
                }
            }
            if(!row.provenance.isNullOrBlank()||row.evidence.isNotEmpty())item{
                LifeCard {
                    Text("收录依据",style=MaterialTheme.typography.titleMedium)
                    row.provenance?.takeUnless{it.isBlank()||row.evidence.any{source->source.note==it}}?.let{Text(it)}
                    row.evidence.forEach{source->
                        source.note?.takeIf(String::isNotBlank)?.let{Text(it)}
                        source.mealId?.let{TextButton(onClick={onBack();onLink(DetailLink("meal",it,"来源餐次"))}){Text("查看来源餐次")}}
                        source.libraryItemId?.let{TextButton(onClick={onBack();onLink(DetailLink("library_item",it,"菜单照片"))}){Text("查看菜单照片")}}
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun CatalogRecordMeal(
    dish:MerchantMenuResultDtoItemsEntry,busy:Boolean,error:String?,onBack:()->Unit,onSave:(String,String,String)->Unit
){
    var date by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
    var type by rememberSaveable{mutableStateOf("lunch")}
    var grams by rememberSaveable{mutableStateOf("")}
    LifeFullScreen("记入餐次",onBack) {
        Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(dish.dish,style=MaterialTheme.typography.titleLarge)
            LifeDateField(date,{date=it},enabled=!busy)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他").forEach{(key,label)->
                    FilterChip(type==key,{type=key},label={Text(label)},enabled=!busy)
                }
            }
            OutlinedTextField(grams,{grams=it},Modifier.fillMaxWidth(),singleLine=true,enabled=!busy,
                label={Text("本次估重（克，可选）")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
            error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
            val valid=grams.isBlank()||(decimal.matches(grams)&&grams.toBigDecimal().signum()>0)
            Button(onClick={onSave(date,type,grams.trim())},enabled=!busy&&valid,modifier=Modifier.fillMaxWidth()){Text("保存餐次")}
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun CanteenProfileEditor(request:DishEdit,busy:Boolean,saveError:String?,onCancel:()->Unit,
    onSave:(String,String,JSONObject,JSONObject)->Unit) {
    val row=request.row
    val profile=row?.profile
    val portion=profile?.portion
    var dish by remember(row){mutableStateOf(row?.dish?:request.dish)}
    var stall by remember(row){mutableStateOf(profile?.stall.orEmpty())}
    var aliases by remember(row){mutableStateOf(profile?.aliases?.joinToString("、").orEmpty())}
    var cooking by remember(row){mutableStateOf(profile?.cooking.orEmpty())}
    var selected by remember(row){mutableStateOf(profile?.groups?.map{it.wireValue}?.toSet().orEmpty())}
    var classify by remember(row){mutableStateOf(profile?.groups!=null)}
    var staple by remember(row){mutableStateOf(profile?.staple)}
    var quantity by remember(row){mutableStateOf(portion?.quantity.orEmpty())}
    var unit by remember(row){mutableStateOf(portion?.unit.orEmpty())}
    var grams by remember(row){mutableStateOf(portion?.grams.orEmpty())}
    var estimated by remember(row){mutableStateOf(portion?.estimated?:false)}
    var basis by remember(row){mutableStateOf(portion?.basis.orEmpty())}
    var note by remember(request){mutableStateOf(request.source)}
    var sourceKind by remember(request){mutableStateOf("note")}
    var sourceId by remember(request){mutableStateOf("")}
    var intakeId by remember(request){mutableStateOf("")}
    var editNutrients by remember(row){mutableStateOf(false)}
    var numeric by remember(row){mutableStateOf(portion?.nutrients?.let { values ->
        val saved=JSONObject(menuJson.encodeToString(MerchantMenuResultDtoItemsEntryProfilePortionNutrients.serializer(),values))
        nutrients.keys.associateWith{saved.optString(it)}
    }.orEmpty())}
    var error by remember(row){mutableStateOf("")}
    fun submit(){
        val validSource=if(sourceKind=="note")note.isNotBlank() else sourceId.isNotBlank()&&(sourceKind!="meal_intake"||intakeId.isNotBlank())
        val hasPortion=listOf(quantity,unit,grams,basis).any{it.isNotBlank()}||numeric.values.any{it.isNotBlank()}
        if(!validMerchantName(dish.trim())||!validSource||hasPortion&&(!decimal.matches(quantity)||quantity.toDoubleOrNull()?.let{it>0}!=true||
            unit.isBlank()||basis.isBlank()||grams.isNotBlank()&&(!decimal.matches(grams)||grams.toDoubleOrNull()?.let{it>0}!=true)||
            numeric.values.any{it.isNotBlank()&&!decimal.matches(it)})){
            error="请核对菜名、出处及份量的数值、单位和依据"
            return
        }
        val data=JSONObject()
        val names=aliases.split(Regex("[、,，]")).map{it.trim()}.filter{it.isNotEmpty()}.distinct()
        if(names.isNotEmpty()||row!=null)data.put("aliases",JSONArray(names))
        if(cooking.isNotBlank())data.put("cooking",cooking.trim())
        if(classify)data.put("groups",JSONArray(selected.toList()))
        staple?.let{data.put("staple",it)}
        if(hasPortion){
            val value=JSONObject().put("quantity",quantity).put("unit",unit.trim()).put("estimated",estimated).put("basis",basis.trim())
            if(grams.isNotBlank())value.put("grams",grams)
            value.put("nutrients",JSONObject(numeric.filterValues{it.isNotBlank()}))
            data.put("portion",value)
        }
        error=""
        val evidence=JSONObject().put("kind",sourceKind)
        if(note.isNotBlank())evidence.put("note",note.trim())
        when(sourceKind) {
            "menu_photo"->evidence.put("library_item_id",sourceId.trim())
            "meal_intake"->evidence.put("meal_id",sourceId.trim()).put("intake_id",intakeId.trim())
        }
        onSave(dish.trim(),stall.trim(),data,evidence)
    }
    OutlinedTextField(dish,{dish=it},label={Text("菜名")},readOnly=row!=null,singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(stall,{stall=it},label={Text("档口")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(aliases,{aliases=it},label={Text("别名（顿号分隔）")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(cooking,{cooking=it},label={Text("做法")},singleLine=true,modifier=Modifier.fillMaxWidth())
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(classify,{classify=!classify},label={Text("手工分类")})
        if(classify)groups.forEach{(key,label)->FilterChip(key in selected,{selected=if(key in selected)selected-key else selected+key},label={Text(label)})}
    }
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(staple==null,{staple=null},label={Text("按名称认主食")})
        FilterChip(staple==true,{staple=true},label={Text("主食")})
        FilterChip(staple==false,{staple=false},label={Text("其他")})
    }
    OutlinedTextField(quantity,{quantity=it},label={Text("常用数量")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(unit,{unit=it},label={Text("常用单位，如平勺")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(grams,{grams=it},label={Text("对应克重")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(basis,{basis=it},label={Text("份量与营养依据")},modifier=Modifier.fillMaxWidth())
    FilterChip(estimated,{estimated=!estimated},label={Text("份量或营养是估算")})
    TextButton(onClick={editNutrients=!editNutrients}){Text("填写这份的营养")}
    if(editNutrients)nutrients.forEach{(key,label)->
        OutlinedTextField(numeric[key].orEmpty(),{numeric=numeric+(key to it)},label={Text(label)},singleLine=true,modifier=Modifier.fillMaxWidth())
    }
    LifeChoiceField("出处",sourceKind,listOf("note" to "文字说明","menu_photo" to "已有菜单照片","meal_intake" to "已有餐次")){sourceKind=it;sourceId="";intakeId=""}
    when(sourceKind){
        "menu_photo"->OutlinedTextField(sourceId,{sourceId=it},label={Text("资料库照片编号")},modifier=Modifier.fillMaxWidth())
        "meal_intake"->{
            OutlinedTextField(sourceId,{sourceId=it},label={Text("餐次编号")},modifier=Modifier.fillMaxWidth())
            OutlinedTextField(intakeId,{intakeId=it},label={Text("食物条目编号")},modifier=Modifier.fillMaxWidth())
        }
    }
    OutlinedTextField(note,{note=it},label={Text(if(sourceKind=="note")"这次补充的出处" else "备注（可选）")},modifier=Modifier.fillMaxWidth())
    saveError?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Button(onClick={submit()},enabled=!busy){Text("保存菜品")}
        TextButton(onClick=onCancel,enabled=!busy){Text("取消")}
    }
}

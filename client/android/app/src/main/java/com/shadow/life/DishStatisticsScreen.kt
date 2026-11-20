package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlinx.coroutines.CancellationException

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun DishStatisticsScreen(
    initialMerchant:String,
    initialDate:String,
    onBack:()->Unit,
    onMeal:(String)->Unit,
    onMenu:(merchant:String,on:String)->Unit,
    read:suspend (merchant:String,on:String,query:String,offset:Long,browse:Boolean)->MerchantMenuResultDto
) {
    var date by rememberSaveable(initialDate){mutableStateOf(initialDate.ifBlank{LocalDate.now().toString()})}
    var merchant by rememberSaveable(initialMerchant){mutableStateOf(initialMerchant)}
    var query by rememberSaveable{mutableStateOf("")}
    var search by rememberSaveable{mutableStateOf("")}
    var directory by remember(date){mutableStateOf<MerchantMenuResultDtoDirectory?>(null)}
    var offset by remember(merchant,date,search){mutableLongStateOf(0)}
    var revision by remember{mutableIntStateOf(0)}
    var stats by remember(merchant,date,search){mutableStateOf<MerchantMenuResultDtoStatistics?>(null)}
    var loading by remember(merchant,date,search){mutableStateOf(true)}
    var error by remember(merchant,date,search){mutableStateOf<String?>(null)}
    val keyboard=LocalSoftwareKeyboardController.current

    LaunchedEffect(merchant,date,search,offset,revision) {
        loading=true
        error=null
        try {
            val result=read(merchant,date,search,offset,directory==null)
            val page=checkNotNull(result.statistics){"当前服务尚未提供菜品统计"}
            result.directory?.let{directory=it}
            stats=if(offset==0L)page else page.copy(items=(stats?.items.orEmpty()+page.items).distinctBy{
                Triple(it.foodId,it.merchant?.lowercase(),it.name.lowercase())
            })
        } catch(cancel:CancellationException){throw cancel}
        catch(failure:Exception){error=failure.message ?: "菜品统计暂时无法读取"}
        finally{loading=false}
    }
    fun applySearch(){
        keyboard?.hide()
        if(query.trim()==search){offset=0;revision++} else search=query.trim()
    }

    Scaffold(topBar={TopAppBar(title={Text("菜品统计")},navigationIcon={LifeBackButton(onBack)})}){padding->
        LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(),contentPadding=PaddingValues(16.dp),
            verticalArrangement=Arrangement.spacedBy(10.dp)){
            item {
                LifeDateField(date,{date=it},label="近 30 天 · 截止日")
                val catalog=directory
                val options=(listOfNotNull(merchant,catalog?.defaultMerchant)+catalog?.merchants.orEmpty().map{it.name}
                    +catalog?.takeout.orEmpty().map{it.merchant}).filter(::validMerchantName).distinctBy{it.lowercase()}
                LifeChoiceField("门店",merchant,listOf("" to "全部门店")+options.map{name->
                    val store=catalog?.merchants?.firstOrNull{it.name.equals(name,true)}
                    name to (store?.let{"$name · 已收录 ${it.menuItems} 道 · 实吃 ${it.meals} 餐"} ?: name)
                }){merchant=it}
                TextButton(onClick={onMenu(merchant,date)}){Text(if(merchant.isBlank())"浏览门店菜单" else "查看这家门店的菜单")}
                OutlinedTextField(query,{query=it.take(160)},Modifier.fillMaxWidth(),singleLine=true,label={Text("搜索菜名")},
                    trailingIcon={TextButton(onClick=::applySearch){Text("查询")}},
                    keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),
                    keyboardActions=KeyboardActions(onSearch={applySearch()}))
            }
            stats?.let { data->
                item{
                    Text("${data.dishes} 道菜 · ${data.meals} 餐",style=MaterialTheme.typography.headlineSmall)
                    Text("${data.from} 至 ${data.to} · 同餐的同一道菜只计一次",style=MaterialTheme.typography.bodySmall,
                        color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if(data.items.isEmpty())item{
                    EmptyState(if(search.isNotBlank())"记录中没有匹配的菜品" else "这段时间还没有实吃菜品记录")
                }
                items(data.items){dish->
                    LifeCard(onClick={onMeal(dish.mealId)}){
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                            Text(dish.name,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                            Text("${dish.meals} 餐",style=MaterialTheme.typography.titleMedium)
                        }
                        Text(listOfNotNull(dish.merchant,dish.stall).joinToString(" · ").ifBlank{"门店未记录"},
                            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("查看最近一餐 · ${dish.lastEatenOn}",style=MaterialTheme.typography.labelMedium,
                            color=MaterialTheme.colorScheme.primary)
                    }
                }
                if(!loading&&error==null)data.nextOffset?.let{next->item{
                    OutlinedButton(onClick={offset=next},modifier=Modifier.fillMaxWidth()){Text("加载更多菜品")}
                }}
            }
            if(loading)item{LinearProgressIndicator(Modifier.fillMaxWidth())}
            error?.let{message->item{EmptyState(message,"重试"){revision++}}}
        }
    }
}

package com.shadow.life

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlinx.serialization.Serializable

@Serializable internal data object ModuleDetailFixture

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],qualifiers="w393dp-h852dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LifeModuleNavigationTest {
  @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
  private lateinit var nav:NavHostController

  private fun showNavigation(){
    compose.setContent{LifeTheme(Appearance.Light){
      nav=rememberNavController()
      val navigation=LifeModuleNavigation({module,tab->nav.openLifeModule(module,tab)},{},{},{},{},{})
      CompositionLocalProvider(LocalLifeModuleNavigation provides navigation){
        NavHost(nav,startDestination=TodayRoute){
          composable<TodayRoute>{Text("生活首页")}
          composable<MoneyModuleRoute>{entry->LifeModuleEntry(entry,LifeDomain.Money){route->ModuleFixture(LifeModule.Money,route.tab,moneyModuleTabs)}}
          composable<HealthModuleRoute>{entry->LifeModuleEntry(entry,LifeDomain.Health){route->ModuleFixture(LifeModule.Health,route.tab,healthModuleTabs)}}
          composable<ModuleDetailFixture>{Text("已打开消费详情")}
        }
      }
    }}
  }

  @Composable private fun ModuleFixture(module:LifeModule,initialTab:String,tabs:List<ModuleTab>){
    var tab by rememberSaveable{mutableStateOf(initialTab.ifBlank{"overview"})}
    var query by rememberSaveable{mutableStateOf("")}
    val list=rememberModuleListState(tab)
    Scaffold(topBar={LifeModuleTopBar(module)},bottomBar={LifeModuleBottomBar(tab,tabs){tab=it}}){padding->
      Column(Modifier.fillMaxSize().padding(padding)){
        OutlinedTextField(query,{query=it},Modifier.testTag("query"),label={Text("查找")})
        LazyColumn(Modifier.weight(1f).testTag("records"),state=list){items(50){index->Text("${module.label}记录 $index",Modifier.fillMaxWidth().padding(18.dp))}}
      }
    }
  }

  @Test fun switchingModulesRestoresEachTabQueryAndScrollWithoutMixingRoots(){
    showNavigation()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money)}
    compose.onNodeWithText("明细").performClick()
    compose.onNodeWithTag("query").performTextInput("咖啡")
    compose.onNodeWithTag("records").performScrollToNode(hasText("消费记录 25"))
    compose.onNodeWithText("消费记录 25").assertIsDisplayed()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Health)}
    compose.onNodeWithText("睡眠").performClick()
    compose.onNodeWithTag("query").performTextInput("昨晚")
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money)}
    compose.onNodeWithText("明细").assertIsSelected()
    compose.onNodeWithTag("query").assertTextContains("咖啡")
    compose.onNodeWithText("消费记录 25").assertIsDisplayed()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Health)}
    compose.onNodeWithText("睡眠").assertIsSelected()
    compose.onNodeWithTag("query").assertTextContains("昨晚")
  }

  @Test fun serviceLinksOverrideTheRememberedTabEvenWhenTheSameLinkIsRepeated(){
    showNavigation()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money,"details")}
    compose.onNodeWithText("明细").assertIsSelected()
    compose.onNodeWithText("预算").performClick()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Health)}
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money,"details")}
    compose.onNodeWithText("明细").assertIsSelected()
    compose.onNodeWithText("预算").performClick()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money,"details")}
    compose.onNodeWithText("明细").assertIsSelected()
    compose.runOnIdle{nav.popBackStack()}
    compose.onNodeWithText("生活首页").assertIsDisplayed()
  }

  @Test fun explicitServiceLinkLeavesARestoredDetailAndOpensTheRequestedRootSection(){
    showNavigation()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money);nav.navigate(ModuleDetailFixture)}
    compose.onNodeWithText("已打开消费详情").assertIsDisplayed()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Health)}
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money)}
    compose.onNodeWithText("已打开消费详情").assertIsDisplayed()
    compose.runOnIdle{nav.openLifeModule(LifeModule.Health)}
    compose.runOnIdle{nav.openLifeModule(LifeModule.Money,"budgets")}
    compose.onNodeWithText("已打开消费详情").assertDoesNotExist()
    compose.onNodeWithText("预算").assertIsSelected()
  }

  @Test @Config(qualifiers="w320dp-h640dp-mdpi") fun narrowModuleChromeCanOpenTheSwitcherAndServices(){
    var selected:LifeModule?=null
    var services=false
    compose.setContent{LifeTheme(Appearance.Dark){
      CompositionLocalProvider(LocalLifeModuleNavigation provides LifeModuleNavigation({m,_->selected=m},{services=true},{},{},{},{})){
        Scaffold(topBar={LifeModuleTopBar(LifeModule.Money)},bottomBar={LifeModuleBottomBar("overview",moneyModuleTabs){}}){padding->
          Column(Modifier.padding(padding).padding(16.dp)){
            HomeCommonServices({_,_->},{},{},{},{services=true})
            LifeCard{Text("最近记录／消息");Text("午餐 · 已记录")}
            Text("我的卡片",Modifier.padding(vertical=12.dp))
            LifeCard{Text("消费");Text("当前没有已入账收支")}
          }
        }
      }
    }}
    compose.onNodeWithText("预算").assertIsDisplayed()
    screenshot("life-home-structure-320")
    compose.onNodeWithContentDescription("服务中心").performClick()
    assertTrue(services)
    compose.onNodeWithContentDescription("切换模块").performClick()
    compose.onAllNodesWithText("健康").onLast().performClick()
    assertEquals(LifeModule.Health,selected)
  }

  @Test fun savedHomeLayoutsMigrateOnceWithoutRestoringHiddenCardsOrCrossingAccounts(){
    val context=compose.activity
    context.getSharedPreferences("life_today_cards",0).edit().clear()
      .putString("cards:one","money,recent_info,scale,body")
      .putBoolean("training-introduced:one",true).putBoolean("capture-cards-introduced:one",true).commit()
    val store=TodayCardLayoutStore(context,"one")
    assertEquals(listOf(TodayCardKind.Money,TodayCardKind.Scale,TodayCardKind.Body),store.current())
    store.save(listOf(TodayCardKind.Body))
    assertEquals(listOf(TodayCardKind.Body),TodayCardLayoutStore(context,"one").current())
    assertEquals(defaultTodayCards,TodayCardLayoutStore(context,"two").current())
  }

  private fun screenshot(name:String){
    System.getenv("LIFE_LAYOUT_SCREENSHOTS")?.let{directory->
      val bitmap=compose.runOnIdle{val view=compose.activity.window.decorView;Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888).also{view.draw(Canvas(it))}}
      File(directory).mkdirs();File(directory,"$name.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
    }
  }
}

package com.shadow.life

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],qualifiers="zh-rCN-w393dp-h852dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DishStatisticsScreenTest {
    @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()

    @Test fun shopWithOnlyMenuEntriesStillOffersItsMenu(){
        val fixture=Json.decodeFromString<MerchantMenuResultDto>("""{"merchant":"新门店","items":[],"next":null,
          "directory":{"from":"2026-10-20","to":"2026-11-18","default_merchant":null,
          "merchants":[{"name":"新门店","menu_items":7,"meals":0}],"dishes":[],"takeout":[]},
          "statistics":{"from":"2026-10-20","to":"2026-11-18","merchant":"新门店","meals":0,"dishes":0,"items":[],"next_offset":null}}""")
        var opened:Pair<String,String>?=null
        compose.setContent { LifeTheme(Appearance.Light) {
            DishStatisticsScreen("新门店","2026-11-18",{}, {},{shop,day->opened=shop to day}){_,_,_,_,_->fixture}
        }}
        compose.onNodeWithText("新门店 · 已收录 7 道 · 实吃 0 餐").assertExists()
        compose.onNodeWithText("这段时间还没有实吃菜品记录").assertExists()
        compose.onNodeWithText("查看这家门店的菜单").performClick()
        compose.runOnIdle{assertEquals("新门店" to "2026-11-18",opened)}
    }

    @Test fun merchantMealCountsIncludeOneOffDishesAndOpenTheirLatestMealAcrossPages(){
        val fixture="""{"merchant":"食堂","items":[],"next":null,"directory":{"from":"2026-10-20","to":"2026-11-18",
          "default_merchant":null,"merchants":[{"name":"食堂","menu_items":20,"meals":2}],"dishes":[],"takeout":[]},
          "statistics":{"from":"2026-10-20","to":"2026-11-18","merchant":"食堂","meals":2,"dishes":2,
          "items":[{"name":"炖豆腐","merchant":"食堂","stall":"蒸菜","food_id":"food_tofu","meals":2,
          "last_eaten_on":"2026-11-17","meal_id":"meal_first"}],"next_offset":1}}"""
        val first=Json.decodeFromString<MerchantMenuResultDto>(fixture)
        val stats=checkNotNull(first.statistics)
        val soup=stats.items.single().copy(name="番茄汤",foodId="food_soup",mealId="meal_second",meals=1)
        val second=first.copy(directory=null,statistics=stats.copy(items=listOf(soup),nextOffset=null))
        var latest=""
        var reads=0
        compose.setContent {
            LifeTheme(Appearance.Light) {
                DishStatisticsScreen("食堂","2026-11-18",{}, {latest=it},{_,_->}){merchant,on,search,offset,browse->
                    assertEquals("食堂",merchant)
                    assertEquals("2026-11-18",on)
                    reads++
                    if(search.isNotEmpty()){
                        assertEquals("鱼",search);assertEquals(0L,offset)
                        first.copy(directory=null,statistics=stats.copy(meals=0,dishes=0,items=emptyList(),nextOffset=null))
                    } else if(offset==0L){assertEquals(true,browse);first}else{assertEquals(false,browse);second}
                }
            }
        }
        compose.onNodeWithText("2 道菜 · 2 餐").assertExists()
        compose.onNodeWithText("加载更多菜品").performScrollTo().performClick()
        compose.onNodeWithText("1 餐").assertExists()
        compose.onNodeWithText("番茄汤").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("meal_second",latest);assertEquals(2,reads) }
        compose.onNodeWithText("搜索菜名").performScrollTo().performTextInput("鱼")
        compose.onNodeWithText("查询").performClick()
        compose.onNodeWithText("记录中没有匹配的菜品").assertExists()
        compose.onNodeWithText("番茄汤").assertDoesNotExist()
    }
}

package com.shadow.life

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Debug-only, account-free fixture for map gestures, day tabs, roads, and expanded stops. */
class TravelMapQaActivity:ComponentActivity(){
  override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState)
    val trip=TravelTripSummary("trip_qa","曼谷地图测试","2026-10-01","2026-10-07","Asia/Bangkok",null,true)
    val places=listOf(
      TravelPlaceSummary("grand_palace","大皇宫",null,13.7500,100.4913,emptyList(),false),
      TravelPlaceSummary("wat_pho","卧佛寺",null,13.7465,100.4930,emptyList(),false),
      TravelPlaceSummary("siam","暹罗广场",null,13.7456,100.5341,emptyList(),false),
      TravelPlaceSummary("lumphini","伦披尼公园",null,13.7296,100.5418,emptyList(),false)
    )
    setContent{
      var optimized by androidx.compose.runtime.remember{mutableStateOf(false)}
      var selectedDate by androidx.compose.runtime.remember{mutableStateOf("2026-10-01")}
      var gestureActive by androidx.compose.runtime.remember{mutableStateOf(false)}
      val days=(1..7).map{index->
        val date="2026-10-0$index";val ids=if(optimized)listOf("grand_palace","siam","wat_pho","lumphini") else listOf("grand_palace","wat_pho","siam","lumphini")
        TravelDaySummary("day_${if(optimized)"optimized" else "original"}_$index",trip.id,date,ids.mapIndexed{position,id->TravelStopSummary("stop_${index}_$position",places.first{it.id==id}.name,null,id,null)})
      }
      val value=WorkspaceOverview.Travel(1,places.size,0,false,tripItems=listOf(trip),placeItems=places,days=days,selectedTripId=trip.id,asOf="2026-09-24T00:00:00Z")
      MaterialTheme{Surface{LazyColumn(userScrollEnabled=!gestureActive,verticalArrangement=Arrangement.spacedBy(8.dp)){
        item{Row(Modifier.padding(12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={optimized=false}){Text("原版路线")};Button(onClick={optimized=true}){Text("优化版路线")}}}
        item{TravelMapWorkspace(value,trip,days,days.map{it.date},selectedDate,{selectedDate=it},{gestureActive=it})}
      }}}
    }
  }
}

package com.shadow.life

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.amap.api.maps.AMap
import com.amap.api.maps.CameraUpdateFactory as AMapCameraUpdateFactory
import com.amap.api.maps.CoordinateConverter
import com.amap.api.maps.MapsInitializer
import com.amap.api.maps.TextureMapView as AMapTextureView
import com.amap.api.maps.model.LatLng as AMapLatLng
import com.amap.api.maps.model.MarkerOptions as AMapMarkerOptions
import com.amap.api.maps.model.PolylineOptions as AMapPolylineOptions
import com.google.android.gms.maps.CameraUpdateFactory as GoogleCameraUpdateFactory
import com.google.android.gms.maps.MapView as GoogleMapView
import com.google.android.gms.maps.GoogleMap as GoogleMapApi
import com.google.android.gms.maps.model.LatLng as GoogleLatLng
import com.google.android.gms.maps.model.MarkerOptions as GoogleMarkerOptions
import com.google.android.gms.maps.model.PolylineOptions as GooglePolylineOptions
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.Dash
import com.google.android.gms.maps.model.Gap
import com.google.android.gms.maps.model.LatLngBounds

internal enum class TravelMapProvider(val label:String){Amap("高德地图"),Google("Google 地图")}
internal data class TravelMapMarker(val id:String,val title:String,val latitude:Double,val longitude:Double,val favorite:Boolean=false,val supporting:String?=null,val label:String?=null)
internal data class TravelMapPoint(val latitude:Double,val longitude:Double)
private data class TravelMapContent(val markers:List<TravelMapMarker>,val tracks:List<TravelTrackSummary>,val routes:List<List<TravelMapPoint>>,val satellite:Boolean)
private class TravelMapRenderState(var content:TravelMapContent?=null)

internal object TravelMapPreference {
  private const val file="travel_map_preferences"
  private const val providerKey="provider"
  private const val amapConsentKey="amap_privacy_consent_v1"
  fun provider(context:Context):TravelMapProvider {
    val saved=context.getSharedPreferences(file,Context.MODE_PRIVATE).getString(providerKey,null)
    return TravelMapProvider.entries.firstOrNull{it.name==saved}?:TravelMapProvider.Google
  }
  fun setProvider(context:Context,value:TravelMapProvider){context.getSharedPreferences(file,Context.MODE_PRIVATE).edit().putString(providerKey,value.name).apply()}
  fun hasAmapConsent(context:Context)=context.getSharedPreferences(file,Context.MODE_PRIVATE).getBoolean(amapConsentKey,false)
  fun setAmapConsent(context:Context,value:Boolean){context.getSharedPreferences(file,Context.MODE_PRIVATE).edit().putBoolean(amapConsentKey,value).apply()}
}

internal fun providerConfigured(provider:TravelMapProvider)=when(provider){
  TravelMapProvider.Amap->BuildConfig.AMAP_MAPS_API_KEY.isNotBlank()
  TravelMapProvider.Google->BuildConfig.GOOGLE_MAPS_API_KEY.isNotBlank()
}

@Composable internal fun TravelNativeMap(
  provider:TravelMapProvider,markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,modifier:Modifier=Modifier,routes:List<List<TravelMapPoint>> = emptyList(),satellite:Boolean=false,onGestureActive:(Boolean)->Unit={}
){
  val context=LocalContext.current
  val configured=providerConfigured(provider)
  Box(modifier.clip(RoundedCornerShape(24.dp))){
    when{
      !configured->TravelMapCanvas(markers,tracks,Modifier.fillMaxSize(),routes)
      provider==TravelMapProvider.Amap->AmapSurface(markers,tracks,routes,satellite,Modifier.fillMaxSize(),onGestureActive)
      else->GoogleMapSurface(markers,tracks,routes,satellite,Modifier.fillMaxSize(),onGestureActive)
    }
    if(!configured){Surface(Modifier.align(Alignment.BottomCenter).padding(12.dp),shape=RoundedCornerShape(14.dp),color=MaterialTheme.colorScheme.surface.copy(alpha=.94f)){Text("${provider.label}密钥未配置，当前显示坐标预览",Modifier.padding(horizontal=12.dp,vertical=8.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
  }
}

@Composable private fun AmapSurface(markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,routes:List<List<TravelMapPoint>>,satellite:Boolean,modifier:Modifier,onGestureActive:(Boolean)->Unit){
  val context=LocalContext.current
  val lifecycle=LocalLifecycleOwner.current.lifecycle
  val renderState=remember{TravelMapRenderState()}
  val mapView=remember(context){
    MapsInitializer.updatePrivacyShow(context.applicationContext,true,true)
    MapsInitializer.updatePrivacyAgree(context.applicationContext,true)
    MapsInitializer.setSupportRecycleView(true)
    when(preferredAmapSurface()){
      AmapSurfaceKind.Texture->AMapTextureView(context).apply{layoutParams=ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);onCreate(Bundle());isNestedScrollingEnabled=nativeMapNestedScrollingEnabled()}
    }
  }
  val touchFrame=remember(context,mapView){MapGestureFrame(context).apply{addView(mapView)}}
  DisposableEffect(lifecycle,mapView){var destroyed=false;fun pause(){if(!destroyed)mapView.onPause()};fun destroy(){if(!destroyed){mapView.onDestroy();destroyed=true}};val observer=LifecycleEventObserver{_,event->when(event){Lifecycle.Event.ON_RESUME->if(!destroyed)mapView.onResume();Lifecycle.Event.ON_PAUSE->pause();Lifecycle.Event.ON_DESTROY->destroy();else->{}}};lifecycle.addObserver(observer);if(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))mapView.onResume();onDispose{lifecycle.removeObserver(observer);mapView.parent?.requestDisallowInterceptTouchEvent(false);pause();destroy()}}
  AndroidView(modifier=modifier,factory={touchFrame},update={frame->frame.onGestureActive=onGestureActive;val content=TravelMapContent(markers,tracks,routes,satellite);if(renderState.content!=content){renderAmap(context,mapView.map,markers,tracks,routes,satellite,mapView);renderState.content=content}})
}

private fun renderAmap(context:Context,map:AMap,markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,routes:List<List<TravelMapPoint>>,satellite:Boolean,view:AMapTextureView){
  map.mapType=if(satellite)AMap.MAP_TYPE_SATELLITE else preferredAmapMapType();map.uiSettings.isZoomControlsEnabled=true;map.uiSettings.isScaleControlsEnabled=true;map.uiSettings.isCompassEnabled=true;map.uiSettings.isScrollGesturesEnabled=true;map.uiSettings.isZoomGesturesEnabled=true;map.clear()
  var firstPoint:AMapLatLng?=null
  fun convert(latitude:Double,longitude:Double):AMapLatLng=CoordinateConverter(context).from(CoordinateConverter.CoordType.GPS).coord(AMapLatLng(latitude,longitude)).convert()
  markers.forEach{item->val point=convert(item.latitude,item.longitude);if(firstPoint==null)firstPoint=point;map.addMarker(AMapMarkerOptions().position(point).title(listOfNotNull(item.label,item.title).joinToString(" ")).snippet(item.supporting))}
  tracks.forEach{track->val points=sampleTrack(track.points).map{convert(it.latitude,it.longitude)};if(points.isNotEmpty()){if(firstPoint==null)firstPoint=points.first();if(points.size>1)map.addPolyline(AMapPolylineOptions().addAll(points).width(9f).color(0xff56d6c9.toInt()))}}
  routes.forEach{route->if(route.size>1)map.addPolyline(AMapPolylineOptions().addAll(route.map{convert(it.latitude,it.longitude)}).width(8f).color(0xffe68c3f.toInt()))}
  firstPoint?.let{point->view.post{runCatching{map.animateCamera(AMapCameraUpdateFactory.newLatLngZoom(point,defaultTravelMapZoom()))}}}
}

internal fun preferredAmapMapType():Int=AMap.MAP_TYPE_NORMAL
internal enum class AmapSurfaceKind{Texture}
internal fun preferredAmapSurface()=AmapSurfaceKind.Texture
internal fun defaultTravelMapZoom()=15.5f
internal fun nativeMapNestedScrollingEnabled()=false
internal fun shouldDisallowMapParentIntercept(actionMasked:Int)=actionMasked!=MotionEvent.ACTION_UP&&actionMasked!=MotionEvent.ACTION_CANCEL
internal class MapGestureFrame(context:Context):FrameLayout(context){
  var onGestureActive:(Boolean)->Unit={}
  override fun dispatchTouchEvent(event:MotionEvent):Boolean{
    if(event.actionMasked==MotionEvent.ACTION_DOWN){onGestureActive(true);requestDisallowInterceptTouchEvent(true)}
    val handled=super.dispatchTouchEvent(event)
    if(!shouldDisallowMapParentIntercept(event.actionMasked)){onGestureActive(false);requestDisallowInterceptTouchEvent(false)}
    return handled
  }
  override fun onDetachedFromWindow(){onGestureActive(false);super.onDetachedFromWindow()}
}

@Composable private fun GoogleMapSurface(markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,routes:List<List<TravelMapPoint>>,satellite:Boolean,modifier:Modifier,onGestureActive:(Boolean)->Unit){
  val context=LocalContext.current
  val lifecycle=LocalLifecycleOwner.current.lifecycle
  val renderState=remember{TravelMapRenderState()}
  val mapView=remember(context){GoogleMapView(context).apply{layoutParams=ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);onCreate(Bundle());isNestedScrollingEnabled=nativeMapNestedScrollingEnabled()}}
  val touchFrame=remember(context,mapView){MapGestureFrame(context).apply{addView(mapView)}}
  DisposableEffect(lifecycle,mapView){var destroyed=false;fun pause(){if(!destroyed)mapView.onPause()};fun destroy(){if(!destroyed){mapView.onDestroy();destroyed=true}};val observer=LifecycleEventObserver{_,event->when(event){Lifecycle.Event.ON_RESUME->if(!destroyed)mapView.onResume();Lifecycle.Event.ON_PAUSE->pause();Lifecycle.Event.ON_DESTROY->destroy();else->{}}};lifecycle.addObserver(observer);if(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))mapView.onResume();onDispose{lifecycle.removeObserver(observer);mapView.parent?.requestDisallowInterceptTouchEvent(false);pause();destroy()}}
  AndroidView(modifier=modifier,factory={touchFrame},update={frame->frame.onGestureActive=onGestureActive;val content=TravelMapContent(markers,tracks,routes,satellite);if(renderState.content!=content){renderState.content=content;mapView.getMapAsync{map->
    if(renderState.content!=content)return@getMapAsync
    map.mapType=if(satellite)GoogleMapApi.MAP_TYPE_SATELLITE else GoogleMapApi.MAP_TYPE_NORMAL;map.uiSettings.isZoomControlsEnabled=true;map.uiSettings.isCompassEnabled=true;map.uiSettings.isScrollGesturesEnabled=true;map.uiSettings.isZoomGesturesEnabled=true;map.clear();val bounds=LatLngBounds.Builder();var count=0;var firstPoint:GoogleLatLng?=null
    fun include(point:GoogleLatLng){bounds.include(point);count++;if(firstPoint==null)firstPoint=point}
    markers.forEach{item->val point=GoogleLatLng(item.latitude,item.longitude);include(point);val options=GoogleMarkerOptions().position(point).title(listOfNotNull(item.label,item.title).joinToString(" ")).snippet(item.supporting);if(item.label!=null)options.icon(BitmapDescriptorFactory.fromBitmap(numberedMarker(item.label)));map.addMarker(options)}
    tracks.forEach{track->val points=sampleTrack(track.points).map{GoogleLatLng(it.latitude,it.longitude)};points.forEach(::include);if(points.size>1)map.addPolyline(GooglePolylineOptions().addAll(points).width(9f).color(0xff56d6c9.toInt()))}
    routes.forEach{route->if(route.size>1)map.addPolyline(GooglePolylineOptions().addAll(route.map{GoogleLatLng(it.latitude,it.longitude)}).width(8f).color(0xffe68c3f.toInt()).pattern(listOf(Dash(18f),Gap(12f))))}
    firstPoint?.let{point->
      fun fit(){
        if(renderState.content!=content||mapView.width<=0||mapView.height<=0)return
        val camera=if(count>1)GoogleCameraUpdateFactory.newLatLngBounds(bounds.build(),mapView.width,mapView.height,72) else GoogleCameraUpdateFactory.newLatLngZoom(point,defaultTravelMapZoom())
        map.moveCamera(camera)
      }
      if(mapView.width>0&&mapView.height>0)mapView.post(::fit)
      else mapView.addOnLayoutChangeListener(object:View.OnLayoutChangeListener{
        override fun onLayoutChange(view:View,left:Int,top:Int,right:Int,bottom:Int,oldLeft:Int,oldTop:Int,oldRight:Int,oldBottom:Int){
          if(right>left&&bottom>top){mapView.removeOnLayoutChangeListener(this);mapView.post(::fit)}
        }
      })
    }
  }}})
}

private fun numberedMarker(label:String):Bitmap{val bitmap=Bitmap.createBitmap(116,116,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap);val paint=Paint(Paint.ANTI_ALIAS_FLAG);paint.color=Color.WHITE;canvas.drawCircle(58f,55f,52f,paint);paint.color=0xffd56832.toInt();canvas.drawCircle(58f,55f,46f,paint);paint.color=Color.WHITE;paint.textAlign=Paint.Align.CENTER;paint.textSize=if(label.length>3)29f else 38f;paint.isFakeBoldText=true;canvas.drawText(label.take(6),58f,68f,paint);return bitmap}

private fun sampleTrack(points:List<TravelTrackPoint>,maximum:Int=1200):List<TravelTrackPoint>{if(points.size<=maximum)return points;val step=(points.size-1).toDouble()/(maximum-1);return List(maximum){index->points[(index*step).toInt().coerceAtMost(points.lastIndex)]}}

package com.shadow.life

import android.content.Context
import android.os.Bundle
import android.view.ViewGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.amap.api.maps.model.LatLngBounds as AMapLatLngBounds
import com.amap.api.maps.model.MarkerOptions as AMapMarkerOptions
import com.amap.api.maps.model.PolylineOptions as AMapPolylineOptions
import com.google.android.gms.maps.CameraUpdateFactory as GoogleCameraUpdateFactory
import com.google.android.gms.maps.MapView as GoogleMapView
import com.google.android.gms.maps.model.LatLng as GoogleLatLng
import com.google.android.gms.maps.model.LatLngBounds as GoogleLatLngBounds
import com.google.android.gms.maps.model.MarkerOptions as GoogleMarkerOptions
import com.google.android.gms.maps.model.PolylineOptions as GooglePolylineOptions

internal enum class TravelMapProvider(val label:String){Amap("高德地图"),Google("Google 地图")}
internal data class TravelMapMarker(val id:String,val title:String,val latitude:Double,val longitude:Double,val favorite:Boolean=false,val supporting:String?=null)

internal object TravelMapPreference {
  private const val file="travel_map_preferences"
  private const val providerKey="provider"
  private const val amapConsentKey="amap_privacy_consent_v1"
  fun provider(context:Context):TravelMapProvider {
    val saved=context.getSharedPreferences(file,Context.MODE_PRIVATE).getString(providerKey,null)
    return TravelMapProvider.entries.firstOrNull{it.name==saved}?:when{
      BuildConfig.AMAP_MAPS_API_KEY.isNotBlank()->TravelMapProvider.Amap
      BuildConfig.GOOGLE_MAPS_API_KEY.isNotBlank()->TravelMapProvider.Google
      else->TravelMapProvider.Amap
    }
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
  provider:TravelMapProvider,markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,modifier:Modifier=Modifier
){
  val context=LocalContext.current
  val configured=providerConfigured(provider)
  Box(modifier.clip(RoundedCornerShape(24.dp))){
    when{
      !configured->TravelMapCanvas(markers,tracks,Modifier.fillMaxSize())
      provider==TravelMapProvider.Amap->AmapSurface(markers,tracks,Modifier.fillMaxSize())
      else->GoogleMapSurface(markers,tracks,Modifier.fillMaxSize())
    }
    if(!configured){Surface(Modifier.align(Alignment.BottomCenter).padding(12.dp),shape=RoundedCornerShape(14.dp),color=MaterialTheme.colorScheme.surface.copy(alpha=.94f)){Text("${provider.label}密钥未配置，当前显示坐标预览",Modifier.padding(horizontal=12.dp,vertical=8.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
  }
}

@Composable private fun AmapSurface(markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,modifier:Modifier){
  val context=LocalContext.current
  val lifecycle=LocalLifecycleOwner.current.lifecycle
  val mapView=remember(context){
    MapsInitializer.updatePrivacyShow(context.applicationContext,true,true)
    MapsInitializer.updatePrivacyAgree(context.applicationContext,true)
    MapsInitializer.setSupportRecycleView(true)
    when(preferredAmapSurface()){
      AmapSurfaceKind.Texture->AMapTextureView(context).apply{layoutParams=ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);onCreate(Bundle())}
    }
  }
  DisposableEffect(lifecycle,mapView){var destroyed=false;fun pause(){if(!destroyed)mapView.onPause()};fun destroy(){if(!destroyed){mapView.onDestroy();destroyed=true}};val observer=LifecycleEventObserver{_,event->when(event){Lifecycle.Event.ON_RESUME->if(!destroyed)mapView.onResume();Lifecycle.Event.ON_PAUSE->pause();Lifecycle.Event.ON_DESTROY->destroy();else->{}}};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer);pause();destroy()}}
  AndroidView(modifier=modifier,factory={mapView},update={view->renderAmap(context,view.map,markers,tracks,view)})
}

private fun renderAmap(context:Context,map:AMap,markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,view:AMapTextureView){
  map.mapType=preferredAmapMapType();map.uiSettings.isZoomControlsEnabled=false;map.uiSettings.isCompassEnabled=true;map.clear()
  val bounds=AMapLatLngBounds.builder();var count=0;var firstPoint:AMapLatLng?=null
  fun convert(latitude:Double,longitude:Double):AMapLatLng=CoordinateConverter(context).from(CoordinateConverter.CoordType.GPS).coord(AMapLatLng(latitude,longitude)).convert()
  markers.forEach{item->val point=convert(item.latitude,item.longitude);if(firstPoint==null)firstPoint=point;bounds.include(point);count++;map.addMarker(AMapMarkerOptions().position(point).title(item.title).snippet(item.supporting))}
  tracks.forEach{track->val points=sampleTrack(track.points).map{convert(it.latitude,it.longitude)};if(points.isNotEmpty()){if(firstPoint==null)firstPoint=points.first();points.forEach{bounds.include(it);count++};if(points.size>1)map.addPolyline(AMapPolylineOptions().addAll(points).width(9f).color(0xff56d6c9.toInt()))}}
  if(count>0)view.post{runCatching{map.animateCamera(if(count==1)AMapCameraUpdateFactory.newLatLngZoom(firstPoint!!,14f) else AMapCameraUpdateFactory.newLatLngBounds(bounds.build(),72))}}
}

internal fun preferredAmapMapType():Int=AMap.MAP_TYPE_NORMAL
internal enum class AmapSurfaceKind{Texture}
internal fun preferredAmapSurface()=AmapSurfaceKind.Texture

@Composable private fun GoogleMapSurface(markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,modifier:Modifier){
  val lifecycle=LocalLifecycleOwner.current.lifecycle
  var mapView by remember{mutableStateOf<GoogleMapView?>(null)}
  DisposableEffect(lifecycle,mapView){val view=mapView;var destroyed=false;fun destroy(){if(!destroyed){view?.onDestroy();destroyed=true}};val observer=LifecycleEventObserver{_,event->when(event){Lifecycle.Event.ON_RESUME->view?.onResume();Lifecycle.Event.ON_PAUSE->view?.onPause();Lifecycle.Event.ON_DESTROY->destroy();else->{}}};lifecycle.addObserver(observer);if(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))view?.onResume();onDispose{lifecycle.removeObserver(observer);view?.onPause();destroy()}}
  AndroidView(modifier=modifier,factory={ctx->GoogleMapView(ctx).also{view->view.layoutParams=ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);view.onCreate(Bundle());mapView=view}},update={view->view.getMapAsync{map->
    map.uiSettings.isZoomControlsEnabled=false;map.uiSettings.isCompassEnabled=true;map.clear();val bounds=GoogleLatLngBounds.builder();var count=0
    markers.forEach{item->val point=GoogleLatLng(item.latitude,item.longitude);bounds.include(point);count++;map.addMarker(GoogleMarkerOptions().position(point).title(item.title).snippet(item.supporting))}
    tracks.forEach{track->val points=sampleTrack(track.points).map{GoogleLatLng(it.latitude,it.longitude)};if(points.isNotEmpty()){points.forEach{bounds.include(it);count++};if(points.size>1)map.addPolyline(GooglePolylineOptions().addAll(points).width(9f).color(0xff56d6c9.toInt()))}}
    if(count>0)view.post{runCatching{map.animateCamera(if(count==1)GoogleCameraUpdateFactory.newLatLngZoom(bounds.build().center,14f) else GoogleCameraUpdateFactory.newLatLngBounds(bounds.build(),72))}}
  }})
}

private fun sampleTrack(points:List<TravelTrackPoint>,maximum:Int=1200):List<TravelTrackPoint>{if(points.size<=maximum)return points;val step=(points.size-1).toDouble()/(maximum-1);return List(maximum){index->points[(index*step).toInt().coerceAtMost(points.lastIndex)]}}

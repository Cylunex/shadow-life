package com.shadow.life

import android.content.Context
import android.content.pm.PackageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

internal data class GoogleRoadRoute(val points:List<TravelMapPoint>,val distanceMeters:Int,val durationSeconds:Int)

internal suspend fun fetchGoogleRoadRoute(context:Context,stops:List<TravelMapPoint>,apiKey:String):GoogleRoadRoute? = withContext(Dispatchers.IO){
  if(stops.size<2||apiKey.isBlank())return@withContext null
  val waypoint:(TravelMapPoint)->JSONObject={point->JSONObject().put("location",JSONObject().put("latLng",JSONObject().put("latitude",point.latitude).put("longitude",point.longitude)))}
  val body=JSONObject().put("origin",waypoint(stops.first())).put("destination",waypoint(stops.last())).put("travelMode","DRIVE")
  if(stops.size>2)body.put("intermediates",JSONArray().apply{stops.drop(1).dropLast(1).forEach{put(waypoint(it))}})
  val connection=(URL("https://routes.googleapis.com/directions/v2:computeRoutes").openConnection() as HttpURLConnection).apply{
    requestMethod="POST";connectTimeout=8000;readTimeout=12000;doOutput=true
    setRequestProperty("Content-Type","application/json")
    setRequestProperty("X-Goog-Api-Key",apiKey)
    setRequestProperty("X-Goog-FieldMask","routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline")
    setRequestProperty("X-Android-Package",context.packageName)
    @Suppress("DEPRECATION")
    val signers=context.packageManager.getPackageInfo(context.packageName,PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
    signers?.firstOrNull()?.let{signer->
      val fingerprint=MessageDigest.getInstance("SHA-1").digest(signer.toByteArray()).joinToString(""){byte->"%02X".format(byte)}
      setRequestProperty("X-Android-Cert",fingerprint)
    }
  }
  try{
    connection.outputStream.use{it.write(body.toString().toByteArray(Charsets.UTF_8))}
    if(connection.responseCode !in 200..299)return@withContext null
    val response=connection.inputStream.bufferedReader().use{JSONObject(it.readText())}
    val route=response.optJSONArray("routes")?.optJSONObject(0)?:return@withContext null
    val encoded=route.optJSONObject("polyline")?.optString("encodedPolyline").orEmpty()
    val points=decodeGooglePolyline(encoded)
    if(points.size<2)return@withContext null
    val duration=route.optString("duration").removeSuffix("s").toDoubleOrNull()?.toInt()?:0
    GoogleRoadRoute(points,route.optInt("distanceMeters"),duration)
  }finally{connection.disconnect()}
}

internal fun decodeGooglePolyline(encoded:String):List<TravelMapPoint>{
  val points=mutableListOf<TravelMapPoint>();var index=0;var latitude=0;var longitude=0
  fun next():Int{
    var result=0;var shift=0
    while(index<encoded.length){val value=encoded[index++].code-63;result=result or ((value and 0x1f) shl shift);if(value<0x20)return if(result and 1==1)(result shr 1).inv() else result shr 1;shift+=5;if(shift>30)break}
    throw IllegalArgumentException("Invalid route polyline")
  }
  while(index<encoded.length){latitude+=next();longitude+=next();points+=TravelMapPoint(latitude/1e5,longitude/1e5)}
  return points
}

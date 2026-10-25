package com.shadow.life

import com.samsung.android.sdk.health.data.data.Field
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.data.UserDataPoint
import com.samsung.android.sdk.health.data.data.entries.BloodGlucose
import com.samsung.android.sdk.health.data.data.entries.ExerciseLocation
import com.samsung.android.sdk.health.data.data.entries.ExerciseLog
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.data.entries.HeartRate
import com.samsung.android.sdk.health.data.data.entries.OxygenSaturation
import com.samsung.android.sdk.health.data.data.entries.SkinTemperature
import com.samsung.android.sdk.health.data.data.entries.SleepSession
import com.samsung.android.sdk.health.data.data.entries.SwimmingLog
import com.samsung.android.sdk.health.data.request.DataType
import java.time.Duration
import java.time.temporal.TemporalAccessor
import org.json.JSONArray
import org.json.JSONObject

internal const val SAMSUNG_PARSE_VERSION="samsung-data-4"
internal const val SAMSUNG_SDK_SCHEMA_VERSION="1.1.0"

/** Lossless-enough JSON envelope for every public field exposed by the bundled SDK. */
internal fun samsungHealthPointPayload(type:DataType,point:HealthDataPoint):JSONObject=JSONObject()
  .put("samsung_data_type",type.name)
  .put("sdk_schema_version",SAMSUNG_SDK_SCHEMA_VERSION)
  .putOpt("uid",point.uid)
  .putOpt("client_data_id",point.clientDataId)
  .putOpt("client_version",point.clientVersion)
  .putOpt("data_source",point.dataSource?.let{JSONObject().put("app_id",it.appId).put("device_id",it.deviceId)})
  .putOpt("updated_at",point.updateTime?.toString())
  .putOpt("started_at",point.startTime?.toString())
  .putOpt("ended_at",point.endTime?.toString())
  .putOpt("zone_offset",point.zoneOffset?.toString())
  .put("fields",healthFields(type,point))

internal fun samsungUserProfilePayload(type:DataType,point:UserDataPoint):JSONObject=JSONObject()
  .put("samsung_data_type",type.name)
  .put("sdk_schema_version",SAMSUNG_SDK_SCHEMA_VERSION)
  .put("fields",userFields(type,point))

internal fun samsungAggregatePayload(type:DataType,operation:String,start:String?,end:String?,value:Any?):JSONObject=JSONObject()
  .put("samsung_data_type",type.name)
  .put("sdk_schema_version",SAMSUNG_SDK_SCHEMA_VERSION)
  .put("aggregate_operation",operation)
  .putOpt("started_at",start)
  .putOpt("ended_at",end)
  .put("value",jsonValue(value))

@Suppress("UNCHECKED_CAST")
private fun healthFields(type:DataType,point:HealthDataPoint)=JSONObject().also{json->type.allFields.forEach{field->
  runCatching{point.getValue(field as Field<Any?>)}.getOrNull()?.let{json.put(field.name,jsonValue(it))}
}}

@Suppress("UNCHECKED_CAST")
private fun userFields(type:DataType,point:UserDataPoint)=JSONObject().also{json->type.allFields.forEach{field->
  runCatching{point.getValue(field as Field<Any?>)}.getOrNull()?.let{json.put(field.name,jsonValue(it))}
}}

private fun jsonValue(value:Any?):Any=when(value){
  null->JSONObject.NULL
  is String,is Boolean,is Int,is Long,is Float,is Double,is Short,is Byte->value
  is Number->value.toString()
  is Enum<*>->value.name
  is Duration->value.toString()
  is TemporalAccessor->value.toString()
  is Iterable<*>->JSONArray().also{array->value.forEach{array.put(jsonValue(it))}}
  is Array<*>->JSONArray().also{array->value.forEach{array.put(jsonValue(it))}}
  is Map<*,*>->JSONObject().also{json->value.forEach{(key,item)->if(key!=null)json.put(key.toString(),jsonValue(item))}}
  is HeartRate->JSONObject().put("heart_rate",value.heartRate).put("min",value.min).put("max",value.max).put("start_time",value.startTime.toString()).put("end_time",value.endTime.toString())
  is OxygenSaturation->JSONObject().put("oxygen_saturation",value.oxygenSaturation).put("min",value.min).put("max",value.max).put("start_time",value.startTime.toString()).put("end_time",value.endTime.toString())
  is SkinTemperature->JSONObject().put("skin_temperature",value.skinTemperature).put("min",value.min).put("max",value.max).put("start_time",value.startTime.toString()).put("end_time",value.endTime.toString())
  is BloodGlucose->JSONObject().put("glucose",value.glucose).put("timestamp",value.timestamp.toString())
  is SleepSession.SleepStage->JSONObject().put("start_time",value.startTime.toString()).put("end_time",value.endTime.toString()).put("stage",value.stage.name)
  is SleepSession->JSONObject().put("start_time",value.startTime.toString()).put("end_time",value.endTime.toString()).put("duration",value.duration.toString()).put("stages",jsonValue(value.stages))
  is ExerciseLocation->JSONObject().put("timestamp",value.timestamp.toString()).put("longitude",value.longitude).put("latitude",value.latitude).putOpt("altitude",value.altitude).putOpt("accuracy",value.accuracy)
  is ExerciseLog->JSONObject().put("timestamp",value.timestamp.toString()).putOpt("heart_rate",value.heartRate).putOpt("cadence",value.cadence).putOpt("count",value.count).putOpt("power",value.power).putOpt("speed",value.speed)
  is SwimmingLog.SwimmingInterval->JSONObject().put("duration",value.duration.toString()).put("stroke_count",value.strokeCount).put("interval",value.interval).put("stroke_type",value.strokeType.name)
  is SwimmingLog->JSONObject().put("pool_length",value.poolLength).put("pool_length_unit",value.poolLengthUnit).putOpt("total_distance",value.totalDistance).put("total_duration",value.totalDuration.toString()).put("intervals",jsonValue(value.swimmingIntervals))
  is ExerciseSession->exerciseSession(value)
  else->JSONObject().put("class_name",value.javaClass.name).put("value",value.toString())
}

private fun exerciseSession(value:ExerciseSession)=JSONObject()
  .put("start_time",value.startTime.toString()).put("end_time",value.endTime.toString()).put("duration",value.duration.toString())
  .putOpt("custom_title",value.customTitle).putOpt("distance_m",value.distance).put("calories_kcal",value.calories)
  .putOpt("altitude_gain_m",value.altitudeGain).putOpt("altitude_loss_m",value.altitudeLoss).putOpt("count",value.count)
  .putOpt("max_speed_mps",value.maxSpeed).putOpt("mean_speed_mps",value.meanSpeed)
  .putOpt("max_calorie_burn_rate",value.maxCalorieBurnRate).putOpt("mean_calorie_burn_rate",value.meanCalorieBurnRate)
  .putOpt("max_cadence",value.maxCadence).putOpt("mean_cadence",value.meanCadence)
  .putOpt("max_heart_rate",value.maxHeartRate).putOpt("mean_heart_rate",value.meanHeartRate).putOpt("min_heart_rate",value.minHeartRate)
  .putOpt("max_altitude_m",value.maxAltitude).putOpt("min_altitude_m",value.minAltitude)
  .putOpt("incline_distance_m",value.inclineDistance).putOpt("decline_distance_m",value.declineDistance)
  .putOpt("max_power_w",value.maxPower).putOpt("mean_power_w",value.meanPower).putOpt("max_rpm",value.maxRpm).putOpt("mean_rpm",value.meanRpm)
  .putOpt("comment",value.comment).putOpt("vo2_max",value.vo2Max).putOpt("auto_detected",value.autoDetected)
  .putOpt("exercise_type",value.exerciseType?.name).putOpt("count_type",value.countType?.name)
  .putOpt("swimming_log",value.swimmingLog?.let(::jsonValue)).put("route",jsonValue(value.route)).put("log",jsonValue(value.log))

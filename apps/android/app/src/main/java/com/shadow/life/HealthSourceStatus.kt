package com.shadow.life

private fun actionableHealthSourceTypes(healthConnectEnabled:Boolean)=
  if(healthConnectEnabled)setOf("health_connect","samsung","scale") else setOf("samsung","scale")

internal fun isActionableHealthSource(sourceType:String,healthConnectEnabled:Boolean=HealthConnectSync.enabled()):Boolean=
  sourceType in actionableHealthSourceTypes(healthConnectEnabled)

internal fun healthSourceNeedsAttention(sourceType:String,permissionState:String,cursorStates:Iterable<String>,healthConnectEnabled:Boolean=HealthConnectSync.enabled()):Boolean=
  isActionableHealthSource(sourceType,healthConnectEnabled)&&(permissionState!="granted"||cursorStates.any{it!="active"})

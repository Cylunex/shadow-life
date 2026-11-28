package com.shadow.life

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object LifeColors {
  val BackgroundDark=Color(0xFF0C100E)
  val SurfaceDark=Color(0xFF161B18)
  val RaisedDark=Color(0xFF202722)
  val InputDark=Color(0xFF161B18)
  val TextDark=Color(0xFFEDF2EB)
  val SecondaryDark=Color(0xFFB8C3B9)
  val MutedDark=Color(0xFFA3AEA4)
  val OutlineDark=Color(0xFF859289)
  val AccentDark=Color(0xFFB5D999)
  val OnAccentDark=Color(0xFF19331E)
  val AccentContainerDark=Color(0xFF293E2C)
  val InformationDark=Color(0xFF9FCFEA)
  val WarmDark=Color(0xFFE4BB91)
  val ReflectionDark=Color(0xFFF7C5E3)
  val ErrorDark=Color(0xFFFF9E9E)
  val BackgroundLight=Color(0xFFF4F6F0)
  val SurfaceLight=Color(0xFFFFFFFF)
  val RaisedLight=Color(0xFFEBF0E7)
  val InputLight=Color(0xFFEEF2EA)
  val TextLight=Color(0xFF1A251E)
  val SecondaryLight=Color(0xFF4E5E53)
  val MutedLight=Color(0xFF58665C)
  val OutlineLight=Color(0xFF738175)
  val AccentLight=Color(0xFF2E6042)
  val OnAccentLight=Color.White
  val AccentContainerLight=Color(0xFFDBEBD5)
  val InformationLight=Color(0xFF276583)
  val WarmLight=Color(0xFF9A521B)
  val ReflectionLight=Color(0xFF963D70)
  val ErrorLight=Color(0xFFA63426)
}

private val dark = darkColorScheme(
  primary=LifeColors.AccentDark,
  onPrimary=LifeColors.OnAccentDark,
  primaryContainer=LifeColors.AccentContainerDark,
  onPrimaryContainer=LifeColors.TextDark,
  secondary=LifeColors.InformationDark,
  tertiary=LifeColors.WarmDark,
  background=LifeColors.BackgroundDark,
  onBackground=LifeColors.TextDark,
  surface=LifeColors.SurfaceDark,
  onSurface=LifeColors.TextDark,
  surfaceVariant=LifeColors.RaisedDark,
  onSurfaceVariant=LifeColors.SecondaryDark,
  outline=LifeColors.OutlineDark,
  error=LifeColors.ErrorDark,
  surfaceContainer=LifeColors.RaisedDark,
  errorContainer=Color(0xFF452B30),
  onErrorContainer=Color(0xFFFFDADD),
  secondaryContainer=Color(0xFF203F50),
  onSecondaryContainer=Color(0xFFD8EDF9),
  onSecondary=Color(0xFF103549),
  tertiaryContainer=Color(0xFF403226),
  onTertiaryContainer=LifeColors.TextDark,
  surfaceContainerLowest=Color(0xFF0C100E),
  surfaceContainerLow=Color(0xFF121713),
  surfaceContainerHigh=Color(0xFF202722),
  surfaceContainerHighest=Color(0xFF2B332D),
  surfaceDim=LifeColors.BackgroundDark,
  surfaceBright=LifeColors.RaisedDark,
  outlineVariant=Color(0xFF465148),
  surfaceTint=LifeColors.AccentDark
)
private val light = lightColorScheme(
  primary=LifeColors.AccentLight,
  onPrimary=LifeColors.OnAccentLight,
  primaryContainer=LifeColors.AccentContainerLight,
  onPrimaryContainer=LifeColors.TextLight,
  secondary=LifeColors.InformationLight,
  tertiary=LifeColors.WarmLight,
  background=LifeColors.BackgroundLight,
  onBackground=LifeColors.TextLight,
  surface=LifeColors.SurfaceLight,
  onSurface=LifeColors.TextLight,
  surfaceVariant=LifeColors.RaisedLight,
  onSurfaceVariant=LifeColors.SecondaryLight,
  outline=LifeColors.OutlineLight,
  error=LifeColors.ErrorLight,
  surfaceContainer=LifeColors.RaisedLight,
  errorContainer=Color(0xFFFBE9E8),
  onErrorContainer=Color(0xFF792D2C),
  secondaryContainer=Color(0xFFD8EDF9),
  onSecondaryContainer=Color(0xFF143A4F),
  onSecondary=Color.White,
  tertiaryContainer=Color(0xFFF5E4D4),
  onTertiaryContainer=LifeColors.TextLight,
  surfaceContainerLowest=Color.White,
  surfaceContainerLow=Color(0xFFEEF2EA),
  surfaceContainerHigh=Color(0xFFEBF0E7),
  surfaceContainerHighest=Color(0xFFE2E8DF),
  surfaceDim=Color(0xFFDCE2D9),
  surfaceBright=Color.White,
  outlineVariant=Color(0xFFBEC9BD),
  surfaceTint=LifeColors.AccentLight
)
private val typography=Typography(
  headlineLarge=TextStyle(fontSize=30.sp,lineHeight=38.sp,fontWeight=FontWeight.SemiBold),
  headlineMedium=TextStyle(fontSize=24.sp,lineHeight=32.sp,fontWeight=FontWeight.SemiBold),
  titleLarge=TextStyle(fontSize=18.sp,lineHeight=26.sp,fontWeight=FontWeight.SemiBold),
  titleMedium=TextStyle(fontSize=16.sp,lineHeight=24.sp,fontWeight=FontWeight.Medium),
  bodySmall=TextStyle(fontSize=13.sp,lineHeight=19.sp),labelSmall=TextStyle(fontSize=12.sp,lineHeight=17.sp),
  bodyLarge=TextStyle(fontSize=16.sp,lineHeight=24.sp),bodyMedium=TextStyle(fontSize=14.sp,lineHeight=20.sp),labelLarge=TextStyle(fontSize=14.sp,lineHeight=20.sp,fontWeight=FontWeight.Medium),labelMedium=TextStyle(fontSize=13.sp,lineHeight=18.sp)
)

class AppearanceStore(context:Context){
  private val preferences=context.getSharedPreferences("life_appearance",Context.MODE_PRIVATE)
  fun current():Appearance=runCatching{Appearance.valueOf(preferences.getString("appearance",null)?:Appearance.Dark.name)}.getOrDefault(Appearance.Dark)
  fun save(value:Appearance){preferences.edit().putString("appearance",value.name).apply()}
}

@Composable fun LifeTheme(appearance:Appearance,content:@Composable ()->Unit){
  val useDark=appearance==Appearance.Dark||(appearance==Appearance.System&&isSystemInDarkTheme())
  MaterialTheme(colorScheme=if(useDark)dark else light,typography=typography,shapes=Shapes(small=RoundedCornerShape(12.dp),medium=RoundedCornerShape(18.dp),large=RoundedCornerShape(20.dp),extraLarge=RoundedCornerShape(24.dp)),content=content)
}

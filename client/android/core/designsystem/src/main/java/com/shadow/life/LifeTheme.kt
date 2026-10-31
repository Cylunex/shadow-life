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
  val BackgroundDark=Color(0xFF000000);val SurfaceDark=Color(0xFF101012);val RaisedDark=Color(0xFF171719);val InputDark=Color(0xFF101012)
  val TextDark=Color(0xFFF1F1F3);val SecondaryDark=Color(0xFFB2B3BC);val MutedDark=Color(0xFF9B9DA8);val OutlineDark=Color(0xFF42434A)
  val AccentDark=Color(0xFFB9EF68);val OnAccentDark=Color(0xFF173F2B);val AccentContainerDark=Color(0xFF18301D)
  val InformationDark=Color(0xFFDCD1FF);val WarmDark=Color(0xFFFFD39C);val ReflectionDark=Color(0xFFF7C5E3);val ErrorDark=Color(0xFFFF9E9E)
  val BackgroundLight=Color(0xFFFFF9F1);val SurfaceLight=Color(0xFFFFFFFF);val RaisedLight=Color(0xFFF3EEE7);val InputLight=Color(0xFFF3F3F1)
  val TextLight=Color(0xFF202124);val SecondaryLight=Color(0xFF60636D);val MutedLight=Color(0xFF696C75);val OutlineLight=Color(0xFFDADBD9)
  val AccentLight=Color(0xFF286B36);val OnAccentLight=Color.White;val AccentContainerLight=Color(0xFFDCF3C3)
  val InformationLight=Color(0xFF6850A1);val WarmLight=Color(0xFF9A521B);val ReflectionLight=Color(0xFF963D70);val ErrorLight=Color(0xFFA63426)
}

private val dark=darkColorScheme(primary=LifeColors.AccentDark,onPrimary=LifeColors.OnAccentDark,primaryContainer=LifeColors.AccentContainerDark,onPrimaryContainer=LifeColors.TextDark,secondary=LifeColors.InformationDark,tertiary=LifeColors.WarmDark,background=LifeColors.BackgroundDark,onBackground=LifeColors.TextDark,surface=LifeColors.SurfaceDark,onSurface=LifeColors.TextDark,surfaceVariant=LifeColors.RaisedDark,onSurfaceVariant=LifeColors.SecondaryDark,outline=LifeColors.OutlineDark,error=LifeColors.ErrorDark,surfaceContainer=LifeColors.RaisedDark,errorContainer=Color(0xFF452B30),onErrorContainer=Color(0xFFFFDADD),
  secondaryContainer=Color(0xFF231B34),onSecondaryContainer=LifeColors.TextDark,onSecondary=LifeColors.OnAccentDark,
  tertiaryContainer=Color(0xFF302319),onTertiaryContainer=LifeColors.TextDark,
  surfaceContainerLowest=Color(0xFF000000),surfaceContainerLow=Color(0xFF080809),surfaceContainerHigh=Color(0xFF171719),surfaceContainerHighest=Color(0xFF202023),surfaceDim=LifeColors.BackgroundDark,surfaceBright=LifeColors.RaisedDark,
  outlineVariant=LifeColors.OutlineDark,surfaceTint=LifeColors.AccentDark)
private val light=lightColorScheme(primary=LifeColors.AccentLight,onPrimary=LifeColors.OnAccentLight,primaryContainer=LifeColors.AccentContainerLight,onPrimaryContainer=LifeColors.TextLight,secondary=LifeColors.InformationLight,tertiary=LifeColors.WarmLight,background=LifeColors.BackgroundLight,onBackground=LifeColors.TextLight,surface=LifeColors.SurfaceLight,onSurface=LifeColors.TextLight,surfaceVariant=LifeColors.RaisedLight,onSurfaceVariant=LifeColors.SecondaryLight,outline=LifeColors.OutlineLight,error=LifeColors.ErrorLight,surfaceContainer=LifeColors.RaisedLight,errorContainer=Color(0xFFFBE9E8),onErrorContainer=Color(0xFF792D2C),
  secondaryContainer=Color(0xFFE8EDF4),onSecondaryContainer=LifeColors.TextLight,onSecondary=Color.White,
  tertiaryContainer=Color(0xFFF2EBE1),onTertiaryContainer=LifeColors.TextLight,
  surfaceContainerLowest=Color.White,surfaceContainerLow=Color(0xFFF3F3F1),surfaceContainerHigh=Color(0xFFF3EEE7),surfaceContainerHighest=Color(0xFFE7E7E5),surfaceDim=Color(0xFFE4E4E2),surfaceBright=Color.White,
  outlineVariant=LifeColors.OutlineLight,surfaceTint=LifeColors.AccentLight)
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

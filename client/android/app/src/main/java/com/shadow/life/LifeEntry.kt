package com.shadow.life

import android.content.Context
import android.content.Intent

/** Entry points a native Android host can open before or after the Life account signs in. */
enum class LifeEntry {
  Home, QuickRecord, Services;

  fun intent(context: Context): Intent = Intent(context, MainActivity::class.java)
    .putExtra(EXTRA_ENTRY, name)

  companion object {
    internal const val EXTRA_ENTRY = "com.shadow.life.extra.ENTRY"
    internal fun fromName(value: String?) = entries.firstOrNull { it.name == value }
  }
}

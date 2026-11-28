package com.shadow.life

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import java.time.YearMonth

@Composable fun LifeSearchBar(
  value: String,
  onValueChange: (String) -> Unit,
  hint: String,
  modifier: Modifier = Modifier,
  onSearch: ((String) -> Unit)? = null
) {
  val focus = LocalFocusManager.current
  fun submit() {
    onSearch?.invoke(value.trim())
    focus.clearFocus()
  }
  val fill = MaterialTheme.colorScheme.surfaceContainer
  val clearAction: (@Composable () -> Unit)? = if (value.isEmpty()) null else ({
    IconButton(onClick = { onValueChange("") }) { Icon(Icons.Default.Close, "清空搜索") }
  })
  OutlinedTextField(
    value = value, onValueChange = onValueChange, modifier = modifier.fillMaxWidth().semantics { contentDescription = hint },
    singleLine = true, shape = RoundedCornerShape(16.dp),
    placeholder = { Text(hint) },
    leadingIcon = {
      if (onSearch == null) Icon(Icons.Default.Search, null)
      else IconButton(onClick = ::submit) { Icon(Icons.Default.Search, "搜索") }
    },
    trailingIcon = clearAction,
    colors = OutlinedTextFieldDefaults.colors(
      focusedContainerColor = fill, unfocusedContainerColor = fill,
      unfocusedBorderColor = Color.Transparent, focusedBorderColor = MaterialTheme.colorScheme.primary
    ),
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions = KeyboardActions(onSearch = { submit() })
  )
}

@Composable fun LifeMonthBar(
  month: YearMonth, onMonth: (YearMonth) -> Unit, enabled: Boolean = true,
  lastMonth: YearMonth = YearMonth.of(9999, 12), extra: (@Composable () -> Unit)? = null
) {
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    LifePeriodArrow(false, "上月", enabled && month > YearMonth.of(1, 1)) { onMonth(month.minusMonths(1)) }
    Text(month.toString(), modifier = Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.titleMedium)
    LifePeriodArrow(true, "下月", enabled && month < lastMonth) { onMonth(month.plusMonths(1)) }
    Spacer(Modifier.weight(1f))
    extra?.invoke()
  }
}

@Composable fun LifePeriodArrow(forward: Boolean, label: String, enabled: Boolean = true, onClick: () -> Unit) {
  FilledTonalIconButton(onClick = onClick, enabled = enabled) {
    Icon(if (forward) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.AutoMirrored.Filled.KeyboardArrowLeft, label)
  }
}

@Composable fun LifeActionRow(label: String, icon: ImageVector, expanded: Boolean? = null, onClick: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  Row(
    Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick)
      .semantics { if (expanded != null) stateDescription = if (expanded) "已展开" else "已收起" }
      .heightIn(min = 48.dp),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)
  ) {
    Icon(icon, null, tint = colors.secondary)
    Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
    val arrow = when (expanded) {
      true -> Icons.Default.KeyboardArrowUp
      false -> Icons.Default.KeyboardArrowDown
      null -> Icons.AutoMirrored.Filled.KeyboardArrowRight
    }
    Icon(arrow, null, tint = colors.onSurfaceVariant)
  }
}

@Composable fun LifeTextAction(onClick: () -> Unit, content: @Composable () -> Unit) {
  Box(Modifier.clickable(role = Role.Button, onClick = onClick).sizeIn(minWidth = 48.dp, minHeight = 48.dp)
    .padding(end = 8.dp), contentAlignment = Alignment.CenterStart) {
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.primary) {
      ProvideTextStyle(MaterialTheme.typography.labelLarge, content)
    }
  }
}

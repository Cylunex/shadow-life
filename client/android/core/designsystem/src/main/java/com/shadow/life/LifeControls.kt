package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
    value = value, onValueChange = onValueChange, modifier = modifier.fillMaxWidth(),
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
    FilledTonalIconButton(onClick = { onMonth(month.minusMonths(1)) }, enabled = enabled && month > YearMonth.of(1, 1)) {
      Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "上月")
    }
    Text(month.toString(), modifier = Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.titleMedium)
    FilledTonalIconButton(onClick = { onMonth(month.plusMonths(1)) }, enabled = enabled && month < lastMonth) {
      Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "下月")
    }
    Spacer(Modifier.weight(1f))
    extra?.invoke()
  }
}

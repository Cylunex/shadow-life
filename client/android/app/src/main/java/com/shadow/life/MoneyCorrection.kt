package com.shadow.life

// Only fields exposed by this editor can be cleared. Payment method and the
// precise transaction time are omitted so the server preserves their values.
internal fun moneyCorrectionClearFields(seed:EditSeed.Money,draft:CorrectionDraft):List<String> = buildList {
  if(!seed.category.isNullOrBlank()&&draft.secondary.isBlank())add("category")
  if(!seed.counterparty.isNullOrBlank()&&draft.option.isBlank())add("counterparty")
  if(!seed.note.isNullOrBlank()&&draft.note.isBlank())add("note")
}

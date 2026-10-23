package com.shadow.life

/** Keep an already displayed snapshot mounted while reading the same resource again. */
fun <T> LoadState<T>.beginRefresh(sameResource:Boolean=true):LoadState<T> =
  if(sameResource&&this is LoadState.Ready)copy(refreshing=true,refreshError=null,updateAvailable=false) else LoadState.Loading

fun <T> LoadState<T>.finishRefresh(result:LoadState<T>):LoadState<T> = when{
  this is LoadState.Ready&&result is LoadState.Failed->copy(refreshing=false,refreshError=result.message)
  this is LoadState.Ready&&result is LoadState.Ready->result.copy(updateAvailable=updateAvailable||result.updateAvailable)
  else->result
}

/** Lists and open details stay at the user's snapshot until they choose to apply new content. */
fun <T> LoadState<T>.noticeUpdate():LoadState<T> =
  if(this is LoadState.Ready)copy(updateAvailable=true) else this

/** A shorter terminal page also signals removals; an empty head is not equal to a populated list. */
fun <T> samePageHead(loaded:List<T>,fresh:List<T>,nextCursor:String?):Boolean =
  loaded.take(fresh.size)==fresh&&(nextCursor!=null||loaded.size==fresh.size)

/** Cross-domain receipts can affect more than the capability's prefix domain. */
fun affectedReadDomains(capabilities:Set<String>):Set<LifeDomain> = capabilities.flatMap{capability->when{
  capability.startsWith("health.")->listOf(LifeDomain.Health)
  capability.startsWith("money.")->listOf(LifeDomain.Money,LifeDomain.Meals)
  capability.startsWith("travel.")->listOf(LifeDomain.Travel)
  capability.startsWith("library.")->listOf(LifeDomain.Library)
  capability.startsWith("life.")->listOf(LifeDomain.Meals,LifeDomain.Money)
  else->emptyList()
}}.toSet()

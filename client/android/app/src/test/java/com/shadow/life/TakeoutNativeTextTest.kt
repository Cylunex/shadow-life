package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class TakeoutNativeTextTest {
 private fun box(text:String,y:Int=200,x:Int=200,w:Int=200,h:Int=35)=OrderTextBox(x,y,w,h,text)
 private class Node(override val text:String?=null,override val description:String?=null,override val bounds:OrderTextBox=OrderTextBox(100,200,200,35,""),override val visible:Boolean=true,override val editable:Boolean=false,override val secret:Boolean=false,val children:List<Node> = emptyList()):TakeoutTextNode {
  override val childCount get()=children.size
  override fun child(index:Int)=children[index]
  var released=false;override fun release(){released=true}
 }
 @Test fun readsLeafDescriptionsAndPreservesRepeatedRows(){
  val first=Node("×1",bounds=box("",300));val second=Node(description="×1",bounds=box("",500))
  val root=Node("×1 ×1",children=listOf(first,second));val boxes=readTakeoutNodeBoxes(root,1080,2400)!!
  assertEquals(listOf("×1","×1"),boxes.map{it.text});assertEquals(listOf(300,500),boxes.map{it.y})
  assertTrue(root.released&&first.released&&second.released)
 }
 @Test fun rejectsAuthenticationAndIncompleteTreesAndSkipsBroadDescriptions(){
  val secret=Node("hidden",secret=true);val root=Node(children=listOf(secret))
  assertNull(readTakeoutNodeBoxes(root,1080,2400));assertTrue(root.released&&secret.released)
  assertNull(readTakeoutNodeBoxes(Node("input",editable=true),1080,2400))
  assertNull(readTakeoutNodeBoxes(Node(children=List(101){Node("too many")}),1080,2400))
  assertTrue(readTakeoutNodeBoxes(Node("商品\n实付¥10",bounds=box("",200,w=900,h=600)),1080,2400)!!.isEmpty())
 }
 @Test fun joinsSplitCurrencyQuantityAndFractionWithoutMergingDifferentRows(){
  val rows=listOf(box("¥",x=800,w=20),box("0",x=825,w=25),box("×",y=250,x=200,w=20),box("1",y=250,x=225,w=20),box("¥",y=400,x=800,w=20),box("19",y=400,x=825,w=40),box(".98",y=400,x=870,w=50))
  assertEquals(setOf("¥0","×1","¥19.98"),joinTakeoutNumericRuns(rows).map{it.text}.toSet())
 }
 @Test fun nativeOnlyMissingZeroAndRepeatedAmountsStayDistinct(){
  val first=Node("¥0",bounds=box("",200,900,60));val second=Node("¥0",bounds=box("",400,900,60))
  assertEquals(listOf("¥0","¥0"),readTakeoutNodeBoxes(Node(children=listOf(first,second)),1080,2400)!!.map{it.text})
 }
}

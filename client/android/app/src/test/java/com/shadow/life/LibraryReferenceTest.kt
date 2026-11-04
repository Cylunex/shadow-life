package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class LibraryReferenceTest {
  @Test fun acceptsOnlyCanonicalLibraryReferencesAndPositiveRevisions(){
    val base="shadow://life/library/library_123"
    assertEquals(LibraryReference("library_123",null),LibraryReference.parse(base))
    assertEquals(LibraryReference("library_123",2),LibraryReference.parse("$base?revision=2"))
    for(bad in listOf("$base?account=owner","$base?revision=2&server=other","$base?revision=0","$base?revision=4294967296","$base#edit","$base/..","shadow://owner@life/library/library_123","shadow://life:80/library/library_123","shadow://life/library/%2e%2e")){
      assertNull(bad,LibraryReference.parse(bad))
    }
  }
  @Test fun staleArchivedOrWrongItemsNeverDisplay(){
    val ref=LibraryReference("library_123",2)
    ref.verify("library_123",2,"active")
    assertThrows(IllegalStateException::class.java){ref.verify("library_123",3,"active")}
    assertThrows(IllegalStateException::class.java){ref.verify("library_123",2,"archived")}
    assertThrows(IllegalStateException::class.java){ref.verify("library_other",2,"active")}
  }
}

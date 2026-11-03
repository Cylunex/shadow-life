import { useEffect, useRef } from "react";

export function useModalFocus(active:boolean){
  const lastFocused=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const remember=(event:FocusEvent)=>{
      const target=event.target;
      if(target instanceof HTMLElement&&!target.closest('[role="dialog"]'))lastFocused.current=target;
    };
    document.addEventListener("focusin",remember);
    return()=>document.removeEventListener("focusin",remember);
  },[]);
  useEffect(()=>{
    if(!active)return;
    const previous=lastFocused.current;
    const dialogs=document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const dialog=dialogs.item(dialogs.length-1);
    if(!dialog)return;
    const focusables=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')).filter(element=>element.getClientRects().length>0&&!element.classList.contains("layer-scrim"));
    (dialog.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled)")??focusables()[0])?.focus();
    const listener=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        const close=dialog.querySelector<HTMLButtonElement>(".layer-scrim");
        close?.click();event.preventDefault();
      }
      if(event.key!=="Tab")return;
      const elements=focusables(),first=elements[0],last=elements.at(-1);
      if(!first){event.preventDefault();return;}
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){last?.focus();event.preventDefault();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){first.focus();event.preventDefault();}
    };
    document.addEventListener("keydown",listener);
    return()=>{document.removeEventListener("keydown",listener);if(previous?.isConnected)previous.focus();};
  },[active]);
}

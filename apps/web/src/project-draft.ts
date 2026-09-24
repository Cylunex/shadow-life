export function projectDraftKey(identityKey:string):string{return `life:project-draft:${identityKey}`;}
export function readProjectDraft(key:string,storage:Pick<Storage,"getItem">=localStorage,now=Date.now()):Record<string,unknown>|null{
  try{
    const raw=storage.getItem(key);if(!raw)return null;
    const value=JSON.parse(raw) as Record<string,unknown>;
    if(!value||typeof value!=="object"||Array.isArray(value)||typeof value.savedAt!=="number"||now-value.savedAt>30*86400000||value.savedAt>now+60000)return null;
    if(typeof value.title!=="string"||typeof value.goal!=="string"||!Array.isArray(value.milestones)||!Array.isArray(value.links))return null;
    return value;
  }catch{return null;}
}
export function writeProjectDraft(key:string,draft:Record<string,unknown>,storage:Pick<Storage,"setItem">=localStorage,now=Date.now()):boolean{
  try{storage.setItem(key,JSON.stringify({...draft,savedAt:now}));return true;}catch{return false;}
}

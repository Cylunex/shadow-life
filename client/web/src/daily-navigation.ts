export function offsetDate(day:string,days:number):string {
  const date=new Date(day+"T12:00:00Z");
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

export function weekStart(day:string):string {
  return offsetDate(day,-((new Date(day+"T12:00:00Z").getUTCDay()+6)%7));
}

export function dailyHref(section:"health"|"food",day:string,extra:Record<string,string>={}):string {
  return `?${new URLSearchParams({tab:"record",section,day,...extra})}`;
}

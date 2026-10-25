const dateTimeLocalPattern=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

export function formatInTimeZone(value:string|Date|undefined,timeZone:string):string{
  if(!value)return"";
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.valueOf()))return"";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??"";
  return`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function parseInTimeZone(value:string,timeZone:string):string{
  const match=dateTimeLocalPattern.exec(value);
  if(!match)throw new Error("请输入完整的本地日期和时间。");
  const [,year,month,day,hour,minute]=match;
  const wallTime=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute));
  let instant=wallTime;
  for(let attempt=0;attempt<4;attempt+=1){
    const rendered=formatInTimeZone(new Date(instant),timeZone);
    const renderedMatch=dateTimeLocalPattern.exec(rendered);
    if(!renderedMatch)break;
    const renderedWall=Date.UTC(Number(renderedMatch[1]),Number(renderedMatch[2])-1,Number(renderedMatch[3]),Number(renderedMatch[4]),Number(renderedMatch[5]));
    const correction=wallTime-renderedWall;
    instant+=correction;
    if(correction===0)break;
  }
  const result=new Date(instant);
  if(formatInTimeZone(result,timeZone)!==value)throw new Error(`“${value}”在 ${timeZone} 不是有效的当地时间。`);
  return result.toISOString();
}

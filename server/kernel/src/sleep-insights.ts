export type SleepInsightNight={wake_date:string;time_zone:string;started_at:string|null;ended_at:string|null;total_minutes:number;deep_minutes:number|null;rem_minutes:number|null;source_type:string};

function localBedtime(instant:string,zone:string):number|null{
  try{
    const parts=new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant));
    const hour=Number(parts.find(part=>part.type==="hour")?.value),minute=Number(parts.find(part=>part.type==="minute")?.value);
    return Number.isFinite(hour)&&Number.isFinite(minute)?(hour*60+minute-720+1440)%1440:null;
  }catch{return null;}
}

export function buildSleepInsights(rows:SleepInsightNight[],from:string,to:string){
  const valid=rows.filter(row=>row.total_minutes>0);
  const bedtimes=valid.map(row=>row.started_at?localBedtime(row.started_at,row.time_zone):null).filter((value):value is number=>value!==null);
  const mean=bedtimes.length>=3?bedtimes.reduce((sum,value)=>sum+value,0)/bedtimes.length:null;
  const inBed=valid.map(row=>row.started_at&&row.ended_at?Math.round((Date.parse(row.ended_at)-Date.parse(row.started_at))/60000):null)
    .map((minutes,index)=>minutes!==null&&minutes>0&&minutes<=1440?{minutes,sleep:valid[index]!.total_minutes}:null).filter((value):value is {minutes:number;sleep:number}=>value!==null);
  const stages=(key:"deep_minutes"|"rem_minutes")=>valid.filter(row=>row[key]!==null);
  const fraction=(key:"deep_minutes"|"rem_minutes")=>{const known=stages(key),total=known.reduce((sum,row)=>sum+row.total_minutes,0);return total>0?Math.min(100,Math.round(known.reduce((sum,row)=>sum+row[key]!,0)*100/total)):null;};
  const avg=valid.length?Math.round(valid.reduce((sum,row)=>sum+row.total_minutes,0)/valid.length):null;
  const clock=mean===null?null:Math.round(mean+720)%1440;
  return {from,to,nights:valid.length,bedtime_nights:bedtimes.length,average_minutes:avg,at_least_seven_hours:valid.filter(row=>row.total_minutes>=420).length,
    average_efficiency_percent:inBed.length?Math.round(inBed.reduce((sum,row)=>sum+Math.min(100,row.sleep*100/row.minutes),0)/inBed.length):null,
    efficiency_nights:inBed.length,deep_percent:fraction("deep_minutes"),rem_percent:fraction("rem_minutes"),
    average_bedtime:clock===null?null:`${String(Math.floor(clock/60)).padStart(2,"0")}:${String(clock%60).padStart(2,"0")}`,
    bedtime_variation_minutes:mean===null?null:Math.round(Math.sqrt(bedtimes.reduce((sum,value)=>sum+(value-mean)**2,0)/bedtimes.length)),
    source_types:[...new Set(valid.map(row=>row.source_type))].sort(),as_of:new Date().toISOString()};
}

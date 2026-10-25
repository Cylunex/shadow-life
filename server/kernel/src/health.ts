function decimalParts(value: string): { integer: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) throw new Error(`Invalid decimal: ${value}`);
  const fraction = match[3] ?? "";
  return { integer: BigInt(`${match[1] ?? ""}${match[2]}${fraction}`), scale: fraction.length };
}

function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left), b = decimalParts(right), scale = Math.max(a.scale, b.scale);
  const leftInteger = a.integer * 10n ** BigInt(scale - a.scale);
  const rightInteger = b.integer * 10n ** BigInt(scale - b.scale);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

const workoutLabels:Readonly<Record<string,string>>={
  walk:"健走",walking:"健走",brisk_walking:"健走",run:"跑步",running:"跑步",track_running:"田径跑",jogging:"慢跑",
  treadmill:"跑步机",treadmill_running:"跑步机跑步",running_treadmill:"跑步机跑步",walking_treadmill:"跑步机健走",
  cycling:"自行车",biking:"自行车",stationary_biking:"室内自行车",indoor_cycling:"室内自行车",mountain_biking:"山地自行车",
  hiking:"徒步",backpacking:"旅行徒步",swimming:"游泳",pool_swimming:"游泳",open_water_swimming:"户外游泳",
  circuit_training:"循环训练",strength_training:"力量训练",weight_training:"力量训练",weightlifting:"举重",weight_machine:"器械训练",
  hiit:"高强度间歇训练",elliptical:"椭圆机",rowing:"划船",rowing_machine:"划船机",stair_climbing:"爬楼梯",
  stair_climbing_machine:"登阶机",step_machine:"踏步机",yoga:"瑜伽",pilates:"普拉提",stretching:"拉伸",
  dancing:"舞蹈",dance:"舞蹈",aerobics:"有氧操",jump_rope:"跳绳",soccer:"足球",football:"足球",
  basketball:"篮球",badminton:"羽毛球",tennis:"网球",table_tennis:"乒乓球",other:"其他运动"
};

export function workoutSessionLabel(value:string):string{
  const trimmed=value.trim(),key=trimmed.toLowerCase().replace(/[ -]/gu,"_");
  return workoutLabels[key]??(/[^\u0000-\u007f]/u.test(trimmed)?trimmed:`其他运动 · ${trimmed.replaceAll("_"," ")}`);
}

export function healthHabitLabel(value:string):string{return value.trim().toLowerCase()==="release"?"释放记录":value.trim().replaceAll("_"," ");}

export function reconcileActivityEnergy(deviceSummary: string | null, workoutSum: string | null): { caloriesKcal: string | null; source: "device_summary" | "workout_sum" | "equal" | null } {
  if (deviceSummary === null && workoutSum === null) return { caloriesKcal: null, source: null };
  if (deviceSummary === null) return { caloriesKcal: workoutSum, source: "workout_sum" };
  if (workoutSum === null) return { caloriesKcal: deviceSummary, source: "device_summary" };
  const compared = compareDecimal(deviceSummary, workoutSum);
  if (compared === 0) return { caloriesKcal: deviceSummary, source: "equal" };
  return compared > 0 ? { caloriesKcal: deviceSummary, source: "device_summary" } : { caloriesKcal: workoutSum, source: "workout_sum" };
}

export type StepInterval={id:string;origin:string;started_at:string;ended_at:string;steps:number};
// Whole interval counts belong to their start date in the recorded zone. Do not invent a
// per-minute distribution across midnight. Within an origin choose the maximum non-overlapping
// set; across origins (and legacy device totals) choose a single greatest total, never their sum.
export function reconcileSteps(dailyTotal:number|null,intervals:readonly StepInterval[]){
  const byOrigin=new Map<string,StepInterval[]>();
  for(const interval of intervals){const group=byOrigin.get(interval.origin)??[];group.push(interval);byOrigin.set(interval.origin,group);}
  let steps=dailyTotal,selectedOrigin:string|null=null;
  for(const [origin,group] of [...byOrigin.entries()].sort(([a],[b])=>a.localeCompare(b))){
    group.sort((a,b)=>Date.parse(a.ended_at)-Date.parse(b.ended_at)||a.id.localeCompare(b.id));
    const totals=[0];
    for(let i=0;i<group.length;i++){
      const current=group[i]!;let low=0,high=i;
      while(low<high){const mid=Math.floor((low+high)/2);if(Date.parse(group[mid]!.ended_at)<=Date.parse(current.started_at))low=mid+1;else high=mid;}
      totals.push(Math.max(totals[i]!,totals[low]!+current.steps));
    }
    const total=totals.at(-1)!;if(steps===null||total>steps){steps=total;selectedOrigin=origin;}
  }
  return{steps,selected_origin:selectedOrigin,policy:"nonoverlap-origin-max-v1",day_attribution:"interval_start"};
}

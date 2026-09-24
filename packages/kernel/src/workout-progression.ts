export interface WorkoutProgressionSession {id:string;occurred_on:string;session_type:string;duration_minutes:number|null;rpe:number|null;revision:number}
export interface WorkoutProgressionPlan {id:string;title:string;revision:number;sessions:WorkoutProgressionSession[]}
export function buildWorkoutProgression(plans:WorkoutProgressionPlan[]){return {plans:plans.map(plan=>{
  const sessions=plan.sessions.slice(0,2),evidence=sessions.map(({id,occurred_on,session_type,duration_minutes,rpe,revision})=>({id,occurred_on,session_type,duration_minutes,rpe,revision}));
  if(!sessions.length)return {id:plan.id,title:plan.title,revision:plan.revision,status:"no_execution" as const,reason:"尚无关联此计划的实际训练记录",next_duration_minutes:null,evidence};
  if(sessions.length<2||sessions.some(session=>session.duration_minutes===null||session.duration_minutes===0||session.rpe===null)||sessions[0]!.session_type!==sessions[1]!.session_type||sessions[0]!.occurred_on===sessions[1]!.occurred_on)return{id:plan.id,title:plan.title,revision:plan.revision,status:"missing_data" as const,reason:"需要不同日期的两次同类型执行，并记录正时长和主观强度",next_duration_minutes:null,evidence};
  const latest=sessions[0]!,previous=sessions[1]!;
  if(latest.rpe!>7||previous.rpe!>7)return{id:plan.id,title:plan.title,revision:plan.revision,status:"hold" as const,reason:"最近两次有较高主观强度，建议维持当前时长并观察恢复",next_duration_minutes:latest.duration_minutes!,evidence};
  const increment=Math.max(1,Math.min(5,Math.round(latest.duration_minutes!*0.05)));
  return{id:plan.id,title:plan.title,revision:plan.revision,status:"increase_duration" as const,reason:`最近两次同类型训练的主观强度均不高于 7；下一次可尝试增加 ${increment} 分钟`,next_duration_minutes:latest.duration_minutes!+increment,evidence};
}),as_of:new Date().toISOString()};}

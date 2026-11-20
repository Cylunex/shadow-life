import {useEffect,useRef,useState} from "react";
import {healthRecordResultSchema} from "@shadow/contracts";
import {formatInTimeZone} from "./travel-time.js";

const stages={awake:"清醒",rem:"REM",light:"浅睡",deep:"深睡"} as const;
const colors={awake:"#e09a53",rem:"#bb89cb",light:"#8b8ae1",deep:"#7667cf"};
const lanes=Object.keys(stages) as Array<keyof typeof stages>;
const stamp=(value:string,zone:string)=>formatInTimeZone(new Date(value),zone).slice(11,16);
type HealthDetail=ReturnType<typeof healthRecordResultSchema.parse>;
type Night=Extract<HealthDetail,{kind:"sleep_session"}>["fact"];
type Workout=Extract<HealthDetail,{kind:"workout_session"}>["fact"];

export function HealthSessionCharts({value}:{value:unknown}){
  const result=healthRecordResultSchema.safeParse(value);
  if(!result.success)return null;
  const detail=result.data;
  if(detail.kind==="sleep_session")return <SleepIntervals key={detail.fact.id} fact={detail.fact}/>;
  if(detail.kind==="workout_session")return <WorkoutSeries key={detail.fact.id} fact={detail.fact}/>;
  return null;
}

function SleepIntervals({fact}:{fact:Night}){
  const intervals=fact.stage_intervals??[];
  const [position,setPosition]=useState(0);
  const index=Math.min(position,intervals.length-1);
  const selected=intervals[index];
  const score=fact.provider_sleep_score;
  if(!selected)return score===undefined?null:<p>三星睡眠评分 {score} / 100</p>;
  const first=intervals[0]!,last=intervals.at(-1)!;
  const start=Math.min(Date.parse(first.start),Date.parse(fact.started_at??first.start));
  const end=Math.max(Date.parse(last.end),Date.parse(fact.ended_at??last.end));
  const percent=(instant:string)=>100*(Date.parse(instant)-start)/Math.max(1,end-start);
  return <section className="session-chart">
    <h3>整晚睡眠阶段</h3>
    <p>{formatInTimeZone(new Date(start),fact.time_zone).replace("T"," ")} — {formatInTimeZone(new Date(end),fact.time_zone).replace("T"," ")}
      {score!==undefined&&<> · 三星睡眠评分 {score} / 100</>}</p>
    <div className="sleep-lanes" aria-hidden="true">
      {lanes.map(stage=><div className="sleep-lane" key={stage}><span>{stages[stage]}</span><div>
        {intervals.map((item,i)=>item.stage===stage&&<i key={item.start} className={i===index?"selected-segment":undefined}
          style={{left:`${percent(item.start)}%`,width:`${percent(item.end)-percent(item.start)}%`,background:colors[stage]}}/>)}
      </div></div>)}
    </div>
    <label>查看睡眠阶段<input type="range" min={0} max={Math.max(0,intervals.length-1)} value={index} disabled={intervals.length<2}
      aria-valuetext={`${stages[selected.stage]} ${stamp(selected.start,fact.time_zone)}至${stamp(selected.end,fact.time_zone)}`}
      onChange={event=>setPosition(Number(event.target.value))}/></label>
    <output>{stages[selected.stage]} · {stamp(selected.start,fact.time_zone)}–{stamp(selected.end,fact.time_zone)}</output>
  </section>;
}

type Point={time:number;x:number;y:number};
type Series="route"|"heart"|"speed";
const seriesNames:Record<Series,string>={route:"GPS 轨迹",heart:"心率",speed:"速度"};
function workoutPoints(fact:Workout,type:Series):Point[]{
  if(type==="route"){
    const route=fact.route_points??[];
    const latitude=route[0]?.latitude??0;
    let previous=route[0]?.longitude??0,longitude=0;
    return route.map(point=>{
      longitude+=((point.longitude-previous+540)%360-180)*Math.cos(latitude*Math.PI/180);
      previous=point.longitude;
      return{time:Date.parse(point.at),x:longitude,y:point.latitude-latitude};
    });
  }
  return(fact.exercise_samples??[]).flatMap(sample=>{
    const value=type==="heart"?sample.heart_rate:sample.speed_mps;
    const time=Date.parse(sample.at);
    return value===undefined?[]:[{time,x:time,y:type==="speed"?value*3.6:value}];
  });
}

function WorkoutSeries({fact}:{fact:Workout}){
  const [chosen,setChosen]=useState<Series>("route");
  const [time,setTime]=useState<number>();
  const [index,setIndex]=useState<number>();
  const series=(["route","heart","speed"] as const).map(type=>({type,points:workoutPoints(fact,type)})).filter(s=>s.points.length);
  const active=series.find(s=>s.type===chosen)??series[0];
  if(!active)return null;
  const initial=active.points.reduce((nearest,item,i)=>time!==undefined&&Math.abs(item.time-time)<Math.abs(active.points[nearest]!.time-time)?i:nearest,0);
  const selected=Math.min(index??initial,active.points.length-1), point=active.points[selected]!;
  const value=`${stamp(new Date(point.time).toISOString(),fact.time_zone)} · ${active.type==="route"?"轨迹点":`${new Intl.NumberFormat("zh-CN",{maximumFractionDigits:1}).format(point.y)} ${active.type==="heart"?"次/分":"km/h"}`}`;
  return <section className="session-chart">
    <h3>运动过程</h3>
    <div className="panel-actions" aria-label="运动过程指标">{series.map(({type})=><button className="secondary" type="button" key={type}
      aria-pressed={active.type===type} onClick={()=>{setChosen(type);setTime(point.time);setIndex(undefined);}}>{seriesNames[type]}</button>)}</div>
    <WorkoutPlot points={active.points} selected={selected} route={active.type==="route"}/>
    <label>查看采样点<input type="range" min={0} max={active.points.length-1} value={selected} disabled={active.points.length<2}
      aria-valuetext={value} onChange={event=>setIndex(Number(event.target.value))}/></label>
    <output>{value}</output>
  </section>;
}

function WorkoutPlot({points,selected,route}:{points:Point[];selected:number;route:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const node=canvas.current,ctx=node?.getContext("2d");
    if(!node||!ctx)return;
    function draw(){
      const box=node!.getBoundingClientRect(),width=Math.max(24,box.width),height=Math.max(24,box.height);
      const dpr=window.devicePixelRatio||1;
      node!.width=width*dpr;node!.height=height*dpr;
      ctx!.scale(dpr,dpr);
      const [minX,maxX,minY,maxY]=[
        Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.x)),
        Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.y))
      ];
      const scaleX=(width-24)/(maxX!-minX!),scaleY=(height-24)/(maxY!-minY!);
      const shared=Math.min(scaleX,scaleY);
      const scale=route?(Number.isFinite(shared)?shared:0):null;
      const x=(p:Point)=>width/2+(p.x-(minX!+maxX!)/2)*(scale??(Number.isFinite(scaleX)?scaleX:0));
      const y=(p:Point)=>height/2-(p.y-(minY!+maxY!)/2)*(scale??(Number.isFinite(scaleY)?scaleY:0));
      // A route with only one coordinate is centered.
      const place=(p:Point)=>[Number.isFinite(x(p))?x(p):width/2,Number.isFinite(y(p))?y(p):height/2] as const;
      ctx!.strokeStyle=ctx!.fillStyle=getComputedStyle(node!).color;
      ctx!.lineWidth=2;
      ctx!.beginPath();
      points.forEach((p,i)=>{
        if(i===0||p.time-points[i-1]!.time>300000)ctx!.moveTo(...place(p));else ctx!.lineTo(...place(p));
      });
      ctx!.stroke();
      ctx!.beginPath();
      ctx!.arc(...place(points[selected]!),5,0,Math.PI*2);ctx!.fill();
    }
    draw();
    const observer=new ResizeObserver(draw);
    observer.observe(node);
    return()=>observer.disconnect();
  },[points,selected,route]);
  return <canvas ref={canvas} aria-hidden="true" className="workout-plot"/>;
}

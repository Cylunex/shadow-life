import type { ReactNode } from "react";

type BatchRow = { id:string; batch_id?:string; domain?:string; kind?:string };

export function RecordBatches<T extends BatchRow>({rows,render}:{rows:readonly T[];render:(row:T)=>ReactNode}) {
  const groups=new Map<string,T[]>();
  for(const row of rows){
    const key=row.batch_id ? `batch:${row.batch_id}` : `record:${row.domain}:${row.kind}:${row.id}`;
    const group=groups.get(key);
    if(group)group.push(row);
    else groups.set(key,[row]);
  }
  return [...groups].map(([key,group])=>{
    const first=group[0]!;
    if(group.length===1)return render(first);
    const batch=first.batch_id!;
    const title=batch.startsWith("screenshot:")?"批量截图":batch.startsWith("scale:")?"体脂秤称重":
      batch.startsWith("samsung:")?"三星健康同步":group.every(row=>row.kind==="activity_capture")?"活动采集":
      group.every(row=>row.domain==="money")?"账单导入":group.every(row=>row.domain==="health")?"健康上报":"同批记录";
    return <li key={key}><details><summary>{title} · 已加载 {group.length} 条</summary><ol>{group.map(render)}</ol></details></li>;
  });
}

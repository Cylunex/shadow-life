export function formatMoneyAmount(value:unknown,currency?:unknown,sourceScale?:unknown):string{
  const raw=typeof value==="number"?String(value):typeof value==="string"?value:"",match=/^(-?)(\d+)(?:\.(\d+))?$/u.exec(raw.trim());
  if(!match)return raw;
  const fraction=match[3]??"",scale=Number.isInteger(sourceScale)&&Number(sourceScale)>=0&&Number(sourceScale)<=6?Number(sourceScale):currencyScale(currency),minimum=Math.min(scale,fraction.length);
  let keep=fraction.length;while(keep>minimum&&fraction[keep-1]==="0")keep--;
  const displayed=fraction.slice(0,keep).padEnd(scale,"0");
  return `${match[1]??""}${match[2]}${displayed?`.${displayed}`:""}`;
}

function currencyScale(currency:unknown):number{
  if(typeof currency!=="string"||!/^[A-Z]{3}$/u.test(currency))return 0;
  try{return new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().minimumFractionDigits??0;}catch{return 0;}
}

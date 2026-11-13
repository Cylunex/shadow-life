import {readTakeoutCapture} from "./takeout-order.js";
import type {EvidenceField} from "@shadow/contracts";

const labels:Record<EvidenceField,RegExp>={paid:/实付(?:金额)?|实际支付|实付款|支付成功/u,discount:/总优惠|优惠合计|已优惠/u,delivery:/配送费(?!优惠)/u};
const valuePattern=/[¥￥]?\s*(\d{1,12}(?:\.\d{1,2})?)(?![\d.])/gu;
function amounts(text:string){return [...text.matchAll(valuePattern)].map(match=>Number(match[1]).toFixed(2));}

/** Only pair spatial neighbors on the same displayed line. Ambiguous matches have no rectangle. */
export function locateOrderAmount(text:string,field:EvidenceField,expected?:string){
  const capture=readTakeoutCapture(text),pattern=labels[field];
  const matches:Array<{quote:string;amount:string;region:{x:number;y:number;width:number;height:number;image_width:number;image_height:number;space:"original_pixels"}|null}>=[];
  if(capture){
    for(const block of capture.blocks){
      const label=pattern.exec(block[4]);if(!label)continue;
      const inline=amounts(block[4].slice(label.index+label[0].length));
      const nearby=inline.length?[block]:capture.blocks.filter(b=>b[0]>block[0]&&Math.abs((b[1]+b[3]/2)-(block[1]+block[3]/2))<Math.min(b[3],block[3])*0.6);
      for(const candidate of nearby){
        for(const amount of (candidate===block?inline:amounts(candidate[4]))){
          if(expected!==undefined&&Number(amount)!==Number(expected))continue;
          matches.push({quote:(candidate===block?block[4]:block[4]+" "+candidate[4]).slice(0,500),amount,
            region:{x:candidate[0],y:candidate[1],width:candidate[2],height:candidate[3],image_width:capture.width,image_height:capture.height,space:"original_pixels"}});
        }
      }
    }
  }else{
    for(const line of text.split(/\r?\n/u)){
      const label=pattern.exec(line);if(!label)continue;
      for(const amount of amounts(line.slice(label.index+label[0].length))){
        if(expected===undefined||Number(expected)===Number(amount))matches.push({quote:line.slice(0,500),amount,region:null});
      }
    }
  }
  if(matches.length===1)return matches[0]!;
  if(!matches.length||new Set(matches.map(m=>m.amount)).size!==1)return null;
  return {quote:null,amount:matches[0]!.amount,region:null};
}

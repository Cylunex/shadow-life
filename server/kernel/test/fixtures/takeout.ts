import { takeoutPrefix } from "../../src/takeout-order.js";
export function takeoutFixture(second=false){
 const values=second?["0.81","0.76","20.14","0","0.05"]:["0.26","0.51","1.99","0.51","0.51","0.51","0","13.69"];
 const blocks:Array<[number,number,number,number,string]>=[];
 const put=(x:number,y:number,text:string,w=200)=>blocks.push([x,y,w,30,text]);
 put(50,20,"订单已送到指定位置",400);put(50,70,"闪购");put(200,70,"合成外卖店",400);put(800,70,"蜂鸟准时达");
 values.forEach((v,i)=>{const y=150+i*120;put(200,y,v==="0"?(second?"不要保温袋":"特辣"):`合成商品${i+1}`,400);put(200,y+40,"×1");put(800,y,`${v==="0"?"":"实付"}￥${v}`);put(800,y+40,"￥30.00");});
 const y=180+values.length*120;
 put(50,y,"打包费");put(800,y,second?"￥1.5":"￥2");put(50,y+80,"配送费");put(800,y+80,"实付￥0");put(800,y+120,"￥5.20");
 put(50,y+200,"价格明细");put(450,y+200,second?"总优惠￥27.48":"总优惠￥26.5",300);put(800,y+200,second?"实付￥23.26":"实付￥19.98");
 put(50,y+260,"总价");put(800,y+260,second?"￥50.74":"￥46.48");
 put(50,y+400,"订单号");put(500,y+400,second?"800000000000000002":"800000000000000001",450);
 put(50,y+460,"下单时间");put(400,y+460,"2026-10-30 19:17:50.614",550);put(50,y+520,"支付方式");put(800,y+520,"支付宝");put(50,y+560,"订单信息");put(50,y+650,"安心权益");put(200,y+800,"广告商品");put(200,y+840,"×1");put(800,y+800,"实付￥999");
 return takeoutPrefix+JSON.stringify({platform:"eleme",width:1080,height:y+1000,complete:true,blocks});
}

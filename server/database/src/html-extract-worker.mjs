import { parentPort,workerData } from "node:worker_threads";
import { parse,defaultTreeAdapter } from "parse5";

try {
  let html;try{html=new TextDecoder("utf-8",{fatal:true}).decode(workerData);}catch{throw new Error("HTML 含非法 UTF-8 字节，未生成正文。");}
  // Limit allocation during tree construction, including nodes later removed by HTML repair.
  let nodes=0;
  const count=()=>{if(++nodes>50000)throw new Error("HTML DOM 超过 50000 节点上限。");};
  const adapter={...defaultTreeAdapter};
  for(const name of ["createElement","createCommentNode","createTextNode","createDocument","createDocumentFragment"]){
    adapter[name]=(...args)=>{count();return defaultTreeAdapter[name](...args);};
  }
  adapter.setDocumentType=(document,...args)=>{if(!document.childNodes.some(node=>node.nodeName==="#documentType"))count();defaultTreeAdapter.setDocumentType(document,...args);};
  adapter.insertText=(parent,text)=>{if(parent.childNodes.at(-1)?.nodeName!=="#text")count();defaultTreeAdapter.insertText(parent,text);};
  adapter.insertTextBefore=(parent,text,reference)=>{if(parent.childNodes[parent.childNodes.indexOf(reference)-1]?.nodeName!=="#text")count();defaultTreeAdapter.insertTextBefore(parent,text,reference);};
  const document=parse(html,{treeAdapter:adapter,scriptingEnabled:false});
  const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value??"";
  const safeUrl=value=>{try{const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password&&url.href.length<=2000?url.href:undefined;}catch{return undefined;}};
  const excluded=new Set(["script","style","iframe","object","embed","template","noscript","svg","math","canvas","audio","video","nav","footer","form","button","input","select","textarea"]);
  const blocks=new Set(["p","div","section","article","main","h1","h2","h3","h4","h5","h6","li","br","tr","blockquote","pre","hr"]);
  let body,article,main,title="",sourceUrl;const stack=[{node:document,depth:0,hidden:false}];
  while(stack.length){
    const {node,depth,hidden:parentHidden}=stack.pop();if(depth>256)throw new Error("HTML DOM 超过 256 层深度上限。");
    const hidden=parentHidden||excluded.has(node.tagName)||node.attrs?.some(a=>a.name==="hidden"||(a.name==="aria-hidden"&&a.value==="true"))||/display\s*:\s*none|visibility\s*:\s*hidden/iu.test(attr(node,"style"));
    node.extractionHidden=Boolean(hidden);
    if(node.tagName==="meta"){
      const encoding=attr(node,"charset")||(/charset\s*=\s*([^;\s]+)/iu.exec(attr(node,"content"))?.[1]??"");
      if(encoding&&!/^(utf-8|utf8)$/iu.test(encoding))throw new Error("HTML 仅支持声明为 UTF-8 的快照，请重新导出。");
      if(attr(node,"property")==="og:url")sourceUrl??=safeUrl(attr(node,"content"));
    }
    if(node.tagName==="link"&&attr(node,"rel").split(/\s/u).includes("canonical"))sourceUrl??=safeUrl(attr(node,"href"));
    if(node.nodeName==="#comment"&&/SingleFile/iu.test(node.data??""))sourceUrl??=safeUrl(/url:\s*(https?:\/\/[^\s<>]+)/iu.exec(node.data)?.[1]??"");
    if(node.tagName==="title")title=(node.childNodes??[]).map(child=>child.value??"").join("").trim().slice(0,300);
    if(!hidden){if(node.tagName==="article")article??=node;if(node.tagName==="main")main??=node;if(node.tagName==="body")body=node;}
    for(const child of [...(node.childNodes??[])].reverse())stack.push({node:child,depth:depth+1,hidden:Boolean(hidden)});
    if(node.content)stack.push({node:node.content,depth:depth+1,hidden:true});
  }
  const root=article??main??body,warnings=[];
  if(!root)throw new Error("未提取到正文；原件仍可下载。");
  if(!article&&!main)warnings.push("未发现文章或主内容标记，已提取页面文字，内容可能不完整。");
  const parts=[],pending=[{node:root,closing:false}];let length=0,truncated=false;
  while(pending.length){
    const {node,closing}=pending.pop();if(node.extractionHidden)continue;
    let value="";
    if(node.nodeName==="#text")value=node.value.replace(/[\t\r\n ]+/gu," ");
    else if(blocks.has(node.tagName))value="\n";
    if(value){const remaining=100000-length;parts.push(value.slice(0,remaining));length+=Math.min(remaining,value.length);if(value.length>remaining){truncated=true;break;}}
    if(!closing&&node.childNodes){pending.push({node,closing:true});for(const child of [...node.childNodes].reverse())pending.push({node:child,closing:false});}
  }
  const text=parts.join("").replace(/ *\n */gu,"\n").replace(/\n{3,}/gu,"\n\n").trim();
  if(!text)throw new Error("未提取到正文；原件仍可下载。");
  if(truncated)warnings.push("正文超过 100000 字符，内容已截断；完整内容保留在原件中。");
  if(/登录后|登入後|订阅后|訂閱後|sign in to|log in to|subscribe to (read|continue)|captcha|验证码/iu.test(text))warnings.push("页面文字包含登录、订阅或验证提示，内容可能不完整。");
  parentPort.postMessage({result:{text,title,sourceUrl,warnings}});
} catch(error){parentPort.postMessage({error:error.message});}

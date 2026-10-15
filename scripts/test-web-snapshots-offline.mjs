import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const {withOfflinePostgres}=await import(`${root}/scripts/offline-postgres.mjs`);
const {PostgresUnitOfWork,migrate,AgentRepository,processPendingLibrary}=await import(`${root}/packages/database/src/index.ts`);
const {CommandExecutor,QueryService,sha256Fingerprinter,systemClock,uuidIds}=await import(`${root}/packages/kernel/src/index.ts`);
const {createApp}=await import(`${root}/apps/api/src/app.ts`);
const require=createRequire(`${root}/apps/api/package.json`),{serve}=require('@hono/node-server');
const webRequire=createRequire(`${root}/apps/web/package.json`),{createServer}=await import(webRequire.resolve('vite'));
const {default:react}=await import(webRequire.resolve('@vitejs/plugin-react'));
const {chromium}=await import('playwright');
const output=process.env.SHADOW_WEB_TEST_ARTIFACTS??await mkdtemp(join(tmpdir(),'life-web-offline-'));await mkdir(output,{recursive:true});
await withOfflinePostgres(async url=>{
  const unitOfWork=new PostgresUnitOfWork({connectionString:url}),pool=unitOfWork.pool;
  let browser,web,server,timer,processing;
  try{
    await migrate(pool);await pool.query("update write_epochs set stage='life',epoch=epoch+1");await unitOfWork.ensurePrincipal('subject_example');
    const executor=new CommandExecutor({unitOfWork,ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter}),queries=new QueryService(unitOfWork),repository=new AgentRepository(pool);
    const delayed=new Set();
    const runtime={id:'local-browser-controlled',available:true,async *run(request){
      if(request.text.includes('保存')){delayed.add(request.runId);yield{id:'capture',type:'tool.requested',runId:request.runId,capability:'library.capture',input:{title:'助手合成记录',item_type:'note',text:'受控 Runtime 只写一次的资料',tags:[]}};}
      else{yield{id:'read',type:'tool.requested',runId:request.runId,capability:'agent.context',input:{query:'中文完整关键词',scenario:'library'}};}
    },async *submitToolResult(request,signal){
      yield{id:'answer1',type:'message.delta',runId:request.runId,text:'受控结果：已核对持久资料。'};
      if(delayed.has(request.runId))await new Promise(resolve=>{const t=setTimeout(resolve,6500);signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});
      if(signal.aborted)yield{id:'interrupted',type:'run.interrupted',runId:request.runId,reason:'受控停止'};
      else{yield{id:'answer2',type:'message.delta',runId:request.runId,text:'最终答案齐全。'};yield{id:'done',type:'run.completed',runId:request.runId};}
    }};
    const app=createApp({unitOfWork,executor,queries,developmentAuth:true,agent:{repository,runtime,nextId:kind=>`${kind}_${randomUUID().replaceAll('-','')}`}});
    server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
    const port=server.address().port;
    web=await createServer({root:`${root}/apps/web`,configFile:false,envFile:false,plugins:[react()],define:{__SHADOW_AMAP_CONFIG__:'null',__SHADOW_GOOGLE_MAPS_KEY__:'""'},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${port}`}}}});await web.listen();const origin=web.resolvedUrls.local[0];
    timer=setInterval(()=>{if(!processing)processing=processPendingLibrary(pool,20,{available:false,reason:'Offline fixture',async process(){throw new Error('Vision is disabled in offline browser tests');}}).finally(()=>{processing=undefined;});},500);
    browser=await chromium.launch({headless:true,...(process.env.SHADOW_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.SHADOW_TEST_BROWSER_EXECUTABLE}:{}),args:['--disable-background-networking']});
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))external.push(request.url());});
    await page.goto(origin);await page.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'资料',exact:true}).click();
    await page.getByRole('button',{name:'＋ 录入资料'}).click();
    const html='<meta charset="utf-8"><title>网页合成资料</title><script>window.snapshotExecuted=true;fetch("https://example.invalid/beacon")</script><article><h1>网页合成资料</h1><p>中文完整关键词 EnglishArchive。</p><p>离线保存的第二段正文。</p><img src="https://example.invalid/pixel"><iframe src="https://example.invalid/frame"></iframe></article>';
    async function upload(name,bytes){if(!await page.locator('input[type=file]').isVisible())await page.getByRole('button',{name:'＋ 录入资料'}).click();await page.getByLabel('标题（可选）').fill(name);await page.getByLabel('原网址（可选）').fill('https://example.com/article');await page.locator('input[type=file]').setInputFiles({name:`${name}.html`,mimeType:'text/html',buffer:Buffer.from(bytes)});await page.getByRole('button',{name:'上传并保存原件',exact:true}).click();}
    let lostCapture=false;await page.route('**/api/commands/library.capture',async route=>{if(!lostCapture){lostCapture=true;await route.fetch();await route.abort('failed');}else await route.continue();});
    await upload('网页合成资料',html);await page.getByRole('button',{name:'从当前阶段继续',exact:true}).click();await page.locator('.library-reader pre').waitFor();assert.match(await page.locator('.library-reader pre').textContent(),/中文完整关键词/);assert.equal(await page.evaluate(()=>window.snapshotExecuted),undefined);
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载原件',exact:true}).click();const download=await downloadPromise;assert.equal(await readFile(await download.path(),'utf8'),html);
    await page.screenshot({path:`${output}/library-desktop.png`,fullPage:true});
    await page.getByRole('textbox',{name:'全文搜索'}).fill('中文完整关键词');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.locator('.library-list button').first().waitFor();assert.equal(await page.locator('.library-list button').count(),1);
    assert.equal((await pool.query("select count(*)::int n from operations where capability='library.capture'")).rows[0].n,1);console.log('PASS desktop HTML upload/resume once/read/search/download/no active content');
    await page.getByRole('button',{name:'关闭',exact:true}).click();await upload('编码失败资料','<meta charset="gbk"><p>请重新导出</p>');await page.getByText('正文提取失败',{exact:true}).waitFor();assert.match(await page.locator('.library-reader').textContent(),/UTF-8/);await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('尝试 2',{exact:false}).waitFor();
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/library-failure-narrow.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('PASS narrow HTML failure and retry');
    await page.getByRole('button',{name:'打开生活助手'}).click();await page.getByRole('button',{name:'发送',exact:true}).waitFor();
    await page.getByLabel('告诉 Shadow 要记录、补充或查找什么').fill('保存后刷新恢复');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('已保存 1 项',{exact:true}).waitFor();
    const runCount=Number((await pool.query('select count(*)::int n from runs')).rows[0].n);await page.reload();if(!await page.getByRole('dialog',{name:'生活助手'}).isVisible())await page.getByRole('button',{name:'打开生活助手'}).click();
    await page.getByText('最终答案齐全。',{exact:false}).waitFor();await page.getByRole('button',{name:'发送',exact:true}).waitFor({state:'visible'});assert.equal(Number((await pool.query('select count(*)::int n from runs')).rows[0].n),runCount);
    assert.equal(Number((await pool.query("select count(*)::int n from operations where capability='library.capture' and agent_run_id is not null")).rows[0].n),1);
    await page.getByRole('button',{name:'发送',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/assistant-recovered-narrow.png`});console.log('PASS refresh restores original run and actual receipt, one write');
    await page.getByLabel('告诉 Shadow 要记录、补充或查找什么').fill('保存后停止');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('已保存 1 项',{exact:true}).waitFor();
    let rejected=false;await page.route('**/api/runs/*/stop',async route=>{if(!rejected){rejected=true;await route.abort('failed');}else await route.continue();});
    await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByText('停止未确认，继续观察运行',{exact:true}).waitFor();await page.screenshot({path:`${output}/assistant-stop-unconfirmed-narrow.png`,fullPage:true});
    await page.getByRole('button',{name:'停止',exact:true}).click();await page.getByText('未完成：',{exact:false}).waitFor();assert.equal((await pool.query("select status from runs order by started_at desc limit 1")).rows[0].status,'interrupted');
    assert.match(await page.locator('.assistant-transcript').textContent(),/已保存：/);assert.equal(Number((await pool.query("select count(*)::int n from operations where capability='library.capture' and agent_run_id is not null")).rows[0].n),2);
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:`${output}/assistant-stopped-desktop.png`,fullPage:true});console.log('PASS failed stop stays unconfirmed, confirmed stop preserves committed receipt');
    await page.getByLabel('告诉 Shadow 要记录、补充或查找什么').fill('保存后断网恢复');await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('已保存 1 项',{exact:true}).waitFor();
    await context.setOffline(true);await page.getByText('连接中断，正在恢复结果',{exact:true}).waitFor();await page.screenshot({path:`${output}/assistant-reconnecting-desktop.png`,fullPage:true});await context.setOffline(false);
    await page.getByRole('button',{name:'发送',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.assistant-panel form button')?.disabled);assert.equal(Number((await pool.query("select count(*)::int n from operations where capability='library.capture' and agent_run_id is not null")).rows[0].n),3);console.log('PASS offline/online continuous recovery without another write');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(`${output}/result.json`,JSON.stringify({passed:true,cases:['upload interrupted after commit resumes once','HTML read/search/download','untrusted HTML never executes or fetches','failed encoding and retry','refresh reconstructs original run','unconfirmed stop and stop/commit receipt','offline/online recovery'],desktop:[1440,1000],narrow:[390,844],pageErrors:errors,externalRequests:external},null,2));
    console.log(`Browser artifacts: ${output}`);
  }finally{clearInterval(timer);if(processing)await processing;if(browser)await browser.close();if(web)await web.close();if(server)await new Promise(resolve=>server.close(resolve));await unitOfWork.close();}
});

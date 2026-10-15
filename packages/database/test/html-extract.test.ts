import assert from "node:assert/strict";
import test from "node:test";
import { extractHtml } from "../src/html-extract.js";

test("HTML extraction reads Chinese paragraphs without executing or fetching active content",async()=>{
  const result=await extractHtml(Buffer.from(`<!doctype html><!-- Page saved with SingleFile url: https://example.com/article -->
    <meta charset="UTF-8"><title>中文快照</title><link rel="canonical" href="https://example.com/article">
    <script>throw new Error('executed')</script><style>body{background:url(https://example.invalid/beacon)}</style>
    <nav>导航广告</nav><article><h1>中文快照</h1><p>完整中文关键词，offline archive。</p><p>第二段 &amp; 第三段。</p>
    <iframe src="https://example.invalid/"></iframe><img src="https://example.invalid/pixel"><a href="javascript:alert(1)">纯文本链接</a>
    <div hidden>隐藏文字</div></article>`));
  assert.match(result.text,/完整中文关键词/u);assert.match(result.text,/第二段 & 第三段/u);
  assert.doesNotMatch(result.text,/executed|导航广告|隐藏文字|javascript|example.invalid/u);
  assert.equal(result.sourceUrl,"https://example.com/article");assert.equal(result.title,"中文快照");
});
test("HTML limits reject invalid encoding, empty articles and excessive trees; later work still succeeds",async()=>{
  for(const input of [Buffer.from([0xff]),Buffer.from('<meta charset="gbk"><p>文字</p>'),Buffer.from('<script>only script</script>'),Buffer.alloc(10*1024*1024+1,32),Buffer.from('<div>'.repeat(300)+'text'+'</div>'.repeat(300)),Buffer.from('<i></i>'.repeat(51000))]){
    await assert.rejects(()=>extractHtml(input));
  }
  const login=await extractHtml(Buffer.from('<main><p>请登录后查看全文</p></main>'));
  assert.match(login.warnings.join(),/登录/u);
  const long=await extractHtml(Buffer.from('<article><p>'+'内容'.repeat(60000)+'</p></article>'));
  assert.ok(long.text.length<=100000);assert.match(long.warnings.join(),/截断/u);
  assert.equal((await extractHtml(Buffer.from('<article><p>后续正常任务</p></article>'))).text,'后续正常任务');
});
test("HTML parser timeout actually terminates its worker",async()=>{
  await assert.rejects(()=>extractHtml(Buffer.from('<article>正文</article>'),{timeoutMs:1}),/超时/u);
  assert.equal((await extractHtml(Buffer.from('<article>正文</article>'))).text,'正文');
});

import assert from "node:assert/strict";
import test from "node:test";
import { createApp,requestLogRoute } from "../src/app.js";

function appFor(mediaType:string,bytes:Buffer=Buffer.from("asset")){
  const dependencies={unitOfWork:{pool:{query:async()=>({rows:[{bytes,media_type:mediaType,sha256:"abc123"}]})}},executor:{},queries:{},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];return createApp(dependencies);
}

test("active originals are downloadable but never rendered with site authority",async()=>{
  const response=await appFor("image/svg+xml",Buffer.from("<svg><script>alert(1)</script></svg>")).request("/api/assets/version_test000",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"application/octet-stream");assert.match(response.headers.get("content-disposition")??"",/^attachment;/u);assert.equal(response.headers.get("x-shadow-original-media-type"),"image/svg+xml");assert.equal(response.headers.get("x-content-type-options"),"nosniff");assert.equal(response.headers.get("cache-control"),"private, no-store");assert.match(await response.text(),/<script>/u);
});

test("active media has no inline preview",async()=>{
  const response=await appFor("text/html",Buffer.from("<script>alert(1)</script>")).request("/api/assets/version_test000/preview",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,415);assert.equal(response.headers.get("x-content-type-options"),"nosniff");assert.match((await response.json() as {message:string}).message,/download/u);
});

test("passive preview keeps its exact decoder type and protected caching",async()=>{
  const response=await appFor("image/png",Buffer.from([137,80,78,71])).request("/api/assets/version_test000/preview",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"image/png");assert.match(response.headers.get("content-disposition")??"",/^inline;/u);assert.equal(response.headers.get("cross-origin-resource-policy"),"same-origin");assert.equal(response.headers.get("cache-control"),"private, no-store");assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[137,80,78,71]);
});

test("project directory is authenticated and returns server-owned safe configuration",async()=>{
  const projectLinks={schema_version:1 as const,catalog_revision:"test-1",items:[{id:"shadow-garden",title:"博客创作",subtitle:"Shadow Garden · 独立应用",icon:"notebook-pen" as const,state:"configured" as const,target:{kind:"browser" as const,url:"https://garden.example.com"},auth_hint:"shadow_identity" as const,order:20}]};
  const dependencies={unitOfWork:{pool:{query:async()=>({rows:[]})}},executor:{},queries:{},developmentAuth:true,projectLinks} as unknown as Parameters<typeof createApp>[0];
  const app=createApp(dependencies);
  assert.equal((await app.request("/api/project-links")).status,401);
  const response=await app.request("/api/project-links",{headers:{authorization:"Bearer dev:subject_test"}});
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, max-age=300");assert.deepEqual(await response.json(),projectLinks);
});

test("request diagnostics return a correlation id and redact resource identifiers",async()=>{
  const response=await appFor("image/png").request("/api/assets/private-version/preview",{headers:{authorization:"Bearer dev:subject_test","x-request-id":"mobile-sync-123"}});
  assert.equal(response.headers.get("x-request-id"),"mobile-sync-123");
  assert.equal(requestLogRoute("/api/operations/by-command/cmd_private_health_record"),"/api/operations/by-command/:commandId");
  assert.equal(requestLogRoute("/api/assets/private-version/preview"),"/api/assets/:versionId/preview");
});

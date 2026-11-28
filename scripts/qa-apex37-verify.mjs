// Re-verification of #APEX-37 fix on the built app (headless Chromium/SwiftShader).
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";
const distRoot = resolve(process.cwd(), "dist"), outDir = resolve(process.cwd(), "docs/evidence");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".map":"application/json",".png":"image/png",".svg":"image/svg+xml"};
const server=createServer(async(req,res)=>{try{const u=decodeURIComponent((req.url??"/").split("?")[0]);let f=normalize(join(distRoot,u==="/"?"index.html":u));if(f!==distRoot&&!f.startsWith(distRoot+sep))return void res.writeHead(403).end();const i=await stat(f);if(i.isDirectory())f=join(f,"index.html");res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});

async function measure(vp, scale){
  const ctx=await browser.newContext({viewport:{width:vp.w,height:vp.h},hasTouch:vp.touch??false});
  const p=await ctx.newPage();
  await p.goto(origin,{waitUntil:"load"});
  await p.waitForSelector(".apex-settings__toggle",{timeout:15000});
  if(scale!==1){await p.getByRole("button",{name:"Settings"}).click();await p.$eval('#apex-settings-panel input[type="range"]',(el,v)=>{el.value=String(v);el.dispatchEvent(new Event("input",{bubbles:true}));},scale*100);await p.getByRole("button",{name:"Close"}).click();}
  const b=p.getByRole("button",{name:/start/i});if(await b.count())await b.first().click();
  await p.waitForFunction(()=>window.apexStage?.race?.session?.phase==="racing",null,{timeout:20000});await p.keyboard.down("KeyW");await p.waitForTimeout(1200);await p.keyboard.up("KeyW");
  const m=await p.evaluate(()=>{
    const q=s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {font:parseFloat(getComputedStyle(el).fontSize),right:Math.round(r.right),bottom:Math.round(r.bottom),overX:el.scrollWidth>el.clientWidth+1};};
    const panels=[...document.querySelectorAll(".apex-panel")].filter(el=>{const r=el.getBoundingClientRect();return r.right>window.innerWidth+1||r.bottom>window.innerHeight+1||el.scrollWidth>el.clientWidth+1;}).map(el=>el.className);
    return {root:parseFloat(getComputedStyle(document.querySelector(".apex-hud")).fontSize),
      speed:q(".apex-speed-value"),time:q(".apex-live .apex-time"),notes:q(".apex-notes-call"),
      clippedPanels:panels,docOverX:document.documentElement.scrollWidth-window.innerWidth,
      docOverY:document.documentElement.scrollHeight-window.innerHeight};
  });
  if(scale===2)await p.screenshot({path:join(outDir,`APEX-37-${vp.name}-200pct.png`)});
  await ctx.close();
  return m;
}
const results={};
for(const vp of [{name:"desktop",w:1280,h:800},{name:"mobile",w:390,h:844,touch:true}]){
  const one=await measure(vp,1), two=await measure(vp,2);
  results[vp.name]={one,two,ratios:{root:+(two.root/one.root).toFixed(2),speed:+(two.speed.font/one.speed.font).toFixed(2),time:+(two.time.font/one.time.font).toFixed(2),notes:+(two.notes.font/one.notes.font).toFixed(2)},
    clipped:two.clippedPanels.length>0||two.docOverX>1||two.docOverY>1};
}
await browser.close();server.close();await mkdir(outDir,{recursive:true});
const pass=Object.values(results).every(r=>r.ratios.root===2&&r.ratios.speed===2&&r.ratios.time===2&&r.ratios.notes===2&&!r.clipped);
const report={pass,...results};
await writeFile(join(outDir,"APEX-37-verify.txt"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));if(!pass)process.exitCode=1;

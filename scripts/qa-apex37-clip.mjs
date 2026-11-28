// Dedicated clip probe for the four prominent readouts at 200% (fixed build).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";
const distRoot = resolve(process.cwd(), "dist");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".map":"application/json",".png":"image/png",".svg":"image/svg+xml"};
const server=createServer(async(req,res)=>{try{const u=decodeURIComponent((req.url??"/").split("?")[0]);let f=normalize(join(distRoot,u==="/"?"index.html":u));if(f!==distRoot&&!f.startsWith(distRoot+sep))return void res.writeHead(403).end();const i=await stat(f);if(i.isDirectory())f=join(f,"index.html");res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const origin=`http://127.0.0.1:${server.address().port}`;
const SEL={countdown:".apex-countdown",time:".apex-live .apex-time",speed:".apex-speed .apex-speed-value",notes:".apex-notes .apex-notes-call"};
const browser=await chromium.launch({args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const out={};
for(const vp of [{name:"desktop",w:1280,h:800},{name:"mobile",w:390,h:844,touch:true}]){
  const ctx=await browser.newContext({viewport:{width:vp.w,height:vp.h},hasTouch:!!vp.touch,isMobile:!!vp.touch});
  const p=await ctx.newPage();
  await p.goto(origin,{waitUntil:"load"});
  await p.waitForSelector(".apex-settings__toggle",{timeout:20000});
  await p.locator(".apex-settings__toggle").click();
  const panel=p.locator("#apex-settings-panel");
  const s=panel.locator('input[type="range"]');await s.fill("200");await s.dispatchEvent("input");
  await panel.getByRole("button",{name:"Close"}).click();
  const menu=p.locator('[data-testid="apex-menu"]');
  await menu.getByRole("button",{name:"Play"}).click();
  await menu.locator(".apex-card").first().click();
  await menu.getByRole("button",{name:"Race"}).click();
  await p.waitForFunction(()=>window.apexStage?.race?.session?.phase==="racing",null,{timeout:20000});
  await p.keyboard.down("KeyW");await p.waitForTimeout(2000);await p.keyboard.up("KeyW");
  out[vp.name]=await p.evaluate((SEL)=>{
    const res={};
    for(const [k,sel] of Object.entries(SEL)){
      const el=document.querySelector(sel);
      if(!el){res[k]={found:false};continue;}
      const r=el.getBoundingClientRect();
      // text range rect vs element box
      const range=document.createRange();range.selectNodeContents(el);
      const tr=range.getBoundingClientRect();
      // nearest clipping ancestor
      let clip=null,n=el.parentElement;
      while(n){const cs=getComputedStyle(n);if(cs.overflowX!=="visible"||cs.overflowY!=="visible"){clip={cls:n.className,ox:cs.overflowX,oy:cs.overflowY};break;}n=n.parentElement;}
      res[k]={found:true,font:parseFloat(getComputedStyle(el).fontSize),
        scrollW:el.scrollWidth,clientW:el.clientWidth,scrollH:el.scrollHeight,clientH:el.clientHeight,
        textW:Math.round(tr.width),textH:Math.round(tr.height),
        textFits: tr.left>=-1 && tr.right<=window.innerWidth+1 && tr.top>=-1 && tr.bottom<=window.innerHeight+1,
        nearestClippingAncestor:clip,
        box:{left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)}};
    }
    return {vw:window.innerWidth,vh:window.innerHeight,res};
  },SEL);
  await ctx.close();
}
await browser.close();server.close();
console.log(JSON.stringify(out,null,2));

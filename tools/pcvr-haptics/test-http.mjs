// Run after build.ps1. Exercises the compiled helper through actual Chrome CORS
// and ordinary HTTP, without requesting a headset or generating vibration.
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../..',import.meta.url)),out=path.join(root,'out/pcvr-haptics');
const automatic=process.argv.includes('--automatic');
let token=randomBytes(16).toString('hex');
const portFile=path.join(out,`test-${token}.port`),origin=new URL(process.env.HAPTICS_TEST_URL??'https://haptics-test.example').origin;
const child=automatic?null:spawn(path.join(out,'Release/haptics-bridge.exe'),[origin,token,portFile],{windowsHide:true,env:{...process.env,NFSU2_WEB_HAPTICS_MAP:`Local\\NFSU2WebHaptics-${token}`}});
let browser;
try {
  let port=automatic?28765:0;for(let i=0;!port&&i<100;i++){try{port=Number(await fs.readFile(portFile,'utf8'));}catch{}if(!port)await new Promise(r=>setTimeout(r,50));}
  const discovery=await fetch(`http://127.0.0.1:${port}/connect`,{headers:{Origin:origin,'X-NFSU2-Connect':'1'}});
  assert.equal(discovery.status,200);const capability=await discovery.json();assert.equal(capability.version,1);
  if(automatic)token=capability.token;else assert.equal(capability.token,token);
  assert.ok(port);const url=`http://127.0.0.1:${port}`,headers={Origin:origin,'X-NFSU2-Haptics':token};
  const status=await fetch(url+'/status',{headers});assert.equal(status.status,200);assert.equal((await status.json()).ready,false);
  assert.equal((await fetch(url+'/status',{headers:{...headers,Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await fetch(url+'/status',{headers:{...headers,'X-NFSU2-Haptics':'wrong'}})).status,403);
  assert.equal((await fetch(url+'/connect',{headers:{Origin:origin}})).status,403);
  assert.equal((await fetch(url+'/connect',{headers:{Origin:'https://unrelated.example','X-NFSU2-Connect':'1'}})).status,403);
  for(const values of [[.25,100,.95,28],[NaN,100,0,0],[1,101,0,0],[-1,10,0,0]]){
    const response=await fetch(url+'/pulse',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:new Float32Array(values)});
    assert.equal(response.status,values[0]===.25?204:400);
  }
  const environment={...process.env};
  for(const key of ['XR_API_LAYER_PATH','XR_ENABLE_API_LAYERS','NFSU2_WEB_HAPTICS_MAP'])delete environment[key];
  if(!automatic)Object.assign(environment,{XR_API_LAYER_PATH:path.join(out,'Release'),XR_ENABLE_API_LAYERS:'XR_APILAYER_NFSU2_web_haptics',NFSU2_WEB_HAPTICS_MAP:`Local\\NFSU2WebHaptics-${token}`});
  browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true,env:environment});
  const context=await browser.newContext();const page=await context.newPage();
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  page.on('requestfailed',r=>console.error(r.url().split('?')[0],r.failure()));
  // The browser's permission is granted only for this isolated test origin.
  const cdp=await context.newCDPSession(page);
  const {targetInfo}=await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.grantPermissions',{origin,browserContextId:targetInfo.browserContextId,permissions:['localNetworkAccess','loopbackNetwork']});
  if(!process.env.HAPTICS_TEST_URL)await page.route(origin+'/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Haptics transport test</title>'}));
  await page.goto(origin+(automatic?'/':`/#vr-haptics=${port}.${token}`));
  if(process.env.HAPTICS_TEST_URL){
    await page.waitForFunction(()=>window.__nfsu2?.phase==='ready',null,{timeout:60000});
    assert.equal(await page.evaluate(()=>location.hash.includes('vr-haptics')),false,'the deployed page consumes and removes the launcher capability');
  }
  const result=await page.evaluate(async({url,token})=>{
    const headers={'X-NFSU2-Haptics':token};const status=await fetch(url+'/status',{headers});
    const pulse=await fetch(url+'/pulse',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:new Float32Array([.3,100,.9,28])});
    return {status:status.status,state:await status.json(),pulse:pulse.status};
  },{url,token});
  assert.equal(result.status,200);assert.equal(result.pulse,204);assert.equal(result.state.version,1);
  if(process.argv.includes('--xr')){
    assert.ok(automatic,'XR integration tests require the installed automatic helper and the normal browser sandbox');
    const supported=await page.evaluate(()=>navigator.xr?.isSessionSupported('immersive-vr'));
    const state=await(await fetch(url+'/status',{headers})).json();
    console.log(JSON.stringify({xrSupported:supported,layerInitializedInChrome:state.initialized}));
    assert.equal(state.initialized,true,'Chrome loads the haptics layer in its OpenXR process');
  }
  console.log('PASS: Chrome HTTPS to loopback, preflight, both hands, origin/token rejection and bounded commands');
} finally {await browser?.close();if(child){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await fs.rm(portFile,{force:true});}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import * as esbuild from 'esbuild';
import {pickBrowser} from '../tools/browser.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const code=(await esbuild.build({stdin:{contents:`
import {HapticsPanel} from './src/app/haptics-panel';
import {enableNativeHaptics,nativeHapticsStatus} from './src/vr/native-haptics';
new HapticsPanel(document.querySelector('#haptics-setup'),{enable:enableNativeHaptics,status:nativeHapticsStatus});
`,resolveDir:root,loader:'ts'},bundle:true,format:'iife',write:false})).outputFiles[0].text;
const panel=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/<details id="haptics-setup"[\s\S]*?<\/details>/)[0];
const css=fs.readFileSync(new URL('../src/app/style.css',import.meta.url),'utf8');
const browser=await chromium.launch({...pickBrowser(),headless:true});
test.after(()=>browser.close());

test('website setup opts in once, reconnects on ordinary visits and explains denied access',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const requests=[];let unavailable=false;
  await context.route('https://haptics-page.example/**',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>${css}</style><main style="padding:16px">${panel}</main><script>${code}</script>`}));
  await context.route('http://127.0.0.1:28765/**',r=>{
    requests.push(r.request());
    return unavailable?r.abort():r.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://haptics-page.example','Access-Control-Allow-Headers':'x-nfsu2-connect, x-nfsu2-haptics','Access-Control-Allow-Private-Network':'true'},body:JSON.stringify(r.request().url().endsWith('/connect')?{version:1,token:'1234567890abcdef1234567890abcdef'}:{version:1,bridgeVersion:3,initialized:true,ready:false})});
  });
  try {
    let page=await context.newPage();
    const cdp=await context.newCDPSession(page),{targetInfo}=await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.grantPermissions',{origin:'https://haptics-page.example',browserContextId:targetInfo.browserContextId,permissions:['localNetworkAccess','loopbackNetwork']});
    await page.goto('https://haptics-page.example/');
    await page.locator('summary').click();
    await page.waitForTimeout(1100);assert.equal(requests.length,0,'no local request before opt-in');
    await page.locator('[data-haptics-connect]').click();
    await page.waitForFunction(()=>document.querySelector('[data-haptics-status]').textContent.startsWith('Helper connected.'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('nfsu2.vr.haptics-auto.v1')),'1');
    assert.ok(requests[0].url().endsWith('/connect'));assert.equal(requests[0].headers()['x-nfsu2-connect'],'1');
    assert.equal(await page.locator('a[download]').getAttribute('href'),'/nfsu2-vr-haptics-windows.zip');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'setup fits a narrow screen');
    await page.close();requests.length=0;
    page=await context.newPage();await page.goto('https://haptics-page.example/');
    await page.locator('summary').click();
    await page.waitForFunction(()=>document.querySelector('[data-haptics-status]').textContent.startsWith('Helper connected.'));
    assert.ok(requests.some(r=>r.url().endsWith('/connect')),'new tab rediscovers without a launcher URL');
    assert.equal(await page.evaluate(()=>location.hash),'');
    unavailable=true;await page.locator('[data-haptics-connect]').click();
    await page.waitForFunction(()=>document.querySelector('[data-haptics-status]').textContent.startsWith('No connection.'));
    await page.locator('[data-haptics-disconnect]').click();requests.length=0;
    await page.reload();await page.waitForTimeout(1100);assert.equal(requests.length,0);
    unavailable=false;await page.goto('https://haptics-page.example/#vr-haptics=auto');
    await page.waitForFunction(()=>document.querySelector('[data-haptics-status]').textContent.startsWith('Helper connected.'));
    assert.equal(await page.evaluate(()=>location.hash),'','one-time setup fragment is removed');
  } finally {await context.close();}
});

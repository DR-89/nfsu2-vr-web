import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import {pickBrowser} from '../tools/browser.mjs';

test('start-page headset resolution is translated, saved to disk, restored on reload and resettable',async t=>{
  const code=(await esbuild.build({stdin:{contents:`export * from './src/app/settings-ui';export * from './src/app/settings-store';export * from './src/app/i18n';`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,format:'iife',globalName:'V',write:false})).outputFiles[0].text;
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  const server=createServer((req,res)=>{
    const url=req.url.split('?')[0];
    if(url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}
    else if(url==='/main.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(new URL('../src/app/style.css',import.meta.url)));}
    else if(url==='/lang/german.json'){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(new URL('../src/app/lang/german.json',import.meta.url)));}
    else {res.statusCode=404;res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({...pickBrowser(),headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({content:code});
    await page.evaluate(async()=>{
      const file=new V.SettingsFile(()=>'vr-resolution-test',()=>{});await file.load(true);
      await V.setLanguage('german');V.translatePage(document);
      const root=document.querySelector('#settings'),panel=new V.SettingsPanel(root,{file,environment:{}},document.querySelector('#online'));window.panel=panel;
      await panel.refresh();document.body.dataset.phase='ready';
      for(const pane of root.querySelectorAll(':scope > .pane'))pane.hidden=pane.dataset.tab!=='vr';
      for(const tab of root.querySelectorAll(':scope > .tabs > .tab'))tab.setAttribute('aria-selected',String(tab.dataset.tab==='vr'));
      root.scrollIntoView();
    });
  };
  await open();const control=page.getByLabel('Headset-Auflösung',{exact:true});
  assert.equal(await control.inputValue(),'100');
  assert.deepEqual(await control.locator('option').allTextContents(),['50%','75%','100%','125%','150%','200%']);
  assert.equal(await page.locator('#vr-settings-body .set').first().getAttribute('data-key'),'vr_render_scale');
  const pixels=page.locator('#set-vr_render_scale-pixels');
  assert.match(await pixels.innerText(),/Starte VR einmal/);
  await page.evaluate(()=>window.panel.setVRResolution({scale:1,limit:4096,eyes:['left','right'].map(eye=>({eye,width:2016,height:2208,viewportWidth:2016,viewportHeight:2208}))}));
  assert.match(await pixels.innerText(),/Aktuell gerendert: 2016 × 2208 px pro Auge \(100%\)/);
  assert.match(await control.getAttribute('aria-describedby'),/set-vr_render_scale-pixels/);
  await control.selectOption('150');await page.waitForFunction(()=>document.querySelector('#settings').dataset.saved==='1');
  assert.match(await pixels.innerText(),/ca\. 3024 × 3312 px pro Auge/);
  assert.match(await pixels.innerText(),/Aktuell gerendert: 2016 × 2208/,'a future setting never changes the measured current size');
  const ini=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('vr-resolution-test');return (await (await dir.getFileHandle('settings.ini')).getFile()).text();});
  assert.match(ini,/^vr_render_scale = 150$/m);
  await open();assert.equal(await control.inputValue(),'150');
  assert.match(await pixels.innerText(),/Letzte VR-Sitzung: 2016 × 2208/);
  assert.match(await pixels.innerText(),/ca\. 3024 × 3312/);
  for(const width of [1280,375]){
    await page.setViewportSize({width,height:900});
    const bounds=await control.evaluate(el=>{const r=el.closest('.set').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width,JSON.stringify(bounds));
    assert.equal(await pixels.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'pixel readout wraps on narrow screens');
  }
  if(process.env.NFSU2_VR_RESOLUTION_SCREENSHOT){await page.setViewportSize({width:1280,height:900});await page.locator('#settings').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.NFSU2_VR_RESOLUTION_SCREENSHOT});}
  await page.getByRole('button',{name:'Headset-Auflösung zurücksetzen',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#set-vr_render_scale').value==='100');
  assert.doesNotMatch(await pixels.innerText(),/Ausgewählt/);
  await open();assert.equal(await control.inputValue(),'100');assert.deepEqual(errors,[]);
});

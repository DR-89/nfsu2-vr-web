import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const clang=process.platform==='linux'&&spawnSync('clang',['--version']).status===0;
test('VR auto cadence preserves fixed limits, cutscenes and desktop pacing',{skip:!clang&&'needs Linux clang'},()=>{
  const out=path.join(repo,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'vr-framerate');
  execFileSync('clang',['-O1','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-Iruntime','web/test/vr_framerate_unit.c','-lm','-o',bin],{cwd:repo});
  assert.match(execFileSync(bin,{encoding:'utf8'}),/VR cadence, fixed limits, cutscenes and desktop return: OK/);
});

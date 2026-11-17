import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const clang=process.platform!=='win32' && spawnSync('clang',['--version']).status===0;
test('retail own body survives the cockpit frame; other cameras and stale XR stay unchanged',{skip:!clang&&'needs native clang'},()=>{
  const out=path.join(repo,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'vr-camera');
  const san=spawnSync('clang',['-fsanitize=address,undefined','-x','c','-o',path.join(out,'vr-camera-sanitizer'),'-'],
    {input:'int main(void){return 0;}'}).status===0?['-fsanitize=address,undefined','-fno-sanitize-recover=all']:[];
  execFileSync('clang',['-O1','-g',...san,'-Wno-unknown-attributes','-Iruntime',
    'web/test/vr_camera_unit.c','runtime/web/vr_web.c','-lm','-o',bin],{cwd:repo});
  for (const xr of [false,true]) {
    const result=execFileSync(bin,xr?['xr']:[],{env:{...process.env,NFSU2_VR_COCKPIT:xr?'0':'1'},encoding:'utf8'});
    assert.match(result,/stale XR: OK/);
  }
  const shader=path.join(out,'vr-shader');
  execFileSync('clang',['-O1','-ffunction-sections','-fdata-sections','-Wl,--gc-sections',...san,'-Iruntime',
    'web/test/vr_shader_unit.c','runtime/vsemu.c','-lm','-o',shader],{cwd:repo});
  assert.match(execFileSync(shader,{encoding:'utf8'}),/sampled shader stages: OK/);
  const gearbox=path.join(out,'vr-gearbox');
  execFileSync('clang',['-O1','-g',...san,'-Wno-unknown-attributes','-Iruntime',
    'web/test/vr_gearbox_unit.c','runtime/web/vr_web.c','-lm','-o',gearbox],{cwd:repo});
  assert.match(execFileSync(gearbox,{encoding:'utf8'}),/driver epochs and stale input: OK/);
  const replay=path.join(out,'vr-replay');
  execFileSync('clang',['-O1','-g',...san,'-Wno-unknown-attributes','-Iruntime',
    'web/test/vr_replay_unit.c','runtime/web/vr_web.c','-lm','-o',replay],{cwd:repo});
  assert.match(execFileSync(replay,{encoding:'utf8'}),/viewer epochs and camera ownership: OK/);
  const rear=path.join(out,'vr-rear');
  execFileSync('clang',['-O1','-g',...san,'-Wno-unknown-attributes','-Iruntime','web/test/vr_rear_unit.c','-o',rear],{cwd:repo});
  assert.match(execFileSync(rear,{encoding:'utf8'}),/recycled owners and CPU preservation: OK/);
});

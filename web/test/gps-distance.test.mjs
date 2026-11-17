import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = async (file) => {
  const js = (await esbuild.build({ stdin: { contents: `export * from './${file}';`, resolveDir: ROOT, loader: 'ts' }, bundle: true,
    format: 'esm', write: false, platform: 'neutral' })).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
};
const S = await load('web/src/app/settings.ts');

test('GPS distance is opt-in and can be disabled again', () => {
  const env = ini => S.resolveEnv(ini, {}, {}).env.NFSU2_GPS_DISTANCE;
  assert.notEqual(env(''), '1');
  assert.equal(env('gps_distance = on'), '1');
  assert.equal(env('gps_distance = off'), '0');
});
test('real GPS HUD and snapshot respect each player, active state, units and uncommitted objects',{skip:process.platform==='win32'||spawnSync('clang',['--version']).status!==0},()=>{
  const out=path.join(ROOT,'out/web/test');fs.mkdirSync(out,{recursive:true});const bin=path.join(out,'gps-hud');
  execFileSync('clang',['-O1','-g','-Wall','-Wextra','-Werror','-Iruntime','tests/gpsdistance_hud_unit.c','-lm','-o',bin],{cwd:ROOT});
  for(const args of [[],['unset'],['0'],['off'],['false'],['invalid']])assert.match(execFileSync(bin,args,{encoding:'utf8'}),/PASS GPS HUD/);
});

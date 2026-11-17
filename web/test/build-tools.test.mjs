import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommand,spawnBuild,wslPath} from '../tools/build-tools.mjs';

test('build tools preserve arguments and translate drive, WSL share and include paths',()=>{
  assert.equal(wslPath('C:\\game data\\test.c'),'/mnt/c/game data/test.c');
  assert.equal(wslPath('\\\\wsl.localhost\\Ubuntu\\home\\user\\sdk'),'/home/user/sdk');
  assert.equal(wslPath('\\\\wsl$\\Ubuntu\\tmp\\file'),'/tmp/file');
  const options={cwd:'C:\\source tree',env:{...process.env,NFSU2_WSL_DISTRO:'Build Linux',GEN:'C:\\generated files',CPU_H:'D:\\header files'}};
  const [exe,args]=buildCommand('/opt/sdk/bin/clang',['-IC:\\header files','C:\\source tree\\test.c','-o','C:\\output dir\\test.wasm','a; echo unexpected'],options,'win32');
  assert.equal(exe,'wsl.exe');assert.deepEqual(args.slice(0,6),['-d','Build Linux','--cd','/mnt/c/source tree','--exec','env']);
  assert.ok(args.includes('GEN=/mnt/c/generated files'));assert.ok(args.includes('CPU_H=/mnt/d/header files'));
  assert.deepEqual(args.slice(-6),['/opt/sdk/bin/clang','-I/mnt/c/header files','/mnt/c/source tree/test.c','-o','/mnt/c/output dir/test.wasm','a; echo unexpected']);
  assert.deepEqual(buildCommand('clang',['file.c'],options,'linux'),['clang',['file.c'],options]);
});

test('a real shell receives literal arguments and environment and preserves failure exit codes',()=>{
  const literal='space "quote" $HOME $(printf unexpected) ; & value';
  const result=spawnBuild('sh',['-c','printf "%s\\n%s\\n" "$1" "$NFSU2_BUILD_TEST"; exit 7','build-test',literal],
    {encoding:'utf8',timeout:30_000,env:{...process.env,NFSU2_BUILD_TEST:literal}});
  assert.equal(result.status,7,result.stderr??String(result.error));
  assert.equal(result.stdout,`${literal}\n${literal}\n`);
});

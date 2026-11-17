import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const clang=process.platform!=='win32'&&spawnSync('clang',['--version']).status===0;
test('optional PC cars/vinyls preserve stock records; live whine fades and loads once',{skip:!clang&&'needs native clang'},()=>{
  const out=path.join(repo,'out/web/test');fs.mkdirSync(out,{recursive:true});
  const san=spawnSync('clang',['-fsanitize=address,undefined','-x','c','-o',path.join(out,'mod-sanitizer'),'-'],{input:'int main(void){return 0;}'}).status===0?['-fsanitize=address,undefined','-fno-sanitize-recover=all']:[];
  for(const [file,marker]of [['mod_options_unit','preserved parts: OK'],['whine_live_unit','invalid setting: OK']]){
    const bin=path.join(out,file);
    execFileSync('clang',['-O1','-g',...san,'-Iruntime',`web/test/${file}.c`,'-lm','-lpthread','-o',bin],{cwd:repo});
    assert.ok(execFileSync(bin,{encoding:'utf8'}).includes(marker));
  }
});

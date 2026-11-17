// Bash and the WASI compiler run in WSL on Windows. Browser and WASI execution
// tests stay in Windows Node, so GPU checks still use the desktop driver.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

export function wslPath(value) {
  const s=String(value),drive=/^([A-Za-z]):[\\/](.*)$/.exec(s);
  if(drive)return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g,'/')}`;
  const share=/^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/][^\\/]+[\\/]?(.*)$/i.exec(s);
  return share?'/'+share[1].replace(/\\/g,'/'):s;
}

/** Arguments stay separate: spaces and shell metacharacters are never evaluated. */
export function buildCommand(command,args=[],options={},platform=process.platform) {
  if(platform!=='win32')return [command,args,options];
  const env=options.env??process.env,distro=env.NFSU2_WSL_DISTRO;
  const forwarded=Object.entries(env).filter(([key,value])=>value!==undefined &&
    (value!==process.env[key] || ['WASI','CPU_H','GEN','GEN_STALE_OK','OPT','CARGO_TARGET_DIR'].includes(key)))
    .map(([key,value])=>`${key}=${wslPath(value)}`);
  const mapped=args.map(arg=>{
    const include=/^(-I|-L|--sysroot=)([A-Za-z]:[\\/].*)$/.exec(arg);
    return include?include[1]+wslPath(include[2]):wslPath(arg);
  });
  return ['wsl.exe',[...(distro?['-d',distro]:[]),'--cd',wslPath(options.cwd??process.cwd()),'--exec',
    'env',...forwarded,command,...mapped],options];
}
export const execBuild=(command,args,options)=>execFileSync(...buildCommand(command,args,options));
export const spawnBuild=(command,args,options)=>spawnSync(...buildCommand(command,args,options));

/** Use the local SDK or the WSL build mirror made by tools/start-vr-web.sh.
 * An explicitly supplied WASI must exist; absent optional dependencies return null. */
export function findWasi(repo) {
  if(process.platform==='win32'){
    const script=`if [ -n "$2" ]; then
      [ -x "$2/bin/clang" ] || { echo "WASI has no executable bin/clang: $2" >&2; exit 1; }
      printf '%s' "$2"; exit
    fi
    for base in "$1/deps" "$HOME/$(basename "$1")/deps"; do
      found=
      for sdk in "$base"/wasi-sdk-*-linux; do
        if [ -x "$sdk/bin/clang" ]; then found=$sdk; fi
      done
      if [ -n "$found" ]; then printf '%s' "$found"; exit; fi
    done`;
    return execBuild('sh',['-c',script,'find-wasi',wslPath(repo),wslPath(process.env.WASI??'')],{encoding:'utf8',timeout:30_000}).trim()||null;
  }
  if(process.env.WASI){
    fs.accessSync(path.join(process.env.WASI,'bin/clang'),fs.constants.X_OK);
    return process.env.WASI;
  }
  const dir=path.join(repo,'deps');
  let names;try{names=fs.readdirSync(dir);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  return names.filter(n=>n.startsWith('wasi-sdk-')).sort().reverse().map(n=>path.join(dir,n))
    .find(p=>fs.existsSync(path.join(p,'bin/clang')))||null;
}

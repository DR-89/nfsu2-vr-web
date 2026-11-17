// The server the tests and tools start: the Rust binary out/web/server-rs/nfsu2-server, built by
// web/server-rs/build.sh, or $NFSU2_SERVER_BIN (another build of it: another worktree's, an older one as a negative
// control):
//   spawn(...serverCommand(args), opts)
// Its defaults (the page, the module, the state folder) are this checkout's: NFSU2_REPO, set here for the children
// unless it is set already (the binary's own default is the checkout it was built in).
// On Windows the binary is Linux's, so it runs in WSL: wsl.exe -e (the default distribution, or $NFSU2_WSL_DISTRO),
// with the binary and every argument that is a Windows path as WSL sees them, and NFSU2_REPO and the NFSU2_<OPTION>
// variables passed through WSLENV.  Killing wsl.exe stops the server in WSL too.
// The checkout's own binary older than its sources (web/server-rs's src folders, the Cargo files) would test the
// server of before: the tests (node --test) refuse it, the tools say so.  $NFSU2_SERVER_BIN is taken as it is.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { wslPath } from './build-tools.mjs';
export { wslPath } from './build-tools.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WIN = process.platform === 'win32';
export const SERVER_BIN = process.env.NFSU2_SERVER_BIN || path.join(REPO, 'out/web/server-rs/nfsu2-server');
process.env.NFSU2_REPO ||= REPO;

if (WIN) {
  // NFSU2_<OPTION> of the options with a value (/p: a path, translated), and the server's knobs
  const paths = ['REPO', 'DATA', 'DIST', 'WASM', 'STATE', 'TLS_CERT', 'TLS_KEY', 'ARTIFACTS', 'ONLINE_TRACE'];
  const plain = ['PORT', 'HTTP_PORT', 'BIND', 'TRUSTED_PROXIES', 'REAL_IP_HEADER', 'MAX_PEERS', 'LAN_IMPAIR', 'HOST',
    'ONLINE', 'ROAM_HUB', 'THREADS', 'BUNDLE_MS', 'BUNDLE_MAX_MS', 'BUNDLE_BUDGET', 'LAN_SNDBUF', 'SESSIONS',
    'COMPRESS_THREADS'];
  const have = (process.env.WSLENV || '').split(':').filter(Boolean);
  process.env.WSLENV = [...new Set([...have, ...paths.map(n => `NFSU2_${n}/p`), ...plain.map(n => `NFSU2_${n}`)])].join(':');
}

/** a source of the server newer than bin, or '' (the checkout's own binary only) */
let staleChecked = null;
export function newerServerSource(bin = SERVER_BIN) {
  if (staleChecked !== null) return staleChecked;
  staleChecked = '';
  const built = !process.env.NFSU2_SERVER_BIN && !WIN && fs.statSync(bin, { throwIfNoEntry: false })?.mtimeMs;
  if (!built) return staleChecked;
  const rs = path.join(REPO, 'web/server-rs');
  const dirs = [path.join(rs, 'src'), ...fs.readdirSync(path.join(rs, 'crates')).map(c => path.join(rs, 'crates', c, 'src'))];
  const files = [path.join(rs, 'Cargo.toml'), path.join(rs, 'Cargo.lock'), ...fs.readdirSync(path.join(rs, 'crates')).map(c => path.join(rs, 'crates', c, 'Cargo.toml'))];
  for (const d of dirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d, { recursive: true })) files.push(path.join(d, String(f)));
  let at = built;
  for (const f of files) {
    const st = fs.statSync(f, { throwIfNoEntry: false });
    if (st?.isFile() && st.mtimeMs > at) { at = st.mtimeMs; staleChecked = path.relative(REPO, f); }
  }
  return staleChecked;
}

/** [command, argv] that starts the server with args */
export function serverCommand(args, bin = SERVER_BIN) {
  const distro = process.env.NFSU2_WSL_DISTRO;
  // where this machine sees the binary (on Windows a WSL path is looked for through its share, if the distribution
  // is named)
  const seen = !WIN || !bin.startsWith('/') ? bin : distro ? `\\\\wsl.localhost\\${distro}${bin.replace(/\//g, '\\')}` : '';
  if (seen && !fs.existsSync(seen)) {
    throw new Error(`no server at ${bin}: build it with web/server-rs/build.sh${WIN ? ' (in WSL)' : ''}, or set NFSU2_SERVER_BIN`);
  }
  const newer = bin === SERVER_BIN ? newerServerSource(bin) : '';
  if (newer) {
    const msg = `${path.relative(REPO, bin)} is older than ${newer}: build it again with web/server-rs/build.sh (or set NFSU2_SERVER_BIN)`;
    if (process.env.NODE_TEST_CONTEXT) throw new Error(msg);
    console.error(`server-cmd: warning: ${msg}`);
  }
  if (!WIN) return [bin, args];
  // WSLENV hands WSL every name it lists, an unset one as empty: drop those, then the server takes the shell's place
  const unsetEmpty = `for v in $(env | grep -o '^NFSU2_[A-Z_]*=$' | tr -d =); do unset "$v"; done; exec "$@"`;
  return ['wsl.exe', [...(distro ? ['-d', distro] : []), '-e', 'sh', '-c', unsetEmpty, 'sh', wslPath(bin), ...args.map(wslPath)]];
}

/** The startup banner precedes Windows' WSL port forwarding. Wait until the
 * caller can connect, and include both output streams if startup fails. */
export function waitForServer(srv, port, { host = '127.0.0.1', timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '', started = false, finished = false, socket, retry;
    const timer = setTimeout(() => finish(new Error('server did not become reachable: ' + output)), timeout);
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(retry); socket?.destroy();
      srv.stdout.off('data', stdout); srv.stderr.off('data', stderr);
      srv.off('error', failed); srv.off('exit', exited);
      error ? reject(error) : resolve();
    };
    const probe = () => {
      socket = net.connect({ host, port });
      socket.setTimeout(1000, () => socket.destroy(new Error('connection timed out')));
      socket.once('connect', () => finish());
      socket.once('error', () => { if (!finished) retry = setTimeout(probe, 50); });
    };
    const stdout = data => {
      output += data;
      if (!started && output.includes('  access    :')) { started = true; probe(); }
    };
    const stderr = data => { output += data; };
    const failed = error => finish(error);
    const exited = code => finish(new Error('server exited ' + code + ' ' + output));
    srv.stdout.on('data', stdout); srv.stderr.on('data', stderr);
    srv.once('error', failed); srv.once('exit', exited);
  });
}

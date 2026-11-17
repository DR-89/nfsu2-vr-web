import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
const code = (await esbuild.build({ entryPoints: [fileURLToPath(new URL('../src/vr/webgl-bridge.ts', import.meta.url))],
  bundle: true, format: 'esm', write: false })).outputFiles[0].text;
const { WebGLXRBridge } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

function setup(t) {
  let resolve, reject, onEnd, onLost, created = 0, released = 0, compatible = 0;
  const transition = new Promise((yes, no) => { resolve = yes; reject = no; });
  const gl = {
    makeXRCompatible() { compatible++; return transition; },
    getExtension(name) { assert.equal(name, 'WEBGL_lose_context'); return { loseContext() { released++; } }; },
  };
  const document = globalThis.document;
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas'); created++;
    return {
      addEventListener(type, fn) { assert.equal(type, 'webglcontextlost'); onLost = fn; },
      getContext(type) { assert.equal(type, 'webgl2'); return gl; },
    };
  } };
  t.after(() => { if (document === undefined) delete globalThis.document; else globalThis.document = document; });
  const session = { addEventListener(type, fn) { assert.equal(type, 'end'); onEnd = fn; } };
  return { session, gl, resolve, reject, end: () => onEnd(), lost: event => onLost(event),
    counts: () => ({ created, released, compatible }) };
}

test('preparing the headset waits for GPU compatibility and reuses the exact context', async t => {
  const s = setup(t);
  const a = WebGLXRBridge.prepare(s.session), b = WebGLXRBridge.prepare(s.session);
  assert.equal(a, b);
  let ready = false; void a.then(() => { ready = true; });
  await Promise.resolve(); assert.equal(ready, false);
  let restore = false; s.lost({ preventDefault() { restore = true; } });
  assert.equal(restore, true, 'the GPU switch may restore the WebGL context');
  s.resolve(); assert.equal(await a, s.gl);
  assert.equal(await WebGLXRBridge.prepare(s.session), s.gl);
  assert.deepEqual(s.counts(), { created: 1, released: 0, compatible: 1 });
  s.end(); assert.equal(s.counts().released, 1);
});

test('ending XR during the GPU switch never returns a dead context', async t => {
  const s = setup(t), ready = WebGLXRBridge.prepare(s.session);
  s.end(); s.resolve();
  await assert.rejects(ready, /launch ended/);
});

test('failed GPU preparation releases the context', async t => {
  const s = setup(t), ready = WebGLXRBridge.prepare(s.session);
  s.reject(new Error('GPU unavailable'));
  await assert.rejects(ready, /GPU unavailable/);
  assert.equal(s.counts().released, 1);
});

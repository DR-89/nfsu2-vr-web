import { cabinMatrix, driverForCar, flatDriver, fitFor, meshData, poseMatrix, readDriverScene, translated, wheelFromSteer } from './drivers';
import {poseFromMatrix} from './session';
import { identity, inverse, multiply, type Mat4 } from './math';
import type { RemoteAvatar } from './multiplayer';
import { Cockpit, screenMount, appearanceLED } from './cockpit';
import { LED_SHADER } from './led-shader';
import { wheel, shifter, pedals } from './cabin-parts';
import { gloveAxes } from './fit';
import { ShifterGuide, guideMount } from './shifter-guide';
import { HudPanels } from './hud-panels';
import { MirrorRenderer } from './mirror-renderer';
import { mirrorAngle } from './mirrors';
import { SeatRenderer } from './seat-renderer';

type Mesh = { vertices: GPUBuffer; indices: GPUBuffer; opened?:GPUBuffer; count: number; texture: GPUTexture; bind: GPUBindGroup };
const CODE = `
struct U { mvp: mat4x4f, model: mat4x4f, fit: vec4f, info: vec4f, led: vec4f, lever: vec4f, pedals: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<storage,read> opened: array<vec4f>;
struct Out { @builtin(position) pos: vec4f, @location(0) normal: vec3f, @location(1) uv: vec2f, @location(2) local: vec3f, @location(3) shade: f32 }
@vertex fn vs(@location(0) p0: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @builtin(vertex_index) vertex: u32) -> Out {
  var p = p0; var norm = n;
  if(u.info.x==1.) {
    let a=opened[vertex*2u];let b=opened[vertex*2u+1u];
    // Native quest_glove_point_pose: preserve the authored index, curl the rest.
    let index=clamp(min((a.x+.065)/.011,(-.009-a.x)/.008),0.,1.);
    let curl=clamp(u.info.z,0.,1.)*(1.-clamp(u.lever.z,0.,1.)*index);
    p=mix(a.xyz,p0,curl);norm=mix(vec3f(a.w,b.xy),n,curl);
  }
  if (u.info.x == 0.) {
    let rim=vertex >= ${wheel.first}u && vertex < ${wheel.end}u;
    if (rim) {
      let pivot=vec3f(${wheel.pivot.join(',')}); let axis=vec3f(${wheel.axis.join(',')});
      let c=cos(-u.info.w*3.14159265);let s=sin(-u.info.w*3.14159265);let v=p-pivot;
      p=pivot+v*c+cross(axis,v)*s+axis*dot(axis,v)*(1.-c);
      // Native wheel lighting uses the authored normal before its model rotation.
    }
    if (!rim) {
    ${pedals.map((part,i)=>`if(vertex>=${part.first}u&&vertex<${part.end}u){
      let hinge=vec2f(${part.hinge.slice(1).join(',')});let angle=u.pedals[${i}]*${[.68,.47,.75][i]};let c=cos(angle);let s=sin(angle);
      let q=p.yz-hinge;p.y=hinge.x+c*q.x-s*q.y;p.z=hinge.y+s*q.x+c*q.y;
      let n=norm.yz;norm.y=c*n.x-s*n.y;norm.z=s*n.x+c*n.y;
      if(u.fit.w<0.){p.x=${2*pedals[1].hinge[0]}-p.x;norm.x=-norm.x;}
    }`).join('\n')}
    let width = select(u.fit.y, u.fit.x, p.x < 0.) * u.fit.w;
    p.x *= width; norm.x /= width;
    if (p.z < -.33) { p.z = -.33 + (p.z + .33) * u.fit.z; norm.z /= u.fit.z; }
    if (p0.z > -.67 && p0.z < -.29) {
      let inset=(1.-smoothstep(.122,.184,abs(p0.x-.3116)))*smoothstep(-.57,-.49,p0.y)*(1.-smoothstep(-.235,-.158,p0.y));
      p.z-=.10*inset*smoothstep(-.67,-.58,p0.z)*(1.-smoothstep(-.34,-.29,p0.z));
    }
    if(vertex>=${shifter.first}u&&vertex<${shifter.end}u){
      let t=(p.y+.577)/.115;p.x+=u.lever.x*clamp(t,0.,1.);p.z+=u.lever.y*clamp(t,0.,1.);
      if(t>0.&&t<1.){norm.y-=dot(norm.xz,u.lever.xy)/.115;}
    }
    }
  }
  var o: Out; o.pos = u.mvp * vec4f(p, 1.); o.normal = normalize((u.model * vec4f(norm, 0.)).xyz);
  // quest_cockpit_vk.inc shades cabin, wheel and textured gloves in mesh space.
  o.shade=.78+.22*max(dot(normalize(norm),normalize(vec3f(-.3,.9,-.2))),0.);
  o.uv = uv; o.local = p0; return o;
}
${LED_SHADER}
@fragment fn fs(i: Out) -> @location(0) vec4f {
  if (u.info.x == 0. && i.local.z > u.info.y) { discard; }
  let sampled = textureSample(picture, samp, i.uv);
  if (u.info.x == 4.) { if(sampled.a < .01) { discard; } return sampled; }
  var c = sampled.rgb;
  if (u.info.x == 3.) { return vec4f(c, u.info.z); }
  if (u.info.x == 2.) {
    c = vec3f(.13, .16, .22);
    if (i.local.z < -.055 && i.local.y > -.06 && i.local.y < .05) { c = vec3f(.025, .07, .12); }
  }
  if (u.info.x == 0. || u.info.x == 1.) {
    if(sampled.a < .5) { discard; }
    c *= i.shade*i.shade*vec3f(.51,.49,.54);
  } else {
    c *= .65 + .35 * max(0., dot(normalize(i.normal), normalize(vec3f(.3, -.5, 1.))));
  }
  if (u.info.x == 0.) { c += (1.-c)*u.led.rgb*trimLight(i.local)*u.led.a; }
  return vec4f(c, 1.);
}`;

/** Remote cabins share world depth. The local cabin follows the native mod's
 * final pass with its own depth, replacing the retail low-detail interior
 * while keeping the original hood, pillars, roof and body around it. */
export class DriverRenderer {
  readonly hud?:HudPanels;
  readonly mirrors?:MirrorRenderer;
  private seats?:SeatRenderer;
  private layout: GPUBindGroupLayout;
  private uniform: GPUBuffer;
  private sampler: GPUSampler;
  private noMorph:GPUBuffer;
  private pipelines = new Map<number, GPURenderPipeline>();
  private cabin: Mesh | null = null;
  private glove: Mesh | null = null;
  private head: Mesh | null = null;
  private screen: Mesh | null = null;
  private guide: Mesh | null = null;
  private guideCanvas = new ShifterGuide();
  private disposed = false;
  private reported = false;
  private replacedCards=Array.from({length:6},()=>new Set<number>());
  replacesDriver(view:number,slot:number):boolean{return this.replacedCards[view]?.has(slot)??false;}
  readonly ready: Promise<void>;
  constructor(private device: GPUDevice, private avatars: () => ReadonlyMap<number, RemoteAvatar>, private log: (s: string) => void, private cockpit?: Cockpit) {
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 208 } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {type:'read-only-storage',minBindingSize:32} },
    ] });
    // Each local view is encoded before one submit: its uniforms must survive
    // subsequent cameras' queue writes. Slots 64..69 belong to the local cabin.
    this.uniform = device.createBuffer({ size: 390 * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.noMorph=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE});
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    if (cockpit) {
      this.hud=new HudPanels(device);
      this.mirrors=new MirrorRenderer(device);
      this.seats=new SeatRenderer(device);
      const texture = device.createTexture({ size: [1024,640], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.screen = this.mesh(new Float32Array([-.5,-.5,0,0,0,1,0,1, .5,-.5,0,0,0,1,1,1, -.5,.5,0,0,0,1,0,0, .5,.5,0,0,0,1,1,0]),new Uint32Array([0,1,2,2,1,3]),texture);
      const guideTexture=device.createTexture({size:[512,512],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      this.guide=this.mesh(new Float32Array([-.5,-.5,0,0,0,1,0,1, .5,-.5,0,0,0,1,1,1, -.5,.5,0,0,0,1,0,0, .5,.5,0,0,0,1,1,0]),new Uint32Array([0,1,2,2,1,3]),guideTexture);
    }
    this.ready = Promise.all([this.load('cabin'), this.load('glove')]).then(([cabin, glove]) => {
      if (this.disposed) { this.free(cabin); this.free(glove); return; }
      this.cabin = cabin; this.glove = glove;
      const vertices: number[] = [], indices: number[] = [], nx = 20, ny = 12;
      for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
        const a = x/nx*Math.PI*2, b = y/ny*Math.PI, px = Math.sin(b)*Math.cos(a), py = Math.cos(b), pz = Math.sin(b)*Math.sin(a);
        vertices.push(px*.105, py*.145, pz*.12, px, py, pz, x/nx, y/ny);
        if (x < nx && y < ny) { const i = y*(nx+1)+x; indices.push(i,i+1,i+nx+1,i+1,i+nx+2,i+nx+1); }
      }
      const texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture }, new Uint8Array([255,255,255,255]), { bytesPerRow: 4 }, [1,1]);
      this.head = this.mesh(new Float32Array(vertices), new Uint32Array(indices), texture);
      log('[vr] remote cockpit and glove meshes ready');
    }).catch(e => { log(`[vr] driver assets: ${e}`); });
  }
  private mesh(vertices: Float32Array<ArrayBuffer>, indices: Uint32Array<ArrayBuffer>, texture: GPUTexture,opened?:Float32Array<ArrayBuffer>): Mesh {
    const buffer = (data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, usage: number) => {
      const b = this.device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(b, 0, data); return b;
    };
    const morph=opened?buffer(opened,GPUBufferUsage.STORAGE):undefined;
    return { vertices: buffer(vertices, GPUBufferUsage.VERTEX), indices: buffer(indices, GPUBufferUsage.INDEX), opened:morph,count: indices.length, texture,
      bind: this.device.createBindGroup({ layout: this.layout, entries: [
        { binding: 0, resource: { buffer: this.uniform, size: 208 } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: this.sampler },
        { binding: 3, resource: {buffer:morph??this.noMorph} },
      ] }) };
  }
  private async load(name: string): Promise<Mesh> {
    const [bin, pic] = await Promise.all([fetch(`/vr-${name}.nvwm`), fetch(`/vr-${name}.png`)]);
    if (!bin.ok || !pic.ok) throw new Error(`Cannot load ${name}`);
    const { vertices, indices,opened } = meshData(await bin.arrayBuffer()), bitmap = await createImageBitmap(await pic.blob());
    try {
      const texture = this.device.createTexture({ size: [bitmap.width, bitmap.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
      return this.mesh(vertices, indices, texture,name==='glove'?opened??vertices:undefined);
    } finally { bitmap.close(); }
  }
  private pipeline(samples: number, translucent=false): GPURenderPipeline {
    const key=samples+(translucent?16:0);
    let p = this.pipelines.get(key);
    if (!p) {
      const module = this.device.createShaderModule({ code: CODE });
      p = this.device.createRenderPipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
        vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' },
        ] }] }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'bgra8unorm', blend: { color: {srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'}, alpha: {srcFactor:'one',dstFactor:'one-minus-src-alpha'} } }] }, primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: !translucent, depthCompare: 'less-equal' }, multisample: { count: samples },
      }); this.pipelines.set(key, p);
    }
    return p;
  }
  get localActive(): boolean { return !!(this.cockpit?.scene?.cockpit || this.cockpit?.scene?.replay); }
  updateScene(buffer:ArrayBufferLike,k:number,length:number):ReturnType<typeof readDriverScene>{
    const scene = readDriverScene(buffer, k, length);
    if(scene)this.cockpit?.update(scene);else if(this.cockpit)this.cockpit.scene=null;
    if(this.mirrors&&this.cockpit)this.mirrors.resolution=this.cockpit.settings.mirrorResolution;
    return scene;
  }
  draw(pass: GPURenderPassEncoder, buffer: ArrayBufferLike, k: number, length: number, eye: Mat4 | undefined, samples: number, local = false, hud = false, prepared?:ReturnType<typeof readDriverScene>, viewSlot=0): number {
    if(!local)this.replacedCards[viewSlot]?.clear();
    const scene=prepared===undefined?this.updateScene(buffer,k,length):prepared;
    if (!scene) return 0;
    if (!this.cabin || !this.glove || !this.head || this.disposed) return 0;
    const view=scene.views?.[viewSlot]??(!viewSlot?scene:null);
    if(!view || viewSlot<0 || viewSlot>5)return 0;
    const camera = inverse(view.view); if (!camera) return 0;
    const distance = (m: Mat4) => Math.hypot(m[12]-camera[12], m[13]-camera[13], m[14]-camera[14]);
    const candidates=[...scene.cars];
    if(viewSlot!==0 && scene.local)candidates.push(scene.local);
    if(viewSlot!==1 && scene.secondary)candidates.push(scene.secondary);
    const cars = (local || this.cockpit?.settings.avatars===false?[]:candidates).filter(c => distance(c.matrix) < 45).sort((a,b) => distance(a.matrix)-distance(b.matrix)).slice(0,16);
    const pv = multiply(eye ?? identity(), multiply(view.projection, view.view)), data = new Float32Array(64*64), first = local ? 64 : viewSlot?70+(viewSlot-1)*64:0;
    const items: { mesh: Mesh; offset: number }[] = [], poses = this.avatars(), now = performance.now();
    const add = (mesh: Mesh, model: Mat4, fit: readonly number[], kind: number, rear = 20, led: number[] = [0,0,0,0], steer=0, lever: readonly number[]=[0,0], travel: readonly number[]=[0,0,0],fingers:readonly number[]=[1,0]) => {
      const off = items.length * 64; data.set(multiply(pv, model), off); data.set(model, off+16); data.set(fit, off+32); data.set([kind, rear, fingers[0], steer], off+36);
      items.push({ mesh, offset: first*256+off*4 });
      data.set(led,off+40);
      data.set(lever,off+44);data[off+46]=fingers[1];data.set(travel,off+48);
    };
    for (const car of cars) {
      const c=this.cockpit,tracked=car===scene.local?c?.tracking:null;
      const own=tracked&&c?{...flatDriver(),vr:true,head:poseFromMatrix(tracked.head),left:c.handPose(0),right:c.handPose(1),wheel:c.wheelVisual??undefined,fingers:c.fingers}:flatDriver();
      const base = cabinMatrix(car), fit = fitFor(car.model), pose = car===scene.secondary||car===scene.local?{...own,cockpit:c?.appearance()??0}:driverForCar(poses.get(car.vip),car,!!scene.peers?.length,now);
      add(this.cabin, base, fit.slice(3,7), 0, fit[7],appearanceLED(pose?.cockpit??0),pose?.wheel??wheelFromSteer(car.steer),pose?.shifter,pose?.pedals);
      if (!pose) continue;
      if (pose.head) {
        add(this.head, translated(multiply(base, poseMatrix(pose.head)), 0, -.015, .04), [1,1,1,1], 2);
        this.replacedCards[viewSlot].add(car===scene.local?65:car===scene.secondary?66:scene.cars.indexOf(car)+1);
      }
      for (const [i, hand] of [pose.left, pose.right].entries()) if (hand) {
        // The shared pose is grip-space; apply the native glove basis once.
        const axes = gloveAxes(i);
        add(this.glove, multiply(multiply(base, poseMatrix(hand)), axes), [1,1,1,1], 1,undefined,undefined,undefined,undefined,undefined,pose.fingers?.slice(i*2,i*2+2));
      }
    }
    const remoteMeshes=items.length-cars.length;
    if (local && scene.cockpit && scene.local && this.cockpit) {
      const base=cabinMatrix(scene.local), fit=fitFor(scene.local.model);
      add(this.cabin,base,fit.slice(3,7),0,fit[7],this.cockpit.led(),this.cockpit.wheelVisual??wheelFromSteer(scene.local.steer),[this.cockpit.shifter.x,this.cockpit.shifter.z],this.cockpit.pedalTravel);
      for(let i=0;i<2;i++) { const hand=this.cockpit.handMatrix(i); if(hand)add(this.glove,multiply(base,hand),[1,1,1,1],1,undefined,undefined,undefined,undefined,undefined,this.cockpit.fingers.slice(i*2,i*2+2)); }
    }
    if (!this.reported && remoteMeshes > 0) {
      this.reported = true; this.log(`[vr] drawing ${cars.length} remote cockpit(s) with ${remoteMeshes} head/hand meshes`);
    }
    if (!items.length) return local&&hud&&scene.replay?this.hud?.draw(pass,scene,eye,samples)??0:0;
    this.device.queue.writeBuffer(this.uniform, first*256, data.subarray(0, items.length*64));
    pass.setPipeline(this.pipeline(samples));
    let extra=0;
    for (const item of items) {
      const bind=()=>{pass.setBindGroup(0,item.mesh.bind,[item.offset]);pass.setVertexBuffer(0,item.mesh.vertices);pass.setIndexBuffer(item.mesh.indices,'uint32');};
      bind();
      if(local && item.mesh===this.cabin){
        // Baked instrument trim first, readable retail gauge second, physical
        // rim and tracked hands last (the native cockpit compositor's order).
        if(wheel.indexFirst)pass.drawIndexed(wheel.indexFirst);
        const end=wheel.indexFirst+wheel.indexCount;
        if(end<item.mesh.count)pass.drawIndexed(item.mesh.count-end,1,end);
        if(hud&&!scene.replay)extra+=this.hud?.draw(pass,scene,eye,samples,this.cockpit?.settings,this.cockpit?.mapGrip.hover.some(Boolean))??0;
        const seat=this.cockpit?[0,this.cockpit.settings.height,-this.cockpit.settings.forward]:[0,0,0];
        const angles=this.cockpit?[0,1,2].map(p=>mirrorAngle(this.cockpit!.mirrors,p)):undefined;
        extra+=this.mirrors?.draw(pass,scene,eye,samples,angles,seat)??0;
        extra+=this.seats?.draw(pass,scene,eye,samples,this.cockpit?.seatHover??0)??0;
        pass.setPipeline(this.pipeline(samples));bind();pass.drawIndexed(wheel.indexCount,1,wheel.indexFirst);
      } else pass.drawIndexed(item.mesh.count);
    }
    if(local&&hud&&scene.replay)extra+=this.hud?.draw(pass,scene,eye,samples)??0;
    return items.length+extra;
  }
  drawScreen(pass: GPURenderPassEncoder, eye: Mat4 | undefined, samples: number): number {
    const c=this.cockpit, s=c?.scene, mesh=this.screen;
    if (!c || !s?.cockpit || !s.local || !mesh || this.disposed) return 0;
    if (c.paint()) this.device.queue.copyExternalImageToTexture({source:c.canvas},{texture:mesh.texture},[1024,640]);
    const mount=screenMount(s.local.model,c.settings), scale=identity(); scale[0]=mount.width;scale[5]=mount.height;
    const model=multiply(cabinMatrix(s.local),multiply(mount.matrix,scale)), data=new Float32Array(52);
    data.set(multiply(eye??identity(),multiply(s.projection,multiply(s.view,model))));data.set(model,16);data.set([3,20,c.settings.opacity,0],36);
    this.device.queue.writeBuffer(this.uniform,67*256,data);
    const guide=this.guide;let count=1;
    if(guide && this.guideCanvas.visible(c)){
      if(this.guideCanvas.paint(c))this.device.queue.copyExternalImageToTexture({source:this.guideCanvas.canvas},{texture:guide.texture},[512,512]);
      const gm=multiply(cabinMatrix(s.local),guideMount(s.local.model,s.gearbox!.count,!!c.settings.shift.mode).matrix);
      data.fill(0);data.set(multiply(eye??identity(),multiply(s.projection,multiply(s.view,gm))));data.set(gm,16);data.set([4,20,1,0],36);
      this.device.queue.writeBuffer(this.uniform,68*256,data);
      pass.setPipeline(this.pipeline(samples));pass.setBindGroup(0,guide.bind,[68*256]);pass.setVertexBuffer(0,guide.vertices);pass.setIndexBuffer(guide.indices,'uint32');pass.drawIndexed(guide.count);count++;
    }
    // The encoder calls this after cabin, wheel and hands. Finish the guide
    // first as well: alpha glass tests their depth and blends over their colour.
    pass.setPipeline(this.pipeline(samples,true));pass.setBindGroup(0,mesh.bind,[67*256]);pass.setVertexBuffer(0,mesh.vertices);pass.setIndexBuffer(mesh.indices,'uint32');pass.drawIndexed(mesh.count);
    return count;
  }

  private free(m: Mesh) { m.vertices.destroy(); m.indices.destroy(); m.texture.destroy();m.opened?.destroy(); }
  destroy(): void { this.disposed = true; for (const m of [this.cabin, this.glove, this.head, this.screen, this.guide]) if (m) this.free(m); this.uniform.destroy();this.noMorph.destroy();this.hud?.destroy();this.mirrors?.destroy();this.seats?.destroy(); }
}

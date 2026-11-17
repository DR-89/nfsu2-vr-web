import { cabinMatrix, fitFor, type DriverScene } from './drivers';
import { fitPoint } from './fit';
import { identity, inverse, multiply, GAME_TO_XR, type Mat4 } from './math';
import { mapMount } from './panel-grip';
import { vrSettings, type VRSettings } from './settings';
import { gpsText, gpsVertices } from './gps';
const defaults=vrSettings({});

/** Replay controls keep their complete 4:3 frontend layout on one surface
 * three metres ahead of the recentered viewer, independent of camera cuts. */
export function replayPanel():Float32Array<ArrayBuffer>{
  return new Float32Array([0,1,2,0,2,3].flatMap(c=>{
    const right=c===1||c===2,bottom=c>=2;
    return [right?1.4:-1.4,bottom?-1.05:1.05,-3,Number(right),Number(bottom),0];
  }));
}
export function replayPanelView(scene:DriverScene,eye?:Mat4):Mat4{
  return multiply(eye??identity(),multiply(scene.projection,multiply(GAME_TO_XR,scene.headView??identity())));
}

/** Native physical mounts with PC frontend crops in 640x480 space. The PC
 * turbo dial reaches x=400; its map is centred at the (-223,142) FE anchor
 * plus (320,240), with a 75-unit radius (HUD_SingleRace). */
export function hudPanels(model: string): Float32Array<ArrayBuffer> {
  const fit=fitFor(model), v:number[]=[], corners=[0,1,2,0,2,3];
  const panel=(x:number,y:number,z:number,w:number,h:number,crop:number[],kind=0,place?:(p:number[],uv:number[])=>number[])=>{
    for(const c of corners){
      const right=c===1||c===2,bottom=c>=2,uv=[crop[right?2:0]/640,crop[bottom?3:1]/480];
      let p=[x+(right?.5:-.5)*w,y+(bottom?-.5:.5)*h,z];
      if(place)p=place(p,uv);v.push(...p,...uv,kind);
    }
  };
  // Preserve the primary dial's native x=540 alignment; extend the surface
  // left by 40 pixels for the PC turbo dial, without shrinking the text.
  panel(fit[6]<0?.024:-.024,-.205,-.66,.288,.24,[400,260,640,480],0,(p,uv)=>{if(fit[6]<0)uv[0]=1040/640-uv[0];return fitPoint(p,fit);});
  const center=fitPoint([.3116,-.155,-.463],fit),slope=-.4*fit[5],up=1/Math.hypot(1,slope);
  panel(0,0,0,.15,.15,[0,0,640,480],1,p=>[center[0]+p[0],center[1]+p[1]*up,center[2]+p[1]*up*slope]);
  // PC bank/standings can start left of the Xbox's 448-pixel crop. Every
  // remaining windshield rectangle meets this window crop without overlap.
  for(const [x0,y0,x1,y1] of [[0,0,640,40],[0,40,400,244],[640,40,640,244],[0,244,640,260],[200,260,400,480]])
    panel(((x0+x1)/2-320)*2.8/640,1.45-(y0+y1)/2*1.7/480,-3,(x1-x0)*2.8/640,(y1-y0)*1.7/480,[x0,y0,x1,y1]);
  const right=fit[6]<0,scale=right?.0008:.0014;
  panel(0,0,0,1,1,[400,40,640,244],0,(_p,uv)=>{
    const y=(right?-.020:.003)+(132-480*uv[1])*scale;
    return [fit[8]-.025-y*fit[9],y,(right?-.110:-.038)+(640*uv[0]-535)*scale];
  });
  return new Float32Array(v);
}

const CODE=`
struct Transform {mvp:mat4x4f,map:mat4x4f,hover:vec4f}
@group(0) @binding(0) var<uniform> transform:Transform;
@group(0) @binding(1) var hud:texture_2d<f32>;
@group(0) @binding(2) var samp:sampler;
struct Out { @builtin(position) p:vec4f, @location(0) uv:vec2f, @location(1) @interpolate(flat) kind:u32 }
@vertex fn vs(@location(0) p:vec3f,@location(1) uv:vec2f,@location(2) kind:f32)->Out {
  var o:Out;var position=vec4f(p,1.);if(kind>=1.){position=transform.map*position;}
  o.p=transform.mvp*position;o.uv=uv;o.kind=u32(kind);return o;
}
@fragment fn fs(i:Out)->@location(0) vec4f {
  let p=i.uv-.5;let mapUV=(vec2f(97.,382.)+p*150.)/vec2f(640.,480.);
  let h=textureSample(hud,samp,select(i.uv,mapUV,i.kind==1u));
  let d=length(p);let aa=clamp(fwidth(d),.001,.04);
  if(i.kind==2u){return vec4f(.09,.12,.16,1.);}
  if(i.kind==3u){return vec4f(.94,.97,1.,1.);}
  if(i.kind==1u){
    let coverage=1.-smoothstep(.5-aa,.5,d);if(coverage<=0.){discard;}
    let face=h.rgb+(1.-h.a)*vec3f(.042,.052,.06);
    let rim=select(vec3f(.12,.15,.17),vec3f(.30,.80,1.),transform.hover.x>0.);
    return vec4f(mix(face,rim,smoothstep(.48-aa,.48,d))*coverage,coverage);
  }
  if(h.a<.001){discard;}return h;
}`;

/** One transparent capture per guest frame; every eye samples the same image. */
export class HudPanels {
  readonly texture:GPUTexture;
  readonly view:GPUTextureView;
  private uniform:GPUBuffer;
  private layout:GPUBindGroupLayout;
  private bind:GPUBindGroup;
  private vertices=new Map<string,GPUBuffer>();
  private pipelines=new Map<number,GPURenderPipeline>();
  private gps:GPUBuffer;
  private gpsKey='';
  private gpsCount=0;
  constructor(private device:GPUDevice){
    this.texture=device.createTexture({label:'Original cockpit HUD',size:[1280,960],format:'bgra8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
    this.view=this.texture.createView();
    this.uniform=device.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.gps=device.createBuffer({label:'Cockpit GPS text',size:(24*35+1)*6*24,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
    this.bind=device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:this.view},{binding:2,resource:device.createSampler({minFilter:'linear',magFilter:'linear'})}]});
  }
  private pipeline(samples:number,gauge:boolean):GPURenderPipeline{
    const key=samples*2+Number(gauge);let p=this.pipelines.get(key);
    if(!p){
      const module=this.device.createShaderModule({code:CODE});
      p=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.layout]}),vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x2'},{shaderLocation:2,offset:20,format:'float32'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:'bgra8unorm',blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:!gauge,depthCompare:gauge?'always':'less-equal'},multisample:{count:samples}});
      this.pipelines.set(key,p);
    }return p;
  }
  draw(pass:GPURenderPassEncoder,scene:DriverScene,eye:Mat4|undefined,samples:number,settings:VRSettings=defaults,hover=false):number{
    if(scene.replay){
      let buffer=this.vertices.get('@replay');
      if(!buffer){const data=replayPanel();buffer=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(buffer,0,data);this.vertices.set('@replay',buffer);}
      this.device.queue.writeBuffer(this.uniform,0,replayPanelView(scene,eye));
      pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,buffer);pass.setPipeline(this.pipeline(samples,true));pass.draw(6);return 1;
    }
    if(!scene.cockpit||!scene.local)return 0;
    const model=scene.local.model;let buffer=this.vertices.get(model);
    if(!buffer){const data=hudPanels(model);buffer=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(buffer,0,data);this.vertices.set(model,buffer);}
    this.device.queue.writeBuffer(this.uniform,0,multiply(eye??identity(),multiply(scene.projection,multiply(scene.view,cabinMatrix(scene.local)))));
    this.device.queue.writeBuffer(this.uniform,64,multiply(mapMount(model,settings).matrix,inverse(mapMount(model,defaults).matrix)!));
    this.device.queue.writeBuffer(this.uniform,128,new Float32Array([Number(hover),0,0,0]));
    pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,buffer);
    pass.setPipeline(this.pipeline(samples,true));pass.draw(6);
    pass.setPipeline(this.pipeline(samples,false));pass.draw(42,1,6);
    const text=gpsText(scene.gps),key=model+':'+text;
    if(key!==this.gpsKey){const v=gpsVertices(model,text);this.gpsKey=key;this.gpsCount=v.length/6;if(v.length)this.device.queue.writeBuffer(this.gps,0,v);}
    if(this.gpsCount){pass.setVertexBuffer(0,this.gps);pass.draw(this.gpsCount);}
    return 2+Number(!!this.gpsCount);
  }
  destroy():void{this.texture.destroy();this.uniform.destroy();this.gps.destroy();for(const b of this.vertices.values())b.destroy();}
}

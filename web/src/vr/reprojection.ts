import {identity,inverse,multiply,type Mat4} from './math';
export interface EyePose {projection:Float32Array;view:Float32Array}
/** Map a current eye ray into the cached eye image. Translation requires a
 * depth image; ignoring it here avoids inventing a depth for road and cockpit.
 * The full stereo scene uses the latest six-degree pose on every new frame. */
export function rotationWarp(recorded:EyePose|undefined,current:EyePose):Mat4 {
  if(!recorded)return identity();
  const rotation=(m:Float32Array)=>{const r=new Float32Array(m);r[12]=r[13]=r[14]=0;return r;};
  if(recorded.projection.every((v,i)=>v===current.projection[i])&&recorded.view.slice(0,12).every((v,i)=>v===current.view[i]))return identity();
  const p=inverse(current.projection),v=inverse(rotation(current.view));
  return p&&v?multiply(recorded.projection,multiply(rotation(recorded.view),multiply(v,p))):identity();
}
const shader=`
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var linear:sampler;
@group(0) @binding(2) var<uniform> warp:mat4x4f;
struct Out {@builtin(position) position:vec4f,@location(0) clip:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {
  let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.-1.;
  return Out(vec4f(p,0.,1.),p);
}
@fragment fn fs(p:Out)->@location(0) vec4f {
  let q=warp*vec4f(p.clip,1.,1.);
  let uv=q.xy/q.w*vec2f(.5,-.5)+.5;
  if(q.w<=0.||any(uv<vec2f(0.))||any(uv>vec2f(1.))){return vec4f(0.,0.,0.,1.);}
  return vec4f(textureSampleLevel(image,linear,uv,0.).rgb,1.);
}`;
/** Direct WebGPU XR uses the same late rotation as the WebGL bridge. */
export class EyePresenter {
  private module:GPUShaderModule;
  private layout:GPUBindGroupLayout;
  private sampler:GPUSampler;
  private buffers:GPUBuffer[];
  private pipes=new Map<GPUTextureFormat,GPURenderPipeline>();
  private groups=[new WeakMap<GPUTextureView,GPUBindGroup>(),new WeakMap<GPUTextureView,GPUBindGroup>()];
  constructor(private device:GPUDevice){
    this.module=device.createShaderModule({label:'XR late rotation',code:shader});
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
    this.buffers=[0,1].map(()=>device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
  }
  draw(command:GPUCommandEncoder,index:number,source:GPUTextureView,target:GPUTextureView,format:GPUTextureFormat,viewport:{x:number;y:number;width:number;height:number},warp:Mat4):void {
    let pipe=this.pipes.get(format);
    if(!pipe){pipe=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.layout]}),vertex:{module:this.module,entryPoint:'vs'},fragment:{module:this.module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});this.pipes.set(format,pipe);}
    let group=this.groups[index].get(source);
    if(!group){group=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:source},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.buffers[index]}}]});this.groups[index].set(source,group);}
    this.device.queue.writeBuffer(this.buffers[index],0,warp);
    const pass=command.beginRenderPass({colorAttachments:[{view:target,loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
    pass.setPipeline(pipe);pass.setBindGroup(0,group);pass.setViewport(viewport.x,viewport.y,viewport.width,viewport.height,0,1);pass.draw(3);pass.end();
  }
  destroy():void{this.buffers.forEach(b=>b.destroy());}
}

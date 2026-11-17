import type { DriverScene } from './drivers';
import { cabinMatrix } from './drivers';
import { inverse,multiply,type Mat4 } from './math';
import { mirrorCamera,mirrorEye,mirrorMounts,mirrorMvp,mirrorNormal,mirrorRotate,type MirrorAngle } from './mirrors';

export const MIRROR_SHADER=`
struct U { mvp:mat4x4f, rear:mat4x4f, eye:vec4f, normal:vec4f, origin:vec4f, projection:vec4f }
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var picture:texture_2d<f32>;
@group(0) @binding(2) var depth:texture_depth_2d;
@group(0) @binding(3) var linear:sampler;
struct Out { @builtin(position) position:vec4f, @location(0) glass:vec3f }
@vertex fn vs(@location(0) p:vec3f)->Out {var o:Out;o.position=u.mvp*vec4f(p,1.);o.glass=p;return o;}
fn inside(p:vec2f)->bool{return all(p>=vec2f(0.))&&all(p<=vec2f(1.));}
fn inverseDepth(p:vec2f)->f32{
  let size=textureDimensions(depth);let at=clamp(vec2i(p*vec2f(size)),vec2i(0),vec2i(size)-1);
  return (textureLoad(depth,at,0)-u.projection.z)/u.projection.w;
}
@fragment fn fs(i:Out)->@location(0) vec4f{
  let ray=(u.rear*vec4f(reflect(normalize(i.glass-u.eye.xyz),normalize(u.normal.xyz)),0.)).xyz;
  let origin=(u.rear*vec4f(i.glass-u.origin.xyz,0.)).xyz;
  if(ray.z<=.001){return vec4f(.012,.015,.02,1.);}
  let slope=ray.xy/ray.z;
  let farUV=vec2f(.5)+.5*u.projection.xy*slope;
  let offset=.5*u.projection.xy*(origin.xy-origin.z*slope);
  var uv=farUV;
  if(dot(offset,offset)>1e-8){
    let nearZ=max(max(origin.z,.01),-u.projection.w/u.projection.z);
    let nearInv=1./nearZ;let farInv=max(0.,(1.-u.projection.z)/u.projection.w);var previous=nearInv;
    let pixels=length(offset*vec2f(textureDimensions(depth)));
    let steps=i32(clamp(ceil(pixels*(nearInv-farInv)),16.,128.));
    for(var j=0;j<=steps;j++){
      let iz=mix(nearInv,farInv,f32(j)/f32(steps));let p=farUV+offset*iz;
      if(inside(p)&&iz<=inverseDepth(p)){
        let surface=inverseDepth(p);let candidate=farUV+offset*surface;
        if(surface<=previous&&inside(candidate)&&abs(inverseDepth(candidate)-surface)*pixels<=.75){uv=candidate;break;}
        var a=previous;var b=iz;
        for(var k=0;k<6;k++){let mid=.5*(a+b);let q=farUV+offset*mid;if(inside(q)&&mid<=inverseDepth(q)){b=mid;}else{a=mid;}}
        let hit=farUV+offset*b;
        // Crossing a depth silhouette is not a surface intersection. Reject
        // it unless the sampled surface projects back within one texel.
        if(abs(inverseDepth(hit)-b)*pixels<=.75){uv=hit;break;}
      }
      previous=iz;
    }
  }
  if(!inside(uv)){return vec4f(.012,.015,.02,1.);}
  return vec4f(textureSampleLevel(picture,linear,uv,0.).rgb,1.);
}`;

export class MirrorRenderer{
  resolution=1024;
  private uniform:GPUBuffer;
  private vertices:GPUBuffer;
  private layout:GPUBindGroupLayout;
  private sampler:GPUSampler;
  private pipelines=new Map<number,GPURenderPipeline>();
  private source:{color:GPUTexture;depth:GPUTexture;bind:GPUBindGroup}|null=null;
  constructor(private device:GPUDevice){
    this.uniform=device.createBuffer({label:'Mirror optical eyes',size:3*256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.vertices=device.createBuffer({label:'Original mirror glass',size:3*192*12,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:192}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
  }
  setSource(color:GPUTexture|null,depth:GPUTexture|null):void{
    if(!color || !depth){this.source=null;return;}
    if(this.source?.color===color&&this.source.depth===depth)return;
    const bind=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:192}},{binding:1,resource:color.createView()},{binding:2,resource:depth.createView()},{binding:3,resource:this.sampler}]});
    this.source={color,depth,bind};
  }
  private pipeline(samples:number):GPURenderPipeline{
    let p=this.pipelines.get(samples);if(p)return p;
    const module=this.device.createShaderModule({label:'Depth-reprojected cockpit mirror',code:MIRROR_SHADER});
    p=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.layout]}),vertex:{module,entryPoint:'vs',buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:'bgra8unorm'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less-equal'},multisample:{count:samples}});
    this.pipelines.set(samples,p);return p;
  }
  draw(pass:GPURenderPassEncoder,scene:DriverScene,eye:Mat4|undefined,samples:number,angles:MirrorAngle[]=[{yaw:0,pitch:0},{yaw:0,pitch:0},{yaw:0,pitch:0}],seat:number[]=[0,0,0]):number{
    const camera=mirrorCamera(scene),mvp=mirrorMvp(scene,eye),source=this.source;
    if(!source || !camera || !mvp || !scene.local || !scene.mirrors?.active || !scene.cockpit)return 0;
    const center=inverse(multiply(scene.view,cabinMatrix(scene.local)));if(!center)return 0;
    const opticalEye=mirrorEye(mvp,Array.from(center.subarray(12,15)),seat);if(!opticalEye)return 0;
    const p=scene.mirrors.projection;
    if(!(p[0]>.01&&p[5]<-.01&&p[10]>=1&&p[14]<0))return 0;
    const mounts=mirrorMounts(scene),data=new Float32Array(3*64),vertices=new Float32Array(3*192*3);let count=0;
    for(let part=0;part<3;part++){
      const mount=mounts[part];if(!mount)continue;const angle=angles[part],off=part*64;
      data.set(mvp,off);data.set(camera.view,off+16);data.set(opticalEye,off+32);data.set(mirrorNormal(mount,part,angle,seat),off+36);data.set(camera.origin,off+40);
      data.set([p[0],-p[5],p[10],p[14]],off+44);
      for(let i=0;i<mount.vertices.length;i+=3){const q=mirrorRotate(Array.from(mount.vertices.subarray(i,i+3)).map((v,k)=>v-mount.center[k]),angle);vertices.set(q.map((v,k)=>v+mount.center[k]),part*192*3+i);}
      count++;
    }
    if(!count)return 0;
    this.device.queue.writeBuffer(this.uniform,0,data);this.device.queue.writeBuffer(this.vertices,0,vertices);
    pass.setPipeline(this.pipeline(samples));pass.setVertexBuffer(0,this.vertices);
    for(let part=0;part<3;part++)if(mounts[part]){pass.setBindGroup(0,source.bind,[part*256]);pass.draw(mounts[part]!.vertices.length/3,1,part*192);}
    return count;
  }
  destroy():void{this.uniform.destroy();this.vertices.destroy();this.source=null;}
}

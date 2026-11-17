import { cabinMatrix,type DriverScene } from './drivers';
import { identity,multiply,type Mat4 } from './math';
import { SeatCanvas,seatMount,seatLayout } from './seat-controls';
import type {PanelMount} from './panel-grip';

const CODE=`
@group(0) @binding(0) var<uniform> mvp:mat4x4f;
@group(0) @binding(1) var picture:texture_2d<f32>;
@group(0) @binding(2) var linear:sampler;
struct Out {@builtin(position) p:vec4f,@location(0) uv:vec2f}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{
  let corners=array<vec2f,6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(1.,1.),vec2f(0.,0.),vec2f(1.,1.),vec2f(0.,1.));
  let uv=corners[i];var o:Out;o.p=mvp*vec4f(uv.x-.5,.5-uv.y,0.,1.);o.uv=uv;return o;
}
@fragment fn fs(i:Out)->@location(0) vec4f{let c=textureSample(picture,linear,i.uv);if(c.a<.5){discard;}return c;}
`;
export class SeatRenderer {
  private canvas=new SeatCanvas();
  private surface:CabinSurface;
  constructor(device:GPUDevice){this.surface=new CabinSurface(device,'Seat armrest buttons',seatLayout.width,seatLayout.height);}
  draw(pass:GPURenderPassEncoder,scene:DriverScene,eye:Mat4|undefined,samples:number,hover:number):number{
    if(!scene.cockpit||!scene.local)return 0;
    if(this.canvas.paint(hover))this.surface.upload(this.canvas.canvas);
    return this.surface.draw(pass,scene,eye,samples,seatMount(scene.local.model));
  }
  destroy():void{this.surface.destroy();}
}
/** Shared textured, depth-tested face for the physical cabin controls. */
export class CabinSurface {
  private texture:GPUTexture;
  private uniform:GPUBuffer;
  private layout:GPUBindGroupLayout;
  private bind:GPUBindGroup;
  private pipes=new Map<number,GPURenderPipeline>();
  constructor(private device:GPUDevice,label:string,private width:number,private height:number){
    this.texture=device.createTexture({label,size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    this.uniform=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
    this.bind=device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:this.texture.createView()},{binding:2,resource:device.createSampler({magFilter:'linear',minFilter:'linear'})}]});
  }
  upload(canvas:HTMLCanvasElement):void{this.device.queue.copyExternalImageToTexture({source:canvas},{texture:this.texture},[this.width,this.height]);}
  draw(pass:GPURenderPassEncoder,scene:DriverScene,eye:Mat4|undefined,samples:number,mount:PanelMount):number{
    if(!scene.cockpit||!scene.local)return 0;
    let pipe=this.pipes.get(samples);
    if(!pipe){
      const module=this.device.createShaderModule({label:'Cabin control face',code:CODE});
      pipe=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'bgra8unorm'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less-equal'},multisample:{count:samples}});this.pipes.set(samples,pipe);
    }
    const scale=identity();scale[0]=mount.width;scale[5]=mount.height;
    const model=multiply(cabinMatrix(scene.local),multiply(mount.matrix,scale));
    this.device.queue.writeBuffer(this.uniform,0,multiply(eye??identity(),multiply(scene.projection,multiply(scene.view,model))));
    pass.setPipeline(pipe);pass.setBindGroup(0,this.bind);pass.draw(6);return 1;
  }
  destroy():void {this.texture.destroy();this.uniform.destroy();}
}

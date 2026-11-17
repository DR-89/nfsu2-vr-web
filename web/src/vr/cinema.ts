import { identity,multiply,type Mat4 } from './math';
export interface ScreenOverlay {canvas:HTMLCanvasElement;revision:number;model:Mat4}

/** Native menu quad: 4.8 m wide, 3 m away. Preserve the PC back buffer's
 * aspect ratio; its original menus, movies and loading screens stay intact. */
export function cinemaMatrix(width:number,height:number,seatHeight=0,seatForward=0):Mat4{
  const model=identity();model[0]=4.8;model[5]=4.8*height/width;
  model[13]=seatHeight;model[14]=-3-seatForward;return model;
}
const CODE=`
@group(0) @binding(0) var<uniform> mvp:mat4x4f;
@group(0) @binding(1) var picture:texture_2d<f32>;
@group(0) @binding(2) var linear:sampler;
struct Out {@builtin(position) p:vec4f,@location(0) uv:vec2f}
@vertex fn vs(@builtin(vertex_index) i:u32)->Out{
  let points=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));
  let uv=points[i];var o:Out;o.p=mvp*vec4f(uv.x-.5,.5-uv.y,0,1);o.uv=uv;return o;
}
@fragment fn fs(i:Out)->@location(0) vec4f{return textureSample(picture,linear,i.uv);}
`;
export class CinemaRenderer {
  private uniform:GPUBuffer;
  private layout:GPUBindGroupLayout;
  private pipe:GPURenderPipeline;
  private sampler:GPUSampler;
  private source:GPUTextureView|null=null;
  private bind:GPUBindGroup|null=null;
  constructor(private device:GPUDevice){
    this.uniform=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
    const module=device.createShaderModule({label:'VR cinema screen',code:CODE});
    this.pipe=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[this.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'bgra8unorm'}]},primitive:{topology:'triangle-list'}});
    this.sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
  }
  draw(ce:GPUCommandEncoder,source:GPUTextureView,target:GPUTextureView,projection:ArrayLike<number>,view:Mat4,model:Mat4,clear=true):void{
    if(source!==this.source){this.source=source;this.bind=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:source},{binding:2,resource:this.sampler}]});}
    this.device.queue.writeBuffer(this.uniform,0,multiply(projection,multiply(view,model)));
    const p=ce.beginRenderPass({label:'VR cinema',colorAttachments:[{view:target,loadOp:clear?'clear':'load',storeOp:'store',clearValue:[.006,.009,.016,1]}]});
    p.setPipeline(this.pipe);p.setBindGroup(0,this.bind!);p.draw(6);p.end();
  }
  destroy():void{this.uniform.destroy();this.source=this.bind=null;}
}

export class MenuRenderer {
  private quad:CinemaRenderer;
  private texture:GPUTexture|null=null;
  private view:GPUTextureView|null=null;
  private revision=-1;
  constructor(private device:GPUDevice){this.quad=new CinemaRenderer(device);}
  draw(ce:GPUCommandEncoder,target:GPUTextureView,projection:ArrayLike<number>,view:Mat4,overlay:ScreenOverlay):void{
    const {canvas}=overlay;
    if(!this.texture||this.texture.width!==canvas.width||this.texture.height!==canvas.height){
      this.texture?.destroy();this.texture=this.device.createTexture({label:'VR settings panel',size:[canvas.width,canvas.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      this.view=this.texture.createView();this.revision=-1;
    }
    if(this.revision!==overlay.revision){this.device.queue.copyExternalImageToTexture({source:canvas},{texture:this.texture},[canvas.width,canvas.height]);this.revision=overlay.revision;}
    this.quad.draw(ce,this.view!,target,projection,view,overlay.model,false);
  }
  destroy():void{this.quad.destroy();this.texture?.destroy();}
}

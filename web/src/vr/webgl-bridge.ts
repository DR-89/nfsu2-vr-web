import {identity,XR_DEPTH_NEAR,XR_DEPTH_FAR,type Mat4} from './math';
const noWarp=identity();
const preparedContexts = new WeakMap<XRSession, Promise<WebGL2RenderingContext>>();
/** Compatibility presentation for browsers with WebXR/WebGL but no XRGPUBinding.
 * The scene is still rendered twice by WebGPU. The browser imports each GPU
 * canvas into a WebGL texture; no CPU readback, PNG or ImageBitmap queue is used. */
export class WebGLXRBridge {
  private gl: WebGL2RenderingContext;
  private layer: XRWebGLLayer | null = null;
  private program: WebGLProgram;
  private textures: WebGLTexture[];
  private textureSizes: string[] = [];
  private maxTextureSize: number;
  private revisions: (number|undefined)[] = [];
  private atlas: {canvas:HTMLCanvasElement;context:GPUCanvasContext;texture:WebGLTexture;revision?:number;layout?:string;size?:string}|null=null;
  private uvRect:WebGLUniformLocation|null;
  private warp:WebGLUniformLocation|null;
  private canvases = [document.createElement('canvas'), document.createElement('canvas')];
  private contexts: GPUCanvasContext[];
  readonly format: GPUTextureFormat;
  readonly renderer: string;
  private constructor(private device: GPUDevice, gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.maxTextureSize = Math.min(device.limits.maxTextureDimension2D, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer=String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER));
    const shader = (type: number, code: string) => {
      const s = gl.createShader(type); if (!s) throw new Error('XR shader allocation failed');
      gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const why = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`XR presentation shader: ${why}`); }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`);
    const fs = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 uv; uniform sampler2D image; uniform vec4 uvRect; uniform mat4 warp; out vec4 color;
      void main() {
        vec4 q=warp*vec4(uv*2.-1.,1.,1.);vec2 sampleUV=q.xy/q.w*.5+.5;
        if(q.w<=0.||any(lessThan(sampleUV,vec2(0.)))||any(greaterThan(sampleUV,vec2(1.)))){color=vec4(0.,0.,0.,1.);return;}
        color=texture(image,uvRect.xy+sampleUV*uvRect.zw);
      }`);
    const program = gl.createProgram(); if (!program) throw new Error('XR program allocation failed');
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`XR presentation link: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.uvRect=gl.getUniformLocation(program,'uvRect');
    this.warp=gl.getUniformLocation(program,'warp');
    this.textures=[0,1].map(()=>{
      const texture=gl.createTexture();if(!texture)throw new Error('XR texture allocation failed');
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    });
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.contexts = this.canvases.map(canvas => {
      const context = canvas.getContext('webgpu'); if (!context) throw new Error('XR transfer canvas unavailable');
      context.configure({ device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      return context;
    });
  }
  /** Complete the headset's GPU selection before acquiring the game's WebGPU
   * device. On hybrid laptops makeXRCompatible can restart Chrome's GPU process,
   * invalidating devices and GL resources created before that switch. Keep this
   * exact context until the session ends; a second context can switch it again. */
  static prepare(session: XRSession): Promise<WebGL2RenderingContext> {
    const existing = preparedContexts.get(session);
    if (existing) return existing;
    const ready = (async () => {
      const canvas = document.createElement('canvas');
      canvas.addEventListener('webglcontextlost', event => event.preventDefault());
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is unavailable for XR presentation');
      let ended = false, released = false;
      const release = () => {
        if (released) return;
        released = true; preparedContexts.delete(session); gl.getExtension('WEBGL_lose_context')?.loseContext();
      };
      session.addEventListener('end', () => { ended = true; release(); }, { once: true });
      try {
        await gl.makeXRCompatible();
        if (ended) throw new Error('The VR launch ended before its graphics were ready');
        return gl;
      } catch (error) { release(); throw error; }
    })();
    preparedContexts.set(session, ready);
    // Also remove failures before makeXRCompatible (for example, no WebGL2).
    void ready.catch(() => { preparedContexts.delete(session); });
    return ready;
  }
  static async create(session: XRSession, device: GPUDevice, renderScale=1): Promise<WebGLXRBridge> {
    const gl = await this.prepare(session);
    const bridge = new WebGLXRBridge(device, gl);
    try {
      bridge.layer = new XRWebGLLayer(session, bridge.gl, { alpha: false, antialias: false, depth: false, stencil: false, framebufferScaleFactor: renderScale });
      session.updateRenderState({ baseLayer: bridge.layer, depthNear: XR_DEPTH_NEAR, depthFar: XR_DEPTH_FAR });
      return bridge;
    } catch (error) { bridge.destroy(); throw error; }
  }
  viewport(view:XRView):{x:number;y:number;width:number;height:number}|null {return this.layer?.getViewport(view)??null;}
  present(index: number, view: XRView, source: GPUTextureView,
    copy: (source: GPUTextureView, target: GPUTextureView, format: GPUTextureFormat) => void, revision?:number,warp:Mat4=noWarp): void {
    const layer = this.layer; if (!layer || index > 1) return;
    const viewport = this.viewport(view); if (!viewport) return;
    const canvas = this.canvases[index];
    const scale=Math.min(1,this.maxTextureSize/Math.max(viewport.width,viewport.height));
    const width=Math.max(1,Math.floor(viewport.width*scale)),height=Math.max(1,Math.floor(viewport.height*scale));
    const resized=canvas.width!==width||canvas.height!==height;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const changed=resized || revision===undefined || this.revisions[index]!==revision;
    // XR can tick faster than the game/GPU. Keep one imported image per eye;
    // re-copying stale frames adds unbounded work while the renderer is waiting.
    if(changed)copy(source, this.contexts[index].getCurrentTexture().createView(), this.format);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
    gl.uniform4f(this.uvRect,0,0,1,1);
    gl.uniformMatrix4fv(this.warp,false,warp);
    if(changed){
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      const size=`${width}x${height}`;
      this.upload(canvas,this.textureSizes[index]!==size);
      this.textureSizes[index]=size;
      this.revisions[index]=revision;
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /** One cross-API import for the stereo pair, instead of a GPU fence/copy per
   * eye. The atlas preserves each viewport's full size; oversized pairs fall
   * back to independent images without lowering the selected resolution. */
  presentStereo(views:readonly XRView[],revision:number,
    copy:(target:GPUTextureView,rects:readonly [number,number,number,number][],format:GPUTextureFormat)=>void,warps:readonly Mat4[]=[]):boolean {
    if(!this.layer || views.length!==2)return false;
    const viewports=views.map(v=>this.viewport(v));if(viewports.some(v=>!v))return false;
    const left=viewports[0]!,right=viewports[1]!,width=left.width+right.width,height=Math.max(left.height,right.height);
    const gl=this.gl;
    if(width>this.maxTextureSize||height>this.maxTextureSize)return false;
    if(!this.atlas){
      const canvas=document.createElement('canvas'),context=canvas.getContext('webgpu'),texture=gl.createTexture();
      if(!context||!texture)throw new Error('XR stereo canvas unavailable');
      context.configure({device:this.device,format:this.format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT});
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.atlas={canvas,context,texture};
    }
    const a=this.atlas,resized=a.canvas.width!==width||a.canvas.height!==height;
    if(a.canvas.width!==width)a.canvas.width=width;if(a.canvas.height!==height)a.canvas.height=height;
    const rects:[number,number,number,number][]=[[0,0,left.width,left.height],[left.width,0,right.width,right.height]];
    const layout=rects.join(';'),changed=resized||a.revision!==revision||a.layout!==layout;
    if(changed)copy(a.context.getCurrentTexture().createView(),rects,this.format);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.layer.framebuffer);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,a.texture);
    if(changed){
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      const size=`${width}x${height}`;
      this.upload(a.canvas,a.size!==size);a.size=size;a.revision=revision;a.layout=layout;
    }
    for(let i=0;i<2;i++){
      const v=viewports[i]!,r=rects[i];gl.viewport(v.x,v.y,v.width,v.height);
      gl.uniformMatrix4fv(this.warp,false,warps[i]??noWarp);
      gl.uniform4f(this.uvRect,r[0]/width,1-r[3]/height,r[2]/width,r[3]/height);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    return true;
  }
  /** Retain texture storage between frames. Replacing it at headset cadence
   * can allocate another full stereo image while the compositor uses the last. */
  private upload(canvas:HTMLCanvasElement,allocate:boolean):void {
    const gl=this.gl;
    if(allocate)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
  }
  destroy(): void {
    if(this.atlas){this.atlas.context.unconfigure();this.gl.deleteTexture(this.atlas.texture);this.atlas=null;}
    for (const context of this.contexts) context.unconfigure();
    for(const texture of this.textures)this.gl.deleteTexture(texture);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext(); this.layer = null;
  }
}

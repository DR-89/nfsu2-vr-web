// What the browsers have and TypeScript's own libraries (tsconfig.json lib) do not declare yet.

/** Atomics.waitAsync, of ES2024 (the libraries are ES2023's): the doorbells of the renderer, the network and the I/O
 *  worker.  As ES2024's own declaration has it, so that the two merge once the libraries have it */
interface Atomics {
  waitAsync(typedArray: Int32Array, index: number, value: number, timeout?: number):
    { async: false; value: 'not-equal' | 'timed-out' } | { async: true; value: Promise<'ok' | 'timed-out'> };
}

/** a sync access handle's mode, of the File System spec (the libraries take no options) */
interface FileSystemFileHandle {
  createSyncAccessHandle(options?: { mode?: 'readwrite' | 'read-only' | 'readwrite-unsafe' }): Promise<FileSystemSyncAccessHandle>;
}

interface FileSystemHandle {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
}
interface FileSystemDirectoryHandle { values(): AsyncIterableIterator<FileSystemHandle> }
declare var showDirectoryPicker: ((options: { mode: 'read' }) => Promise<FileSystemDirectoryHandle>) | undefined;

// WebXR + WebGPU binding (immersive-web, 2026-08). Only the surface used by this port.
interface GPURequestAdapterOptions { xrCompatible?: boolean }
interface Navigator { readonly xr?: XRSystem }
interface XRSystem extends EventTarget {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>;
  requestSession(mode: 'immersive-vr', options: { requiredFeatures: string[]; optionalFeatures?: string[] }): Promise<XRSession>;
}
interface XRSpace extends EventTarget {}
interface XRReferenceSpace extends XRSpace {}
interface XRRigidTransform { readonly matrix: Float32Array; readonly inverse: XRRigidTransform; readonly position: DOMPointReadOnly; readonly orientation: DOMPointReadOnly }
interface XRPose { readonly transform: XRRigidTransform }
interface XRView { readonly eye: 'left' | 'right' | 'none'; readonly projectionMatrix: Float32Array; readonly transform: XRRigidTransform }
interface XRViewerPose extends XRPose { readonly views: readonly XRView[] }
interface XRInputSource {
  readonly handedness: 'left' | 'right' | 'none'; readonly gripSpace?: XRSpace;
  readonly targetRaySpace: XRSpace; readonly gamepad?: Gamepad;
}
interface Gamepad { readonly hapticActuators?: readonly { pulse(value: number, duration: number): Promise<boolean> }[] }
interface XRFrame {
  readonly session: XRSession;
  getViewerPose(space: XRReferenceSpace): XRViewerPose | null;
  getPose(space: XRSpace, base: XRSpace): XRPose | null;
}
interface XRSession extends EventTarget {
  readonly frameRate?: number;
  readonly supportedFrameRates?: Float32Array;
  updateTargetFrameRate?(rate: number): Promise<void>;
  readonly inputSources: readonly XRInputSource[];
  readonly visibilityState: 'visible' | 'visible-blurred' | 'hidden';
  requestReferenceSpace(type: 'local' | 'local-floor'): Promise<XRReferenceSpace>;
  requestAnimationFrame(callback: (time: DOMHighResTimeStamp, frame: XRFrame) => void): number;
  cancelAnimationFrame(handle: number): void;
  updateRenderState(state: { layers?: XRProjectionLayer[]; baseLayer?: XRWebGLLayer; depthNear?: number; depthFar?: number }): void;
  end(): Promise<void>;
}
interface XRProjectionLayer { destroy(): void }
interface XRGPUSubImage {
  readonly colorTexture: GPUTexture;
  readonly viewport: { x: number; y: number; width: number; height: number };
  getViewDescriptor(): GPUTextureViewDescriptor;
}
declare class XRGPUBinding {
  constructor(session: XRSession, device: GPUDevice);
  getPreferredColorFormat(): GPUTextureFormat;
  createProjectionLayer(init: { colorFormat: GPUTextureFormat; textureUsage?: GPUTextureUsageFlags; scaleFactor?: number }): XRProjectionLayer;
  getViewSubImage(layer: XRProjectionLayer, view: XRView): XRGPUSubImage;
}

interface WebGLContextAttributes { xrCompatible?: boolean }
interface WebGLRenderingContextBase { makeXRCompatible(): Promise<void> }
declare class XRWebGLLayer {
  constructor(session: XRSession, context: WebGL2RenderingContext, options?: { alpha?: boolean; antialias?: boolean; depth?: boolean; stencil?: boolean; framebufferScaleFactor?: number });
  readonly framebuffer: WebGLFramebuffer;
  getViewport(view: XRView): { x: number; y: number; width: number; height: number } | null;
}

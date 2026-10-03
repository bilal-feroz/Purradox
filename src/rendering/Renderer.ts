import * as THREE from "three";

const TEMPORAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Temporal treatment from the VFX direction: sea-glass tint, edge chromatic
// split, rewind scan bands. `uAmount` drives the full rewind look, `uEdge`
// is the subtle Round 2 world treatment.
const TEMPORAL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uAmount;
uniform float uEdge;
uniform float uTime;
uniform float uFreeze;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 desat(vec3 c, float k) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, vec3(l), k);
}

void main() {
  vec2 uv = vUv;
  vec2 fromC = uv - 0.5;
  float r = length(fromC);
  float split = (0.0025 + 0.010 * uAmount) * smoothstep(0.15, 0.75, r) * (uAmount + uEdge * 0.55);
  // rewind scan bands slide upward
  float band = sin((uv.y * 38.0) + uTime * 26.0) * 0.5 + 0.5;
  float bandMask = smoothstep(0.92, 1.0, band) * uAmount;
  uv.x += bandMask * 0.006 * sin(uTime * 40.0 + uv.y * 90.0);
  vec2 dir = normalize(fromC + 1e-5);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir * split).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir * split).b;

  vec3 seaGlass = vec3(0.50, 0.95, 0.86);
  // Freeze: warm desaturation for the RUN COMPLETE beat
  col = mix(col, desat(col, 0.55) * vec3(1.04, 1.0, 0.94), uFreeze * 0.85);
  // Rewind: cool sea-glass wash, gently desaturated
  vec3 rw = desat(col, 0.45);
  rw = mix(rw, rw * seaGlass * 1.18 + vec3(0.02, 0.05, 0.06), 0.55);
  col = mix(col, rw, uAmount * 0.85);
  col += seaGlass * bandMask * 0.10;
  // Edge glow for temporal states
  float edge = smoothstep(0.38, 0.78, r);
  col = mix(col, col * 0.86 + seaGlass * 0.10, edge * (uAmount * 0.9 + uEdge * 0.35));
  // vignette
  col *= mix(1.0, 0.82, smoothstep(0.45, 0.85, r) * (0.35 + uAmount * 0.5 + uFreeze * 0.4));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** WebGL renderer + optional fullscreen temporal pass. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly temporalUniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0 },
    uEdge: { value: 0 },
    uTime: { value: 0 },
    uFreeze: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };
  private readonly target: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly postMaterial: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  pixelRatioCap = 1.5;
  onResize: Array<(w: number, h: number) => void> = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      samples: 4,
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: this.temporalUniforms,
      vertexShader: TEMPORAL_VERT,
      fragmentShader: TEMPORAL_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.target.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.temporalUniforms.uResolution.value.set(w * pr, h * pr);
    for (const fn of this.onResize) fn(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    const u = this.temporalUniforms;
    u.uTime.value = time;
    const needsPost = u.uAmount.value > 0.001 || u.uEdge.value > 0.001 || u.uFreeze.value > 0.001;
    if (!needsPost) {
      this.gl.setRenderTarget(null);
      this.gl.render(scene, camera);
      return;
    }
    // Scene renders linear into the target; the post pass tone maps.
    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    u.tDiffuse.value = this.target.texture;
    this.gl.render(this.postScene, this.postCamera);
  }

  /** Compile both the direct and the post-processed program variants up front. */
  warmup(scene: THREE.Scene, camera: THREE.Camera): void {
    this.gl.compile(scene, camera);
    const u = this.temporalUniforms;
    const prev = u.uEdge.value;
    u.uEdge.value = 0.01;
    this.render(scene, camera, 0);
    u.uEdge.value = prev;
    this.render(scene, camera, 0);
  }

  info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.gl.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }
}

import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform vec3 uColor;
uniform vec3 uCam;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float h = vUv.y;
  float fade = pow(1.0 - h, 1.6) * smoothstep(0.0, 0.04, h);
  float band = 0.75 + 0.25 * sin(h * 26.0 - uTime * 3.0);
  // fade out when the camera is close (don't blind the player on arrival)
  float near = smoothstep(4.0, 16.0, distance(uCam.xz, vWorld.xz));
  float a = fade * band * uStrength * near;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

/**
 * Soft warm light shaft over the Safe Rooftop so the destination reads from
 * anywhere in Sardine Street (and Round 2 hunters know where Past You goes).
 */
export class GoalBeacon {
  readonly group = new THREE.Group();
  private readonly uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 0.55 },
    uColor: { value: new THREE.Color(0xffd98a) },
    uCam: { value: new THREE.Vector3() },
  };

  constructor(scene: THREE.Scene, at: THREE.Vector3) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const geo = new THREE.CylinderGeometry(1.0, 1.7, 26, 14, 1, true);
    geo.translate(0, 13, 0);
    const shaft = new THREE.Mesh(geo, mat);
    shaft.frustumCulled = false;
    shaft.renderOrder = 4;
    this.group.add(shaft);
    this.group.position.copy(at);
    scene.add(this.group);
  }

  update(time: number, camPos: THREE.Vector3, visible: boolean, temporal: boolean): void {
    this.group.visible = visible;
    this.uniforms.uTime.value = time;
    this.uniforms.uCam.value.copy(camPos);
    this.uniforms.uColor.value.setHex(temporal ? 0x9ff5e4 : 0xffd98a);
    this.uniforms.uStrength.value = 0.42 + Math.sin(time * 1.7) * 0.06;
  }
}

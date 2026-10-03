import * as THREE from "three";
import { PALETTE } from "../data/palette";
import { Random } from "../core/Random";
import { boxUp, cone, ico, lowPoly, merge, place, prism, shade } from "./LowPoly";
import type { Materials } from "./Materials";

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.05, 0.75, h), 0.8));
  float sun = max(dot(normalize(vDir), uSunDir), 0.0);
  col += vec3(1.0, 0.86, 0.62) * pow(sun, 18.0) * 0.35;
  col += vec3(1.0, 0.93, 0.8) * pow(sun, 400.0) * 0.8;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Gradient sky dome, drifting low-poly clouds and the distant coastal town. */
export class Sky {
  readonly group = new THREE.Group();
  private readonly clouds = new THREE.Group();

  constructor(scene: THREE.Scene, materials: Materials, sunDir: THREE.Vector3) {
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uSunDir: { value: sunDir.clone().normalize() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.group.add(dome);

    // Clouds: chunky white puff clusters.
    const rng = new Random(77);
    const cloudGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(180, 300);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = rng.range(70, 120);
      const puffs = rng.int(3, 6);
      for (let p = 0; p < puffs; p++) {
        const s = rng.range(6, 13);
        cloudGeos.push(
          place(lowPoly(ico(s, 0), PALETTE.cloud, { variance: 0.04, jitter: s * 0.12, seed: i * 10 + p }), cx + (p - puffs / 2) * s * 1.1, cy + rng.range(-2, 3), cz + rng.range(-4, 4), rng.range(0, 3), 0, 0, 1, 0.55, 1),
        );
      }
    }
    const cloudMesh = new THREE.Mesh(merge(cloudGeos), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92 }));
    this.clouds.add(cloudMesh);
    this.group.add(this.clouds);

    // Distant town across the bay (north-east), softened by fog.
    const town: THREE.BufferGeometry[] = [];
    const trng = new Random(1337);
    const baseX = 150;
    const baseZ = -150;
    // hill
    town.push(place(lowPoly(ico(60, 1), PALETTE.cliff, { variance: 0.05, jitter: 6 }), baseX, -26, baseZ, 0, 0, 0, 1.6, 0.6, 1));
    for (let i = 0; i < 46; i++) {
      const x = baseX + trng.range(-70, 70);
      const z = baseZ + trng.range(-40, 40);
      const dist = Math.hypot((x - baseX) / 80, (z - baseZ) / 45);
      const y = 10 - dist * 22 + trng.range(-1, 2);
      const w = trng.range(4, 9);
      const h = trng.range(4, 10);
      const col = trng.pick([PALETTE.stoneCream, PALETTE.plasterPeach, PALETTE.stoneWarm, 0xf1e6d2]);
      town.push(place(lowPoly(boxUp(w, h, trng.range(4, 8)), col, { variance: 0.03 }), x, y, z, trng.range(0, 1)));
      if (trng.chance(0.5)) town.push(place(lowPoly(prism(w * 1.05, 2.2, 6), PALETTE.terracotta), x, y + h, z, trng.range(0, 1)));
    }
    // bell tower
    town.push(place(lowPoly(boxUp(5, 26, 5), PALETTE.stoneCream), baseX - 10, 4, baseZ + 5));
    town.push(place(lowPoly(cone(4.2, 7, 6), shade(PALETTE.domeBlue, 1.1)), baseX - 10, 33.5, baseZ + 5));
    const townMesh = new THREE.Mesh(merge(town), materials.world);
    this.group.add(townMesh);

    scene.add(this.group);
  }

  update(dt: number): void {
    this.clouds.rotation.y += dt * 0.004;
  }
}

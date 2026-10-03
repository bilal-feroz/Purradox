import * as THREE from "three";
import { PALETTE } from "../data/palette";
import { clamp01 } from "../core/math";
import { hash3 } from "../core/Random";

/**
 * Faceted low-poly sea. Waves are displaced in the vertex shader; flat
 * shading from screen-space derivatives turns them into sparkling facets.
 * Vertex colors fade turquoise shallows near the shore into deep blue.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = { uTime: { value: 0 } };

  constructor(scene: THREE.Scene, seaLevel: number, shoreDistance: (x: number, z: number) => number) {
    const size = 520;
    const seg = 130;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(40, 0, -40);
    const flat = geo.toNonIndexed();
    geo.dispose();
    const pos = flat.getAttribute("position") as THREE.BufferAttribute;
    // Slight static jitter so the facets read as hand-made.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setX(i, x + (hash3(x, 0, z) - 0.5) * 1.2);
      pos.setZ(i, z + (hash3(z, 1, x) - 0.5) * 1.2);
    }
    const colors = new Float32Array(pos.count * 3);
    const shallow = new THREE.Color(PALETTE.seaShallow);
    const deep = new THREE.Color(PALETTE.seaDeep);
    const foam = new THREE.Color(PALETTE.seaFoam);
    const c = new THREE.Color();
    for (let f = 0; f < pos.count / 3; f++) {
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        cx += pos.getX(f * 3 + k) / 3;
        cz += pos.getZ(f * 3 + k) / 3;
      }
      const d = shoreDistance(cx, cz);
      const t = clamp01(d / 26);
      c.copy(shallow).lerp(deep, Math.pow(t, 0.7));
      if (d < 1.4) c.lerp(foam, 0.55 * (1 - d / 1.4));
      const v = 1 + (hash3(cx, 2, cz) - 0.5) * 0.06;
      for (let k = 0; k < 3; k++) {
        colors[(f * 3 + k) * 3] = c.r * v;
        colors[(f * 3 + k) * 3 + 1] = c.g * v;
        colors[(f * 3 + k) * 3 + 2] = c.b * v;
      }
    }
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    flat.deleteAttribute("uv");
    flat.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.22,
      metalness: 0.05,
      transparent: false,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float w1 = sin(position.x * 0.16 + uTime * 0.9) * 0.22;
           float w2 = sin(position.z * 0.21 - uTime * 0.7 + position.x * 0.05) * 0.18;
           float w3 = sin((position.x + position.z) * 0.45 + uTime * 1.7) * 0.06;
           transformed.y += w1 + w2 + w3;`,
        );
    };
    this.mesh = new THREE.Mesh(flat, mat);
    this.mesh.position.y = seaLevel;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }
}

import * as THREE from "three";
import { computeLayout, type Frame, type Layout, type ViewSpec } from "@/lib/visualization/layout";
import type { ParticleSet } from "@/lib/visualization/particles";
import { fragmentShader, vertexShader } from "./shaders";


/** Must match the stagger curve in the vertex shader. */
const stagger = (progress: number, seed: number): number => {
  const t = Math.min(1, Math.max(0, progress * 1.4 - seed * 0.4));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export interface FrameState {
  time: number;
  delta: number;
  pixelRatio: number;
  viewportHeight: number;
  scanning: boolean;
  reducedMotion: boolean;
  scanExtent: number;
}

/**
 * Imperative owner of the point cloud's GPU buffers. Positions and visual
 * state are stored as from/to pairs and interpolated in the vertex shader, so
 * a transition costs one CPU pass when it starts and nothing per frame.
 */
export class ParticleCloud {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Y position of the scan plane, for the guide line. */
  scanY = 0;
  scan = 0;
  private progress = 1;
  private duration = 2.4;
  private boost = 1;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private readonly stateFrom: Float32Array;
  private readonly stateTo: Float32Array;

  constructor(private readonly set: ParticleSet) {
    const n = set.count;
    this.from = new Float32Array(n * 3);
    this.to = new Float32Array(n * 3);
    this.stateFrom = new Float32Array(n * 3);
    this.stateTo = new Float32Array(n * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.to, 3));
    geometry.setAttribute("aFrom", new THREE.BufferAttribute(this.from, 3));
    geometry.setAttribute("aStateFrom", new THREE.BufferAttribute(this.stateFrom, 3));
    geometry.setAttribute("aStateTo", new THREE.BufferAttribute(this.stateTo, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(set.seed, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(set.size, 1));
    geometry.setAttribute("aGhost", new THREE.BufferAttribute(set.ghost, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 1 },
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uScale: { value: 1 },
        uMotion: { value: 1 },
        uBoost: { value: 1 },
        uScan: { value: 0 },
        uScanY: { value: 0 },
        uCool: { value: new THREE.Color("#c9dbff") },
        uGhost: { value: new THREE.Color("#5f7499") },
        uRisk: { value: new THREE.Color("#ff5a36") },
        uAttention: { value: new THREE.Color("#f5b04a") },
        uPositive: { value: new THREE.Color("#55dba0") },
      },
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }

  /** Freezes every particle where it currently is, then aims it at the new view. */
  retarget(spec: ViewSpec, frame: Frame, seconds: number): Layout {
    const { from, to, stateFrom, stateTo, set } = this;
    for (let i = 0; i < set.count; i++) {
      const e = stagger(this.progress, set.seed[i]);
      for (let k = i * 3; k < i * 3 + 3; k++) {
        from[k] += (to[k] - from[k]) * e;
        stateFrom[k] += (stateTo[k] - stateFrom[k]) * e;
      }
    }
    const layout = computeLayout(set, spec, frame, to, stateTo);
    const attributes = this.points.geometry.attributes;
    for (const name of ["position", "aFrom", "aStateFrom", "aStateTo"]) attributes[name].needsUpdate = true;
    this.boost = layout.boost;
    this.progress = seconds > 0 ? 0 : 1;
    this.duration = seconds;
    return layout;
  }

  update(f: FrameState): void {
    this.progress = Math.min(1, this.progress + f.delta / Math.max(this.duration, 1e-3));
    this.scan += ((f.scanning && !f.reducedMotion ? 1 : 0) - this.scan) * Math.min(1, f.delta * 3);
    this.scanY = Math.sin(f.time * 1.25) * f.scanExtent;
    const u = this.points.material.uniforms;
    u.uProgress.value = this.progress;
    u.uTime.value = f.time;
    u.uPixelRatio.value = f.pixelRatio;
    u.uScale.value = Math.min(1.25, Math.max(0.7, f.viewportHeight / 900));
    u.uMotion.value = f.reducedMotion ? 0 : 1;
    u.uBoost.value += (this.boost - u.uBoost.value) * Math.min(1, f.delta * (f.reducedMotion ? 60 : 1.6));
    u.uScan.value = this.scan;
    u.uScanY.value = this.scanY;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

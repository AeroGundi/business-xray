"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Frame, Layout, ViewSpec } from "@/lib/visualization/layout";
import type { ParticleSet } from "@/lib/visualization/particles";
import { ParticleField } from "./ParticleField";

interface SceneProps {
  set: ParticleSet;
  spec: ViewSpec;
  /** Whether the layout leaves side columns free (investigation / overview) or is centred. */
  centered: boolean;
  scanning: boolean;
  /** Seconds each view change takes. */
  transition: number;
  reducedMotion: boolean;
  /** CSS colour for the highlighted label's figure. */
  tone?: string;
}

function Guides({ segments, version }: { segments: Float32Array; version: number }) {
  const material = useRef<THREE.LineBasicMaterial>(null);
  const since = useRef(0);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(segments, 3));
    return g;
  }, [segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    since.current = 0;
    if (material.current) material.current.opacity = 0;
  }, [version]);
  useFrame((_, delta) => {
    since.current += delta;
    if (!material.current) return;
    const target = since.current > 1.3 ? 0.13 : 0;
    material.current.opacity += (target - material.current.opacity) * Math.min(1, delta * 2.5);
  });
  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial ref={material} color="#c9dbff" transparent opacity={0} depthTest={false} />
    </lineSegments>
  );
}

function Rig({ set, spec, centered, scanning, transition, reducedMotion, tone }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const viewport = useThree((s) => s.viewport);
  const width = useThree((s) => s.size.width);
  const [layout, setLayout] = useState<{ layout: Layout; version: number }>({ layout: { labels: [], segments: new Float32Array(0), boost: 1 }, version: 0 });

  const compact = width < 1024 || viewport.aspect < 1.15;
  // Rounded so that sub-pixel resizes do not retarget every particle.
  const vw = Math.round(viewport.width * 10) / 10;
  const vh = Math.round(viewport.height * 10) / 10;
  const frame: Frame = useMemo(
    () => (compact ? { rx: vw * 0.36, ry: vh * 0.14, compact: true } : { rx: Math.min(vw * 0.195, 2.9), ry: Math.min(vh * 0.33, 2.5) }),
    [compact, vw, vh],
  );
  const offsetY = compact && !centered ? vh * 0.23 : 0;
  const flat = spec.mode === "timeline";

  const onLayout = useCallback((next: Layout) => setLayout((prev) => ({ layout: next, version: prev.version + 1 })), []);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const k = Math.min(1, delta * 2);
    const still = reducedMotion || flat;
    const ry = still ? 0 : Math.sin(state.clock.elapsedTime * 0.16) * 0.14 + state.pointer.x * 0.07;
    const rx = still ? 0 : -state.pointer.y * 0.04;
    g.rotation.y += (ry - g.rotation.y) * k;
    g.rotation.x += (rx - g.rotation.x) * k;
    g.position.y += (offsetY - g.position.y) * k;
  });

  return (
    <group ref={group}>
      <ParticleField set={set} spec={spec} frame={frame} scanning={scanning} transition={transition} reducedMotion={reducedMotion} onLayout={onLayout} />
      <Guides segments={layout.layout.segments} version={layout.version} />
      {layout.layout.labels.map((label) => (
        <Html
          key={`${layout.version}-${label.key}`}
          position={label.position}
          zIndexRange={[5, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className="xr-label" data-emphasis={label.emphasis} data-anchor={label.anchor} style={tone ? ({ "--tone": tone } as React.CSSProperties) : undefined}>
            <span>{label.text}</span>
            {label.note && <span className="note">{label.note}</span>}
          </div>
        </Html>
      ))}
    </group>
  );
}

export default function Scene(props: SceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 11], fov: 35, near: 0.1, far: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <Rig {...props} />
    </Canvas>
  );
}

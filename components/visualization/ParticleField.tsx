"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import type { Frame, Layout, ViewSpec } from "@/lib/visualization/layout";
import type { ParticleSet } from "@/lib/visualization/particles";
import { ParticleCloud } from "./ParticleCloud";

interface Props {
  set: ParticleSet;
  spec: ViewSpec;
  frame: Frame;
  scanning: boolean;
  reducedMotion: boolean;
  onLayout: (layout: Layout) => void;
}

export function ParticleField({ set, spec, frame, scanning, reducedMotion, onLayout }: Props) {
  const cloud = useMemo(() => new ParticleCloud(set), [set]);
  const scanLine = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);
  const height = useThree((s) => s.size.height);
  const pixelRatio = useThree((s) => s.viewport.dpr);
  // Read at retarget time only: changing pace must not retarget.
  const seconds = useRef(2.4);
  useEffect(() => {
    seconds.current = reducedMotion ? 0 : scanning ? 1.5 : 2.4;
  }, [reducedMotion, scanning]);

  useEffect(() => () => cloud.dispose(), [cloud]);

  useEffect(() => {
    onLayout(cloud.retarget(spec, frame, seconds.current));
  }, [cloud, spec, frame, onLayout]);

  useFrame((state, delta) => {
    cloud.update({
      time: state.clock.elapsedTime, delta, pixelRatio, viewportHeight: height,
      scanning, reducedMotion, scanExtent: frame.ry * 1.15,
    });
    const line = scanLine.current;
    if (line) {
      line.position.y = cloud.scanY;
      line.material.opacity = cloud.scan * 0.55;
    }
  });

  return (
    <>
      <primitive object={cloud.points} />
      <mesh ref={scanLine}>
        <planeGeometry args={[frame.rx * 2.6, 0.006]} />
        <meshBasicMaterial color="#c9dbff" transparent opacity={0} depthTest={false} />
      </mesh>
    </>
  );
}

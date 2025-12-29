"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { ThreeAvatar } from "@/components/three-avatar";

function Rotator({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    g.rotation.y += dt * 0.35;
  });
  return <group ref={groupRef}>{children}</group>;
}

function CameraAim({
  target = [0, 1.1, 0],
}: {
  target?: [number, number, number];
}) {
  const { camera } = useThree();
  const t = useMemo(
    () => new THREE.Vector3(target[0], target[1], target[2]),
    [target]
  );
  useFrame(() => {
    camera.lookAt(t);
  });
  return null;
}

export function VrmPreview({
  url,
  width = 220,
  height = 220,
}: {
  url: string;
  width?: number;
  height?: number;
}) {
  const style = useMemo(
    () => ({
      width,
      height,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid rgba(127,127,127,0.25)",
      background: "rgba(0,0,0,0.25)",
    }),
    [width, height]
  );

  return (
    <div style={style}>
      <Canvas
        dpr={[1, 1.25]}
        gl={{ antialias: true, powerPreference: "low-power", alpha: true }}
        camera={{ position: [0, 1.75, 3.25], fov: 40 }}
      >
        <CameraAim target={[0, 1.1, 0]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 2, -3]} intensity={0.35} />

        <Suspense fallback={null}>
          <Rotator>
            <group position={[0, 0, 0]}>
              <ThreeAvatar url={url} movingSpeed={0} pose="stand" />
            </group>
          </Rotator>
        </Suspense>
      </Canvas>
    </div>
  );
}

"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import * as THREE from "three";

export function GodRays() {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geom = new THREE.CylinderGeometry(0.1, 12, 30, 32, 1, true);
    return geom;
  }, []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    // Subtle rotation for dynamic feel
    meshRef.current.rotation.y = clock.getElapsedTime() * 0.05;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[10, 15, 6]}
      rotation={[Math.PI * 0.3, 0, Math.PI * 0.1]}
    >
      <meshBasicMaterial
        color="#ffd5ab"
        transparent
        opacity={0.08}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

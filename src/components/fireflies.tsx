"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export function Fireflies({ count = 80 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, fireflies } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    const fireflies = Array.from({ length: count }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 20 + Math.random() * 35;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.3 + Math.random() * 3;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      return {
        baseX: positions[i * 3]!,
        baseY: positions[i * 3 + 1]!,
        baseZ: positions[i * 3 + 2]!,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
        flickerPhase: Math.random() * Math.PI * 2,
        flickerSpeed: 2 + Math.random() * 3,
      };
    });

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    return { geometry: geom, fireflies };
  }, [count]);

  useFrame(({ clock }) => {
    if (!pointsRef.current) return;

    const time = clock.getElapsedTime();
    const positions = pointsRef.current.geometry.attributes.position
      .array as Float32Array;
    const material = pointsRef.current.material as THREE.PointsMaterial;

    fireflies.forEach((firefly, i) => {
      const t = time * firefly.speed + firefly.phase;

      // Gentle floating motion
      const offsetX = Math.sin(t * 0.5) * 2;
      const offsetY = Math.sin(t * 1.2) * 0.8;
      const offsetZ = Math.cos(t * 0.6) * 2;

      positions[i * 3] = firefly.baseX + offsetX;
      positions[i * 3 + 1] = firefly.baseY + offsetY;
      positions[i * 3 + 2] = firefly.baseZ + offsetZ;
    });

    // Pulsing glow
    const pulse = 0.5 + Math.sin(time * 2) * 0.5;
    material.size = 0.15 + pulse * 0.1;
    material.opacity = 0.6 + pulse * 0.4;

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={0.2}
        color="#ffeb3b"
        transparent
        opacity={0.8}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

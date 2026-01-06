"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// Dandelion seeds and pollen particles floating in the air
export function FloatingParticles({ count = 200 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, particles } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const particles = Array.from({ length: count }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 10 + Math.random() * 45;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * 8;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      // White/cream colored particles
      const brightness = 0.8 + Math.random() * 0.2;
      colors[i * 3] = brightness;
      colors[i * 3 + 1] = brightness * 0.95;
      colors[i * 3 + 2] = brightness * 0.9;

      sizes[i] = 0.08 + Math.random() * 0.15;

      return {
        baseX: positions[i * 3]!,
        baseY: positions[i * 3 + 1]!,
        baseZ: positions[i * 3 + 2]!,
        phase: Math.random() * Math.PI * 2,
        speedX: (Math.random() - 0.5) * 0.2,
        speedY: -0.1 - Math.random() * 0.15, // Gentle falling
        speedZ: (Math.random() - 0.5) * 0.2,
        floatSpeed: 0.5 + Math.random() * 0.5,
        floatAmplitude: 0.3 + Math.random() * 0.7,
      };
    });

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    return { geometry: geom, particles };
  }, [count]);

  useFrame(({ clock }) => {
    if (!pointsRef.current) return;

    const time = clock.getElapsedTime();
    const positions = pointsRef.current.geometry.attributes.position
      .array as Float32Array;

    particles.forEach((particle, i) => {
      // Wind drift
      const driftX = particle.speedX * time;
      const driftZ = particle.speedZ * time;

      // Falling motion with sine wave floating
      let newY = particle.baseY + particle.speedY * time;
      newY +=
        Math.sin(time * particle.floatSpeed + particle.phase) *
        particle.floatAmplitude;

      // Reset when fallen too low
      if (newY < -0.5) {
        particle.baseY = 8;
        newY = 8;
      }

      positions[i * 3] =
        particle.baseX + driftX + Math.sin(time * 0.3 + particle.phase) * 2;
      positions[i * 3 + 1] = newY;
      positions[i * 3 + 2] =
        particle.baseZ + driftZ + Math.cos(time * 0.3 + particle.phase) * 2;
    });

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        vertexColors
        transparent
        opacity={0.6}
        size={0.12}
        blending={THREE.NormalBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

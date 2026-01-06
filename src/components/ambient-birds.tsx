"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// Ambient birds flying in the distance
export function AmbientBirds({ count = 8 }: { count?: number }) {
  const groupRef = useRef<THREE.Group>(null);

  const birds = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      angle: (i / count) * Math.PI * 2,
      radius: 40 + Math.random() * 20,
      height: 8 + Math.random() * 6,
      speed: 0.1 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
      flapSpeed: 8 + Math.random() * 4,
    }));
  }, [count]);

  return (
    <group ref={groupRef}>
      {birds.map((bird, i) => (
        <Bird key={i} {...bird} index={i} />
      ))}
    </group>
  );
}

function Bird({
  angle,
  radius,
  height,
  speed,
  phase,
  flapSpeed,
  index,
}: {
  angle: number;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  flapSpeed: number;
  index: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const leftWingRef = useRef<THREE.Mesh>(null);
  const rightWingRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    const time = clock.getElapsedTime();
    const t = time * speed + phase;

    // Circular motion
    const x = Math.cos(angle + t) * radius;
    const z = Math.sin(angle + t) * radius;
    const y = height + Math.sin(t * 2) * 1.5;

    groupRef.current.position.set(x, y, z);

    // Look in direction of travel
    const dx = -Math.sin(angle + t) * radius * speed;
    const dz = Math.cos(angle + t) * radius * speed;
    groupRef.current.lookAt(x + dx, y, z + dz);

    // Wing flapping
    if (leftWingRef.current && rightWingRef.current) {
      const flap = Math.sin(time * flapSpeed + index) * 0.6;
      leftWingRef.current.rotation.z = flap;
      rightWingRef.current.rotation.z = -flap;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Body */}
      <mesh>
        <sphereGeometry args={[0.08, 6, 6]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.7} />
      </mesh>

      {/* Head */}
      <mesh position={[0.06, 0.03, 0]}>
        <sphereGeometry args={[0.04, 6, 6]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.7} />
      </mesh>

      {/* Left wing */}
      <mesh ref={leftWingRef} position={[-0.02, 0, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.25, 0.02, 0.1]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>

      {/* Right wing */}
      <mesh ref={rightWingRef} position={[0.02, 0, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.25, 0.02, 0.1]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
      </mesh>
    </group>
  );
}

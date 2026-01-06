"use client";

import { useMemo } from "react";
import * as THREE from "three";

// Scattered wildflowers across the grass
export function Wildflowers({
  count = 300,
  radius = 50,
  excludeRadius = 18,
}: {
  count?: number;
  radius?: number;
  excludeRadius?: number;
}) {
  const flowers = useMemo(() => {
    const result: Array<{
      position: [number, number, number];
      color: THREE.Color;
      scale: number;
    }> = [];

    const flowerColors = [
      new THREE.Color("#ff6b9d"), // Pink
      new THREE.Color("#c44569"), // Deep rose
      new THREE.Color("#ffd93d"), // Yellow
      new THREE.Color("#a8e6cf"), // Mint
      new THREE.Color("#dda15e"), // Peach
      new THREE.Color("#bc6c25"), // Orange
      new THREE.Color("#9b59b6"), // Purple
      new THREE.Color("#ffffff"), // White
    ];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;

      if (r < excludeRadius) {
        i--;
        continue;
      }

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      result.push({
        position: [x, 0.15, z],
        color: flowerColors[Math.floor(Math.random() * flowerColors.length)]!,
        scale: 0.6 + Math.random() * 0.8,
      });
    }

    return result;
  }, [count, radius, excludeRadius]);

  return (
    <group>
      {flowers.map((flower, i) => (
        <group key={i} position={flower.position} scale={flower.scale}>
          {/* Flower petals - simple 5-petal design */}
          {Array.from({ length: 5 }).map((_, j) => {
            const angle = (j / 5) * Math.PI * 2;
            const px = Math.cos(angle) * 0.08;
            const pz = Math.sin(angle) * 0.08;

            return (
              <mesh
                key={j}
                position={[px, 0, pz]}
                rotation={[Math.PI / 2, 0, angle]}
              >
                <circleGeometry args={[0.06, 8]} />
                <meshStandardMaterial
                  color={flower.color}
                  roughness={0.8}
                  metalness={0}
                  side={THREE.DoubleSide}
                />
              </mesh>
            );
          })}

          {/* Center */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.04, 8]} />
            <meshStandardMaterial
              color="#ffeb3b"
              roughness={0.6}
              emissive="#ffeb3b"
              emissiveIntensity={0.3}
            />
          </mesh>

          {/* Stem */}
          <mesh position={[0, -0.1, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.2, 6]} />
            <meshStandardMaterial color="#2d5c2f" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

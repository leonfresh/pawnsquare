"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// Procedural grass blades inspired by the grass shader
export function AnimatedGrass({
  count = 8000,
  radius = 50,
  excludeRadius = 18,
}: {
  count?: number;
  radius?: number;
  excludeRadius?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, positions } = useMemo(() => {
    // Create grass blade geometry
    const bladeGeometry = new THREE.BufferGeometry();
    const bladeWidth = 0.08;
    const bladeHeight = 0.6;

    // Tapered blade shape
    const vertices = new Float32Array([
      -bladeWidth / 2,
      0,
      0,
      bladeWidth / 2,
      0,
      0,
      -bladeWidth / 3,
      bladeHeight * 0.5,
      0,
      bladeWidth / 3,
      bladeHeight * 0.5,
      0,
      0,
      bladeHeight,
      0,
    ]);

    const indices = [0, 1, 2, 1, 3, 2, 2, 3, 4];

    bladeGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(vertices, 3)
    );
    bladeGeometry.setIndex(indices);
    bladeGeometry.computeVertexNormals();

    // Generate positions in a disk, excluding center
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;

      // Skip center area where chess boards are
      if (r < excludeRadius) {
        i--;
        continue;
      }

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      positions.push(new THREE.Vector3(x, 0, z));
    }

    return { geometry: bladeGeometry, positions };
  }, [count, radius, excludeRadius]);

  // Set up instances
  useMemo(() => {
    if (!meshRef.current) return;

    const dummy = new THREE.Object3D();
    const matrix = new THREE.Matrix4();

    positions.forEach((pos, i) => {
      dummy.position.copy(pos);
      dummy.rotation.y = Math.random() * Math.PI * 2;

      // Random scale variation
      const scaleVariation = 0.7 + Math.random() * 0.6;
      dummy.scale.set(scaleVariation, scaleVariation, scaleVariation);

      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [positions]);

  // Wind animation
  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    const time = clock.getElapsedTime();
    const dummy = new THREE.Object3D();

    positions.forEach((pos, i) => {
      // Wind wave pattern using fbm-like layering
      const windX = Math.sin(time * 0.8 + pos.x * 0.1 + pos.z * 0.05) * 0.15;
      const windZ = Math.cos(time * 0.6 + pos.z * 0.1 + pos.x * 0.07) * 0.12;

      // Add secondary motion
      const windX2 = Math.sin(time * 1.5 + pos.x * 0.3) * 0.08;
      const windZ2 = Math.cos(time * 1.3 + pos.z * 0.3) * 0.08;

      dummy.position.copy(pos);
      dummy.rotation.set(
        windX + windX2,
        Math.random() * Math.PI * 2,
        windZ + windZ2
      );

      const scaleVariation = 0.7 + ((i * 0.7919) % 1) * 0.6;
      dummy.scale.set(scaleVariation, scaleVariation, scaleVariation);

      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, positions.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        color="#2d5a2f"
        roughness={0.95}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export function Butterflies({ count = 15 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, butterflies } = useMemo(() => {
    // Simple butterfly wing geometry
    const geom = new THREE.BufferGeometry();
    const size = 0.15;

    const vertices = new Float32Array([
      // Left wing
      -size,
      0,
      -size * 0.5,
      -size * 2,
      0,
      0,
      -size,
      0,
      size * 0.5,
      // Right wing
      size,
      0,
      -size * 0.5,
      size * 2,
      0,
      0,
      size,
      0,
      size * 0.5,
    ]);

    const indices = [0, 1, 2, 3, 4, 5];

    geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    // Create butterfly data
    const butterflies = Array.from({ length: count }, (_, i) => ({
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.5,
      radiusX: 15 + Math.random() * 20,
      radiusZ: 15 + Math.random() * 20,
      heightBase: 1.5 + Math.random() * 3,
      heightAmplitude: 0.5 + Math.random() * 1.5,
      color: [
        new THREE.Color("#ff6b6b"),
        new THREE.Color("#4ecdc4"),
        new THREE.Color("#ffe66d"),
        new THREE.Color("#a8e6cf"),
        new THREE.Color("#ff8b94"),
      ][i % 5]!,
    }));

    return { geometry: geom, butterflies };
  }, [count]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    const time = clock.getElapsedTime();
    const dummy = new THREE.Object3D();

    butterflies.forEach((butterfly, i) => {
      const t = time * butterfly.speed + butterfly.phase;

      const x = Math.cos(t * 0.3) * butterfly.radiusX;
      const z = Math.sin(t * 0.3) * butterfly.radiusZ;
      const y =
        butterfly.heightBase + Math.sin(t * 2) * butterfly.heightAmplitude;

      dummy.position.set(x, y, z);

      // Look direction
      const dx = -Math.sin(t * 0.3) * butterfly.radiusX * butterfly.speed * 0.3;
      const dz = Math.cos(t * 0.3) * butterfly.radiusZ * butterfly.speed * 0.3;
      dummy.lookAt(x + dx, y, z + dz);

      // Wing flap
      const flapSpeed = 15;
      const flap = Math.sin(time * flapSpeed + i) * 0.3;
      dummy.rotation.z += flap;

      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
      meshRef.current!.setColorAt(i, butterfly.color);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, butterflies.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        vertexColors
        roughness={0.3}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

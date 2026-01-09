"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import {
  AdditiveBlending,
  IcosahedronGeometry,
  MeshBasicMaterial,
  TorusKnotGeometry,
  Vector3,
} from "three";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function FloatingShapes({ color }: { color: string }) {
  const groupRef = useRef<Group | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const geometries = useMemo(() => {
    return {
      icosa: new IcosahedronGeometry(1, 1),
      knot: new TorusKnotGeometry(0.8, 0.22, 90, 12),
    };
  }, []);

  const material = useMemo(() => {
    const m = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.09,
      wireframe: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    return m;
  }, [color]);

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.getElapsedTime();
    const group = groupRef.current;
    if (!group) return;

    group.rotation.y = t * 0.12;
    group.rotation.x = Math.sin(t * 0.2) * 0.12;

    for (let i = 0; i < group.children.length; i += 1) {
      const child = group.children[i];
      child.rotation.x = t * (0.08 + i * 0.01);
      child.rotation.y = t * (0.12 + i * 0.02);
    }
  });

  const positions = useMemo(() => {
    return [
      new Vector3(-2.8, 1.2, -1.0),
      new Vector3(2.2, 0.5, -1.6),
      new Vector3(-0.4, -1.6, -2.2),
      new Vector3(0.9, 1.9, -2.8),
    ];
  }, []);

  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometries.icosa}
        material={material}
        position={positions[0]}
        scale={1.15}
      />
      <mesh
        geometry={geometries.knot}
        material={material}
        position={positions[1]}
        scale={0.9}
      />
      <mesh
        geometry={geometries.icosa}
        material={material}
        position={positions[2]}
        scale={0.75}
      />
      <mesh
        geometry={geometries.knot}
        material={material}
        position={positions[3]}
        scale={0.65}
      />
    </group>
  );
}

export default function AmbientShapes({ className }: { className?: string }) {
  const [color, setColor] = useState("#ffffff");
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const fg = styles.getPropertyValue("--foreground").trim();
    if (fg) setColor(fg);
  }, []);

  return (
    <div className={className} aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 6], fov: 55 }}
        frameloop={reducedMotion ? "demand" : "always"}
      >
        <FloatingShapes color={color} />
      </Canvas>
    </div>
  );
}

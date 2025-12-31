"use client";

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { extend } from "@react-three/fiber";

extend({ TextGeometry });

// Preload Helvetiker font (built into Three.js examples)
let cachedFont: any = null;
const fontPromise = new Promise((resolve) => {
  if (typeof window !== "undefined") {
    const loader = new FontLoader();
    loader.load(
      "https://threejs.org/examples/fonts/helvetiker_bold.typeface.json",
      (font) => {
        cachedFont = font;
        resolve(font);
      }
    );
  }
});

export function NeonText3D({
  text,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  size = 1,
  color = "#00ffff",
  glowColor = "#00ffff",
  glowIntensity = 2,
  extrudeDepth = 0.2,
  anchorX = "center",
  anchorY = "middle",
}: {
  text: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  size?: number;
  color?: string;
  glowColor?: string;
  glowIntensity?: number;
  extrudeDepth?: number;
  anchorX?: "left" | "center" | "right";
  anchorY?: "top" | "middle" | "bottom";
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const [geometry, setGeometry] = useState<TextGeometry | null>(null);

  useEffect(() => {
    fontPromise.then((font: any) => {
      if (!font) return;

      const textGeo = new TextGeometry(text, {
        font: font,
        size: size,
        depth: extrudeDepth,
        curveSegments: 8,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.01,
        bevelOffset: 0,
        bevelSegments: 3,
      });

      textGeo.computeBoundingBox();
      const bbox = textGeo.boundingBox!;

      // Center the geometry based on anchor
      let offsetX = 0;
      let offsetY = 0;

      if (anchorX === "center") {
        offsetX = -(bbox.max.x - bbox.min.x) / 2;
      } else if (anchorX === "right") {
        offsetX = -(bbox.max.x - bbox.min.x);
      }

      if (anchorY === "middle") {
        offsetY = -(bbox.max.y - bbox.min.y) / 2;
      } else if (anchorY === "bottom") {
        offsetY = 0;
      } else if (anchorY === "top") {
        offsetY = -(bbox.max.y - bbox.min.y);
      }

      textGeo.translate(offsetX, offsetY, 0);

      setGeometry(textGeo);

      return () => {
        textGeo.dispose();
      };
    });
  }, [text, size, extrudeDepth, anchorX, anchorY]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8,
        metalness: 0.3,
        roughness: 0.4,
      }),
    [color]
  );

  if (!geometry) return null;

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh ref={meshRef} geometry={geometry} material={material} castShadow />
      {/* Glow effect with point lights */}
      <pointLight
        position={[0, 0, extrudeDepth + 0.3]}
        color={glowColor}
        intensity={glowIntensity}
        distance={size * 3}
        decay={2}
      />
    </group>
  );
}

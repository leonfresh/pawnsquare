"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface StoneWallProps {
  position?: [number, number, number];
  width?: number;
  height?: number;
  depth?: number;
}

export function StoneWall({
  position = [0, 0, 20],
  width = 40,
  height = 3,
  depth = 1,
}: StoneWallProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  const uniforms = {
    uTime: { value: 0 },
  };

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    
    void main() {
      vUv = uv;
      vPosition = position;
      vNormal = normalize(normalMatrix * normal);
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec3 vWorldPos;

    // Hash functions
    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Simplified FBM noise
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash12(i);
      float b = hash12(i + vec2(1.0, 0.0));
      float c = hash12(i + vec2(0.0, 1.0));
      float d = hash12(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    float sfbm2_13(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for(int i = 0; i < 3; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
      }
      return value;
    }

    // Brick wall pattern based on the grass shader sdBrickWall
    float brickWallPattern(vec3 p) {
      // Brick dimensions (scaled up for visibility)
      vec3 s = vec3(0.5, 0.3, 0.3); // brick size
      float spacing = 0.075;
      vec3 c;
      c.xz = vec2(s.x + spacing, 2.0 * s.z + spacing);
      c.y = s.y + spacing;
      
      float minDist = 1000.0;
      
      // Two layers for brick offset pattern
      for(float k = 0.0; k < 2.0; k += 1.0) {
        vec3 pl = p;
        vec2 offset = -0.5 * c.xz;
        float o = 0.5 * k;
        offset.xy += o * c.xz;
        
        vec2 i = floor((pl.xz - offset) / c.xz);
        i.y = min(i.y, 2.0);
        pl.xz -= i * c.xz;
        pl.xz -= o * c.xz;
        
        // Distance to brick edges
        vec3 d = abs(pl) - s * 0.5;
        float dist = length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
        minDist = min(minDist, dist);
      }
      
      return minDist;
    }

    void main() {
      // Use world position for brick pattern
      vec3 p = vWorldPos * 2.0; // scale for brick size
      
      float brickDist = brickWallPattern(p);
      
      // Mortar lines (negative distance = inside mortar)
      float mortarWidth = 0.12;
      float mortar = smoothstep(-mortarWidth, 0.0, brickDist);
      
      // Add surface noise/weathering from grass shader
      float weathering = sfbm2_13(p.xz * 80.0) * 0.003;
      
      // Colors from the grass shader COLOR_BRICKWALL
      // COLOR_BRICKWALL = mix(vec3(0.52,0.33,0.22), vec3(0.9,0.9,0.7), 0.35)
      vec3 brickColor = mix(vec3(0.52, 0.33, 0.22), vec3(0.9, 0.9, 0.7), 0.35);
      vec3 mortarColor = vec3(0.45, 0.40, 0.35);
      
      // Per-brick variation
      vec2 brickId = floor(p.xz * 2.0);
      float brickVar = hash12(brickId) * 0.15;
      vec3 finalBrickColor = brickColor * (0.9 + brickVar);
      
      // Mix brick and mortar
      vec3 baseColor = mix(mortarColor, finalBrickColor, mortar);
      
      // Apply weathering
      baseColor += weathering;
      
      // Simple lighting
      vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
      float diffuse = max(dot(vNormal, lightDir), 0.0);
      diffuse = diffuse * 0.6 + 0.4; // Add ambient
      
      // Height-based ambient occlusion
      float ao = mix(0.7, 1.0, vUv.y);
      
      vec3 finalColor = baseColor * diffuse * ao;
      
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;

  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[width, height, depth]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

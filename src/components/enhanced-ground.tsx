"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import * as THREE from "three";

// Enhanced ground shader inspired by the grass shader's terrain techniques
export function EnhancedGround({ size = 220 }: { size?: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      grassColor1: { value: new THREE.Color("#2d3f2f") },
      grassColor2: { value: new THREE.Color("#3f6847") },
      grassColor3: { value: new THREE.Color("#5c7a52") },
    }),
    []
  );

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = clock.getElapsedTime();
    }
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      position={[0, -0.01, 0]}
    >
      <planeGeometry args={[size, size, 200, 200]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={`
          varying vec2 vUv;
          varying vec3 vPosition;
          varying float vElevation;
          uniform float time;
          
          // Hash function for noise
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            
            return mix(
              mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }
          
          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            float frequency = 1.0;
            
            for (int i = 0; i < 5; i++) {
              value += amplitude * noise(p * frequency);
              frequency *= 2.0;
              amplitude *= 0.5;
            }
            
            return value;
          }
          
          void main() {
            vUv = uv;
            vPosition = position;
            
            // Terrain elevation using fbm
            float elevation = fbm(position.xy * 0.03 + time * 0.01) * 0.3;
            elevation += fbm(position.xy * 0.08) * 0.15;
            
            // Gentle waves across the terrain
            float wave = sin(position.x * 0.1 + time * 0.3) * cos(position.y * 0.1 + time * 0.2) * 0.05;
            
            vec3 newPosition = vec3(position.xy, elevation + wave);
            vElevation = elevation;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
          }
        `}
        fragmentShader={`
          uniform float time;
          uniform vec3 grassColor1;
          uniform vec3 grassColor2;
          uniform vec3 grassColor3;
          
          varying vec2 vUv;
          varying vec3 vPosition;
          varying float vElevation;
          
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            
            return mix(
              mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }
          
          void main() {
            // Multi-scale noise for color variation
            float n1 = noise(vPosition.xy * 0.5);
            float n2 = noise(vPosition.xy * 2.0 + time * 0.05);
            float n3 = noise(vPosition.xy * 8.0);
            
            // Mix grass colors based on noise and elevation
            vec3 color = mix(grassColor1, grassColor2, n1);
            color = mix(color, grassColor3, n2 * 0.6);
            
            // Add detail
            color += vec3(n3 * 0.1);
            
            // Darken lower areas slightly
            color *= 0.85 + vElevation * 0.5;
            
            // Add subtle color variance
            float hue = noise(vPosition.xy * 0.1 + vec2(time * 0.02));
            color = mix(color, color * vec3(1.1, 0.9, 1.05), hue * 0.2);
            
            gl_FragColor = vec4(color, 1.0);
          }
        `}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

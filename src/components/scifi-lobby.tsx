"use client";

import { Text, Billboard, Float, Stars, useGLTF } from "@react-three/drei";
import { type ThreeElements, useFrame } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { NeonText3D } from "./neon-text-3d";
import type { LeaderboardEntry } from "@/lib/partyRoom";

// Note: Keep this lobby lightweight. Avoid heavy geometry/props to reduce
// WebGL context loss risk on weaker GPUs.

function HoloTape({
  position,
  color = "#00ffaa",
  label = "DATA_LOG_01",
}: {
  position: [number, number, number];
  color?: string;
  label?: string;
}) {
  return (
    <group position={position}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh rotation={[0, 0, 0]}>
          <planeGeometry args={[1.8, 1]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh rotation={[0, 0, 0]}>
          <planeGeometry args={[1.8, 1]} />
          <meshBasicMaterial
            color={color}
            wireframe
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
        <Text
          position={[-0.8, 0.3, 0.01]}
          fontSize={0.15}
          color={color}
          anchorX="left"
          anchorY="top"
        >
          {label}
        </Text>
        <Text
          position={[-0.8, 0, 0.01]}
          fontSize={0.08}
          color={color}
          anchorX="left"
          anchorY="top"
          maxWidth={1.6}
          lineHeight={1.2}
        >
          {`> ANALYZING SECTOR 7\n> OPTIMIZING MESH...\n> UPLOAD COMPLETE`}
        </Text>
      </Float>
    </group>
  );
}

function Blimp({ position, range = 40, speed = 0.1, text, color }: any) {
  const groupRef = useRef<THREE.Group>(null);
  const [offset] = useState(() => Math.random() * 100);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime() * speed + offset;
      // Elliptical orbit
      groupRef.current.position.x = Math.sin(t) * range;
      groupRef.current.position.z = Math.cos(t) * (range * 0.6);
      groupRef.current.position.y = position[1] + Math.sin(t * 2) * 2;

      const dx = Math.cos(t) * range;
      const dz = -Math.sin(t) * (range * 0.6);
      groupRef.current.rotation.y = Math.atan2(dx, dz);
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Hull */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[2, 8, 8, 16]} />
        <meshStandardMaterial color="#222" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Neon side text (on hull) */}
      <group position={[2.25, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Text
          position={[0, 0, 0.02]}
          fontSize={0.85}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.07}
          outlineColor={color}
          outlineOpacity={0.8}
          fillOpacity={1}
        >
          {text}
        </Text>
        <pointLight
          position={[0, 0, 0.55]}
          color={color}
          intensity={8}
          distance={10}
          decay={2}
        />
      </group>
      <group position={[-2.25, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Text
          position={[0, 0, 0.02]}
          fontSize={0.85}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.07}
          outlineColor={color}
          outlineOpacity={0.8}
          fillOpacity={1}
        >
          {text}
        </Text>
        <pointLight
          position={[0, 0, 0.55]}
          color={color}
          intensity={8}
          distance={10}
          decay={2}
        />
      </group>

      {/* Cabin */}
      <mesh position={[0, -2.5, 0]}>
        <boxGeometry args={[1.5, 1, 3]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[0, -2.5, 1.51]}>
        <planeGeometry args={[1.2, 0.6]} />
        <meshBasicMaterial color="#ffffaa" toneMapped={false} />
      </mesh>

      {/* Fins */}
      <group position={[0, 0, -5]}>
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[0.2, 3, 2]} />
          <meshStandardMaterial color="#333" />
        </mesh>
        <mesh position={[0, -1.5, 0]}>
          <boxGeometry args={[0.2, 3, 2]} />
          <meshStandardMaterial color="#333" />
        </mesh>
        <mesh position={[1.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.2, 3, 2]} />
          <meshStandardMaterial color="#333" />
        </mesh>
        <mesh position={[-1.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.2, 3, 2]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </group>

      {/* Screen / Ad on side (Left) */}
      <group position={[1.8, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 0, -0.1]}>
          <planeGeometry args={[6, 2.5]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[5, 1.5]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      </group>

      {/* Screen / Ad on side (Right) */}
      <group position={[-1.8, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 0, -0.1]}>
          <planeGeometry args={[6, 2.5]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[5, 1.5]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      </group>

      {/* Engine Glow */}
      <pointLight
        position={[0, 0, -6]}
        color="#00ffff"
        intensity={2}
        distance={10}
      />
    </group>
  );
}

function FlyingCar({
  a,
  b,
  y = 34,
  speed = 0.06,
  color = "#00ffff",
  seed = 0,
}: {
  a: [number, number, number];
  b: [number, number, number];
  y?: number;
  speed?: number;
  color?: string;
  seed?: number;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;

    const t = clock.getElapsedTime() * speed + seed;
    const u = t - Math.floor(t);

    const x = THREE.MathUtils.lerp(a[0], b[0], u);
    const z = THREE.MathUtils.lerp(a[2], b[2], u);
    const wobble = Math.sin((t + seed) * 2.7) * 0.8;
    const yy = y + wobble;

    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    g.position.set(x, yy, z);
    g.rotation.y = Math.atan2(dx, dz);
  });

  return (
    <group ref={ref}>
      <mesh castShadow={false}>
        <boxGeometry args={[0.8, 0.22, 1.6]} />
        <meshStandardMaterial color="#06060a" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, -0.95]}>
        <boxGeometry args={[0.22, 0.08, 0.8]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.75}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.95]}>
        <boxGeometry args={[0.22, 0.08, 0.8]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.45}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function WindowPanel({
  width,
  height,
  seed,
  accent,
}: {
  width: number;
  height: number;
  seed: number;
  accent: string;
}) {
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seed },
        uAccent: { value: new THREE.Color(accent) },
        uDotGrid: { value: 180 },
        uDotRadius: { value: 0.14 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uAccent;
        uniform float uDotGrid;
        uniform float uDotRadius;

        float hash11(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          // Tiny "star" dots across the facade. No window rectangles.
          vec2 grid = vec2(uDotGrid, uDotGrid * 0.65);
          vec2 cell = floor(vUv * grid);
          vec2 f = fract(vUv * grid);

          float r = hash21(cell + uSeed);
          // slightly more dots so they're visible at distance
          float on = step(0.82, r);

          // random dot center per cell
          vec2 c = vec2(hash21(cell + uSeed * 0.73), hash21(cell + uSeed * 1.11));
          // make dots not hug edges
          c = mix(vec2(0.25), vec2(0.75), c);
          float d = length(f - c);

          // dot radius + twinkle
          float tw = 0.75 + 0.25 * sin(uTime * (1.8 + r * 4.0) + r * 12.3);
          float rad = uDotRadius * (0.7 + 0.6 * r);
          float dot = smoothstep(rad, rad * 0.25, d);

          // occasional brighter dots
          float bright = step(0.975, r);

          // subtle scanline to match the vibe, but keep it minimal
          float scan = 0.92 + 0.08 * sin(vUv.y * 520.0 + uTime * 6.0 + uSeed * 0.07);

          vec3 col = mix(vec3(1.0, 0.7, 0.25), uAccent, step(0.72, hash21(cell + uSeed + 7.0)));
          col = mix(col, vec3(0.2, 1.0, 1.0), step(0.84, hash21(cell + uSeed + 19.0)));
          col = mix(col, vec3(1.0, 0.0, 1.0), step(0.94, hash21(cell + uSeed + 31.0)));

          // add a faint "background" sparkle field so facades aren't totally dead
          float haze = (hash21(cell + uSeed + 101.0) * 0.015) * (0.6 + 0.4 * tw);

          float a = on * dot * (0.10 + 0.22 * tw + 0.28 * bright) + haze;
          vec3 rgb = col * (0.30 + 0.80 * tw) * (0.60 + 0.70 * bright);
          rgb *= scan;

          // still subtle vs ads, but visible
          gl_FragColor = vec4(rgb * 0.62, a * 0.78);
        }
      `,
    });
    return m;
  }, [accent, seed]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function HoloAdPanel({
  width,
  height,
  seed,
  primary,
  secondary,
}: {
  width: number;
  height: number;
  seed: number;
  primary: string;
  secondary: string;
}) {
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seed },
        uPrimary: { value: new THREE.Color(primary) },
        uSecondary: { value: new THREE.Color(secondary) },
        uMode: { value: (seed % 8) as number },
        uVariant: { value: ((seed * 0.013) % 1) as number },
        uFlipX: { value: (seed * 0.37) % 1 > 0.5 ? 1 : 0 },
        uFlipY: { value: (seed * 0.19) % 1 > 0.5 ? 1 : 0 },
        uRot: { value: (seed * 0.29) % 1 > 0.72 ? 1 : 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uPrimary;
        uniform vec3 uSecondary;
        uniform float uMode;
        uniform float uVariant;
        uniform float uFlipX;
        uniform float uFlipY;
        uniform float uRot;

        float hash11(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
        }

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float box(vec2 p, vec2 b) {
          vec2 d = abs(p) - b;
          return step(max(d.x, d.y), 0.0);
        }

        float circle(vec2 p, float r) {
          return step(length(p), r);
        }

        float seg(vec2 uv, float a, float b) {
          return step(a, uv.x) * step(uv.x, b);
        }

        float glyph(vec2 uv, float seed) {
          // Fake "text": a small 6x10 glyph made of random blocks.
          vec2 g = vec2(6.0, 10.0);
          vec2 cell = floor(uv * g);
          vec2 f = fract(uv * g);
          float r = hash21(cell + seed);
          float on = step(0.78, r);
          // keep blocks chunky
          float inset = 0.15;
          float inside = step(inset, f.x) * step(inset, f.y) * step(f.x, 1.0 - inset) * step(f.y, 1.0 - inset);
          return on * inside;
        }

        float sdEllipse(vec2 p, vec2 r) {
          // Approx ellipse SDF (good enough for stylized art)
          vec2 q = p / r;
          return length(q) - 1.0;
        }

        float geoCollage(vec2 uv, float seed, float t) {
          // Non-figurative graphic collage: blocks + rings + diagonals.
          vec2 p = uv - 0.5;
          float n = noise(uv * vec2(6.0, 9.0) + seed);

          // diagonal cut
          float diag = smoothstep(0.02, -0.02, (p.x + p.y) - (0.05 + 0.25 * (hash11(seed) - 0.5)));
          // blocks
          float b0 = box(p - vec2(-0.10, 0.12), vec2(0.18, 0.10));
          float b1 = box(p - vec2(0.16, -0.06), vec2(0.22, 0.08));
          float b2 = box(p - vec2(-0.18, -0.18), vec2(0.12, 0.12));
          // rings
          float r0 = smoothstep(0.012, 0.0, abs(length(p - vec2(0.10, 0.10)) - (0.22 + 0.03 * sin(t * 1.2 + seed))));
          float r1 = smoothstep(0.010, 0.0, abs(length(p - vec2(-0.14, -0.02)) - 0.14));

          float pulse = 0.75 + 0.25 * sin(t * (1.6 + hash11(seed + 9.0) * 2.0) + seed);
          float g = 0.0;
          g += (b0 * 0.85 + b1 * 0.65 + b2 * 0.55) * (0.75 + 0.25 * n);
          g += (r0 * 0.90 + r1 * 0.65);
          g *= (0.70 + 0.30 * pulse);
          g = clamp(g + 0.35 * diag, 0.0, 1.0);
          return g;
        }

        float goldfishArt(vec2 uv, float seed, float t) {
          // Stylized goldfish silhouette swimming across.
          float sp = mix(0.04, 0.10, hash11(seed + 7.0));
          float phase = fract(t * sp + hash11(seed + 19.0) * 7.0);
          vec2 p = uv - vec2(mix(1.1, -0.1, phase), 0.55 + (hash11(seed + 3.0) - 0.5) * 0.25);
          // wobble
          p.y += sin((p.x + seed) * 8.0 + t * 6.0) * 0.01;

          float body = 1.0 - smoothstep(-0.02, 0.10, sdEllipse(p * vec2(1.0, 1.2), vec2(0.12, 0.08)));
          float head = 1.0 - smoothstep(-0.02, 0.10, sdEllipse((p - vec2(0.08, 0.0)) * vec2(1.0, 1.3), vec2(0.08, 0.06)));
          // tail (two fins)
          vec2 tp = p + vec2(0.12, 0.0);
          float tailA = box(tp + vec2(0.06, 0.02), vec2(0.06, 0.03));
          float tailB = box(tp + vec2(0.06, -0.02), vec2(0.06, 0.03));
          float tail = (tailA + tailB) * 0.55;
          // bubbles
          float bub = 0.0;
          bub += circle(p - vec2(0.18, 0.04), 0.018);
          bub += circle(p - vec2(0.22, 0.00), 0.012);
          bub += circle(p - vec2(0.20, -0.05), 0.010);

          float fish = clamp(body + head + tail, 0.0, 1.0);
          fish *= smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);
          return clamp(fish + bub * 0.35, 0.0, 1.0);
        }

        void main() {
          // Slight UV distortion
          vec2 uv = vUv;
          float t = uTime;

          // Panel transform variation (rotation / flips)
          if (uRot > 0.5) uv = uv.yx;
          if (uFlipX > 0.5) uv.x = 1.0 - uv.x;
          if (uFlipY > 0.5) uv.y = 1.0 - uv.y;

          float n1 = noise(uv * vec2(3.0, 8.0) + vec2(0.0, t * 0.1) + uSeed);
          float n2 = noise(uv * vec2(18.0, 6.0) + vec2(t * 0.15, 0.0) + uSeed * 0.7);
          uv.x += (n2 - 0.5) * 0.015;
          uv.y += (n1 - 0.5) * 0.01;

          // Scanlines + subtle VHS shimmer
          float scan = 0.75 + 0.25 * sin((uv.y * 520.0 + t * 10.0) + uSeed * 0.17);
          float shimmer = 0.9 + 0.1 * sin(t * 3.0 + uv.x * 40.0 + uSeed);

          // Glitch bands
          float gb = step(0.985, hash11(floor(t * 0.8) + uSeed * 0.13));
          float row = floor(uv.y * 40.0);
          float band = step(0.92, hash11(row + floor(t * 1.8) + uSeed));
          float glitch = gb * band;
          uv.x += glitch * (hash11(row + uSeed) - 0.5) * 0.08;

          // Base gradient
          float grad = smoothstep(0.0, 1.0, uv.y);
          vec3 base = mix(uSecondary, uPrimary, grad);

          // Mode selection (0..7)
          float m0 = 1.0 - step(0.5, uMode);
          float m1 = step(0.5, uMode) * (1.0 - step(1.5, uMode));
          float m2 = step(1.5, uMode) * (1.0 - step(2.5, uMode));
          float m3 = step(2.5, uMode) * (1.0 - step(3.5, uMode));
          float m4 = step(3.5, uMode) * (1.0 - step(4.5, uMode));
          float m5 = step(4.5, uMode) * (1.0 - step(5.5, uMode));
          float m6 = step(5.5, uMode) * (1.0 - step(6.5, uMode));
          float m7 = step(6.5, uMode);

          // "Screen" frame + inner mask
          vec2 p = uv - 0.5;
          float frame = 1.0 - box(p, vec2(0.49, 0.49));
          float inner = box(p, vec2(0.46, 0.46));

          // Content layers: logo + text blocks + noise
          float content = inner;
          float grain = noise(uv * 120.0 + uSeed * 3.0 + t * 0.2);
          float vign = smoothstep(0.9, 0.25, length(p));

          // Big logo region
          float logo = box(p - vec2(0.0, 0.12), vec2(0.22, 0.14));
          float logoN = noise((uv + uSeed) * vec2(10.0, 20.0) + t * 0.4);
          logo *= (0.65 + 0.35 * logoN);

          // Text stacks (fake glyphs)
          float text = 0.0;
          // two columns of glyphs
          vec2 tuv = uv;
          tuv.y = fract(uv.y * 2.2 + t * 0.12 + hash11(uSeed) * 7.0);
          float colA = step(0.08, uv.x) * step(uv.x, 0.46);
          float colB = step(0.54, uv.x) * step(uv.x, 0.92);
          float rowMask = step(0.12, uv.y) * step(uv.y, 0.86);
          float gA = glyph(fract(vec2(uv.x * 3.0, tuv.y * 5.0)), uSeed * 1.7 + floor(uv.y * 18.0));
          float gB = glyph(fract(vec2((uv.x + 0.13) * 3.0, tuv.y * 5.0)), uSeed * 2.3 + floor(uv.y * 18.0) + 9.0);
          text += gA * colA * rowMask;
          text += gB * colB * rowMask;

          // Falling "data rain" lines
          float lane = floor(uv.x * 22.0);
          float lr = hash11(lane + uSeed * 0.37);
          float sp = mix(0.10, 0.35, lr);
          float rr = fract(t * sp + lr * 13.0);
          float rain = smoothstep(rr, rr - 0.05, uv.y) * smoothstep(rr - 0.15, rr - 0.05, uv.y);
          float rainMask = step(0.16, uv.x) * step(uv.x, 0.84);
          float rainAmp = rain * rainMask * (0.4 + 0.6 * hash11(lane + uSeed));

          // Mode2: bar graph / HUD
          float bars = 0.0;
          float bx = floor(uv.x * 14.0);
          float br = hash11(bx + uSeed * 0.91);
          float h = mix(0.12, 0.80, br);
          bars = step(0.10, uv.x) * step(uv.x, 0.90) * step(0.10, uv.y) * step(uv.y, h);
          // add a bright "threshold" line
          bars += step(0.1, uv.x) * step(uv.x, 0.9) * smoothstep(0.012, 0.0, abs(uv.y - h));

          // Mode3: circular radar + arcs
          float radar = 0.0;
          float ring = smoothstep(0.012, 0.0, abs(length(p) - 0.30));
          float ring2 = smoothstep(0.010, 0.0, abs(length(p) - 0.42));
          float sweep = smoothstep(0.04, 0.0, abs(fract(atan(p.y, p.x) / 6.28318 + t * (0.08 + uVariant * 0.12)) - 0.5));
          radar = circle(p, 0.46) * (0.35 * ring + 0.22 * ring2 + 0.18 * sweep);

          // Mode4: diagonal stripes + ticker
          float stripes = 0.0;
          float s = sin((uv.x + uv.y) * 38.0 + t * (1.8 + uVariant * 1.2));
          stripes = smoothstep(0.35, 0.95, s) * step(0.08, uv.y) * step(uv.y, 0.92);

          // bottom ticker band with scrolling glyphs
          float tickerBand = step(0.07, uv.y) * step(uv.y, 0.15) * step(0.08, uv.x) * step(uv.x, 0.92);
          float tickerX = fract(uv.x * 10.0 + t * (0.35 + uVariant * 0.8));
          float tickerG = glyph(fract(vec2(tickerX, uv.y * 6.0)), uSeed * 3.7 + floor(t * 2.0));
          float ticker = tickerBand * tickerG * 0.85;

          // Compose by mode
          float layer = 0.0;
          // Mode0: big logo + some rain
          layer += m0 * (logo * 0.95 + rainAmp * 0.35);
          // Mode1: text heavy + ticker
          layer += m1 * (text * 0.95 + ticker * 0.85 + rainAmp * 0.25);
          // Mode2: HUD bars + text
          layer += m2 * (bars * 0.95 + text * 0.35);
          // Mode3: radar + sparse glyphs
          layer += m3 * (radar * 1.15 + text * 0.25);
          // Mode4: stripes + ticker + logo small
          layer += m4 * (stripes * 0.65 + ticker * 0.95 + logo * 0.35);

          // Mode5: geometric collage (no faces)
          float collage = geoCollage(uv, uSeed, t);
          layer += m5 * (collage * 0.95 + ticker * 0.35 + bars * 0.15);

          // Mode6: goldfish / aquatic holo
          float fish = goldfishArt(uv, uSeed, t);
          layer += m6 * (fish * 1.15 + rainAmp * 0.25 + stripes * 0.15);

          // Mode7: dense glyph wall
          float glyphWall = 0.0;
          vec2 guv = uv;
          guv.y = fract(uv.y * 3.0 + t * (0.18 + uVariant * 0.35));
          glyphWall += glyph(fract(vec2(uv.x * 6.0, guv.y * 7.0)), uSeed * 4.1 + floor(uv.y * 40.0));
          glyphWall += glyph(fract(vec2((uv.x + 0.21) * 6.0, guv.y * 7.0)), uSeed * 3.3 + floor(uv.y * 40.0) + 11.0);
          glyphWall = clamp(glyphWall, 0.0, 1.0);
          layer += m7 * (glyphWall * 0.95 + rainAmp * 0.35);

          // universal sprinkle of rain for life
          layer = clamp(layer + rainAmp * 0.25, 0.0, 1.0);
          layer = clamp(layer + rainAmp, 0.0, 1.0);

          // Final color
          vec3 rgb = base;
          rgb += uPrimary * (0.30 * layer + 0.16 * rainAmp);
          rgb += uSecondary * (0.20 * layer);

          // Artwork color accents
          rgb += uSecondary * (0.18 * collage * m5);
          rgb += uPrimary * (0.16 * fish * m6);

          // Matte/dim mask so the facade doesn't read like one giant TV.
          // Create large "dead" patches + edge fade where the building material shows.
          float bigN = noise(uv * vec2(1.6, 2.2) + vec2(uSeed * 0.03, uSeed * 0.07));
          float patchMask = smoothstep(0.35, 0.78, bigN);
          float dead = smoothstep(0.78, 0.95, bigN); // some zones become very dim
          float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, uv.y) *
                       smoothstep(1.0, 0.92, uv.x) * smoothstep(1.0, 0.92, uv.y);
          float matte = mix(0.22, 0.72, patchMask);
          matte *= mix(1.0, 0.22, dead);
          matte *= mix(0.55, 1.0, edge);

          rgb *= matte;

          rgb += vec3(0.12, 0.16, 0.22) * (grain - 0.5);
          rgb *= scan * shimmer;
          rgb *= vign;

          // frame dimming
          rgb *= content;
          rgb += uPrimary * (0.04 * frame);

          float a = (0.16 + 0.34 * layer + 0.10 * rainAmp) * content;
          a *= (0.88 + 0.12 * scan);
          a *= (1.0 + 0.18 * glitch);

          // tie opacity to matte so some areas are dimmer / more "building".
          a *= (0.40 + 0.60 * matte);

          gl_FragColor = vec4(rgb, a);
        }
      `,
    });
    return m;
  }, [primary, secondary, seed]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function SciFiSky() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
    }),
    []
  );

  useFrame(({ clock }) => {
    const m = materialRef.current;
    if (m) m.uniforms.time.value = clock.getElapsedTime();
  });

  return (
    <mesh scale={600} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 24]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `}
        fragmentShader={`
          uniform float time;
          varying vec3 vWorldPosition;

          // Auroras by nimitz 2017 (twitter: @stormoid)
          // Adapted for Three.js

          mat2 mm2(in float a){float c = cos(a), s = sin(a);return mat2(c,s,-s,c);}
          mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
          float tri(in float x){return clamp(abs(fract(x)-.5),0.01,0.49);}
          vec2 tri2(in vec2 p){return vec2(tri(p.x)+tri(p.y),tri(p.y+tri(p.x)));}

          float triNoise2d(in vec2 p, float spd)
          {
              float z=1.8;
              float z2=2.5;
              float rz = 0.;
              p *= mm2(p.x*0.06);
              vec2 bp = p;
              for (float i=0.; i<5.; i++ )
              {
                  vec2 dg = tri2(bp*1.85)*.75;
                  dg *= mm2(time*spd);
                  p -= dg/z2;

                  bp *= 1.3;
                  z2 *= .45;
                  z *= .42;
                  p *= 1.21 + (rz-1.0)*.02;
                  
                  rz += tri(p.x+tri(p.y))*z;
                  p*= -m2;
              }
              return clamp(1./pow(rz*29., 1.3),0.,.55);
          }

          float hash21(in vec2 n){ return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
          
          vec4 aurora(vec3 ro, vec3 rd)
          {
              vec4 col = vec4(0);
              vec4 avgCol = vec4(0);
              
              // Reduced iterations from 50 to 25 for performance
              for(float i=0.;i<25.;i++)
              {
                  float of = 0.006*hash21(gl_FragCoord.xy)*smoothstep(0.,15., i);
                  float pt = ((.8+pow(i,1.4)*.002)-ro.y)/(rd.y*2.+0.4);
                  pt -= of;
                  vec3 bpos = ro + pt*rd;
                  vec2 p = bpos.zx;
                  float rzt = triNoise2d(p, 0.06);
                  vec4 col2 = vec4(0,0,0, rzt);
                  col2.rgb = (sin(1.-vec3(2.15,-.5, 1.2)+i*0.043)*0.5+0.5)*rzt;
                  avgCol =  mix(avgCol, col2, .5);
                  col += avgCol*exp2(-i*0.065 - 2.5)*smoothstep(0.,5., i);
                  
              }
              
              col *= (clamp(rd.y*15.+.4,0.,1.));
              return col*1.8;
          }

          void main() {
            vec3 rd = normalize(vWorldPosition);
            vec3 ro = vec3(0.0, 0.0, -6.7); // Fixed origin to match original shader scale

            vec3 col = vec3(0.0);
            
            // Background gradient (simplified from original)
            float sd = dot(normalize(vec3(-0.5, -0.6, 0.9)), rd)*0.5+0.5;
            sd = pow(sd, 5.);
            vec3 bgCol = mix(vec3(0.05,0.1,0.2), vec3(0.1,0.05,0.2), sd);
            col = bgCol * 0.63;

            // Only render aurora above horizon
            if (rd.y > 0.0) {
                vec4 aur = smoothstep(0., 1.5, aurora(ro, rd));
                col = col * (1.0 - aur.a) + aur.rgb;
            }
            
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function SciFiFloor() {
  return (
    <group>
      {/* Main floor - shiny base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <SciFiFloorMaterial
          variant="carpet"
          color="#0b4a4a"
          roughness={0.96}
          metalness={0.03}
          emissive="#000000"
          emissiveIntensity={0.0}
        />
      </mesh>

      {/* Matte "Carpet" Zones - adds variance */}
      <group position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {/* Central Hub Carpet */}
        <mesh receiveShadow>
          <circleGeometry args={[13, 64]} />
          <SciFiFloorMaterial
            variant="carpet"
            color="#151525"
            roughness={0.95}
            metalness={0.05}
          />
        </mesh>

        {/* Outer Walkway Ring */}
        <mesh receiveShadow>
          <ringGeometry args={[24, 36, 64]} />
          <SciFiFloorMaterial
            variant="carpet"
            color="#101018"
            roughness={0.98}
            metalness={0.02}
          />
        </mesh>
      </group>

      {/* Glowing rings */}
      {Array.from({ length: 3 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[15 + i * 5, 15.1 + i * 5, 64]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? "#00ffff" : "#ff00ff"}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function SciFiFloorMaterial({
  variant,
  ...props
}: { variant: "base" | "carpet" } & ThreeElements["meshStandardMaterial"]) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vWorldPos;
      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );

    const defines =
      variant === "carpet"
        ? "#define SCIFI_CARPET 1\n"
        : "#define SCIFI_CARPET 0\n";

    shader.fragmentShader = `
      ${defines}
      varying vec3 vWorldPos;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i + vec2(0.0, 0.0));
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm2(vec2 p) {
        float f = 0.0;
        f += 0.5000 * noise2(p); p *= 2.02;
        f += 0.2500 * noise2(p); p *= 2.03;
        f += 0.1250 * noise2(p); p *= 2.01;
        f += 0.0625 * noise2(p);
        return f;
      }

      float panelSeams(vec2 p, vec2 cell) {
        // p: world-space scaled coords. cell: seam spacing.
        vec2 g = p / cell;
        vec2 f = abs(fract(g) - 0.5);
        float line = min(f.x, f.y);
        // seam width in "cell" space
        return 1.0 - smoothstep(0.485, 0.5, line);
      }

      ${shader.fragmentShader}
    `
      .replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>

        // World-space polish: panels + grime + subtle variation.
        vec2 p = vWorldPos.xz;
        float g0 = panelSeams(p, vec2(2.4, 2.4));
        float g1 = panelSeams(p + vec2(0.7, 1.1), vec2(6.2, 6.2));
        float seams = clamp(g0 * 0.85 + g1 * 0.35, 0.0, 1.0);

        float grime = fbm2(p * 0.28) * 0.75 + fbm2(p * 1.4) * 0.25;
        float wear = smoothstep(0.35, 0.85, grime);

        // Slightly darken broad areas; brighten seam edges a hair.
        diffuseColor.rgb *= mix(0.86, 1.02, wear);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.10, seams * (SCIFI_CARPET == 1 ? 0.06 : 0.12));

        // Carpet fiber/grain (only for carpet): anisotropic micro-variation.
        if (SCIFI_CARPET == 1) {
          float grain = fbm2(p * vec2(0.55, 6.5));
          float micro = fbm2(p * vec2(3.0, 22.0));
          float fibers = (grain * 0.7 + micro * 0.3);
          float speck = smoothstep(0.82, 1.0, fbm2(p * 18.0));
          diffuseColor.rgb *= (0.92 + 0.12 * fibers);
          diffuseColor.rgb += vec3(0.02, 0.06, 0.06) * (0.12 * speck);
        } else {
          // Add faint cool tint bias so it reads cyberpunk, not flat black.
          diffuseColor.rgb += vec3(0.0, 0.004, 0.008);
        }
        `
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `
        #include <roughnessmap_fragment>
        vec2 pR = vWorldPos.xz;
        float rN = fbm2(pR * (SCIFI_CARPET == 1 ? 0.55 : 0.35));
        float rV = mix(0.90, 1.22, rN);
        if (SCIFI_CARPET == 1) {
          float microR = fbm2(pR * 8.0);
          rV *= mix(0.95, 1.15, microR);
        }
        roughnessFactor = clamp(roughnessFactor * rV, 0.02, 1.0);
        `
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `
        #include <metalnessmap_fragment>
        vec2 pM = vWorldPos.xz;
        float mN = fbm2(pM * (SCIFI_CARPET == 1 ? 0.60 : 0.28));
        float mV = (SCIFI_CARPET == 1) ? mix(0.85, 1.05, mN) : mix(0.78, 1.10, mN);
        metalnessFactor = clamp(metalnessFactor * mV, 0.0, 1.0);
        `
      )
      .replace(
        "#include <emissivemap_fragment>",
        `
        #include <emissivemap_fragment>

        // Subtle emissive seam accents on the shiny base only.
        #if SCIFI_CARPET == 0
          vec2 pE = vWorldPos.xz;
          float s0 = panelSeams(pE, vec2(2.4, 2.4));
          float s1 = panelSeams(pE + vec2(0.7, 1.1), vec2(6.2, 6.2));
          float s = clamp(s0 * 0.85 + s1 * 0.35, 0.0, 1.0);
          float flicker = 0.6 + 0.4 * noise2(pE * 0.3);
          vec3 seamCol = mix(vec3(0.0, 0.65, 1.0), vec3(1.0, 0.0, 0.9), noise2(pE * 0.07));
          totalEmissiveRadiance += seamCol * (0.06 * s * flicker);
        #endif
        `
      );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      {...props}
    />
  );
}

function SciFiWallMaterial(props: ThreeElements["meshStandardMaterial"]) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vWorldPos;
      varying vec3 vWorldN;
      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldN = normalize(mat3(modelMatrix) * normal);
        `
    );

    shader.fragmentShader = `
      varying vec3 vWorldPos;
      varying vec3 vWorldN;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i + vec2(0.0, 0.0));
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm2(vec2 p) {
        float f = 0.0;
        f += 0.5000 * noise2(p); p *= 2.02;
        f += 0.2500 * noise2(p); p *= 2.03;
        f += 0.1250 * noise2(p); p *= 2.01;
        f += 0.0625 * noise2(p);
        return f;
      }

      float panelSeams(vec2 p, vec2 cell) {
        vec2 g = p / cell;
        vec2 f = abs(fract(g) - 0.5);
        float line = min(f.x, f.y);
        return 1.0 - smoothstep(0.485, 0.5, line);
      }

      vec2 wallCoords(vec3 wp, vec3 wn) {
        // Axis-projected coords so seams read correctly on vertical faces.
        vec3 an = abs(wn);
        if (an.z > an.x && an.z > an.y) return wp.xy; // front/back faces
        if (an.x > an.y) return wp.zy; // left/right faces
        return wp.xz; // top/bottom (fallback)
      }

      ${shader.fragmentShader}
    `
      .replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>

        vec2 p = wallCoords(vWorldPos, vWorldN);
        float g0 = panelSeams(p, vec2(1.8, 1.8));
        float g1 = panelSeams(p + vec2(0.35, 0.55), vec2(4.8, 4.8));
        float seams = clamp(g0 * 0.9 + g1 * 0.35, 0.0, 1.0);

        float grime = fbm2(p * 0.45) * 0.75 + fbm2(p * 2.1) * 0.25;
        float wear = smoothstep(0.25, 0.85, grime);

        diffuseColor.rgb *= mix(0.86, 1.03, wear);
        diffuseColor.rgb += vec3(0.0, 0.004, 0.010);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12, seams * 0.10);
        `
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `
        #include <roughnessmap_fragment>
        vec2 pR = wallCoords(vWorldPos, vWorldN);
        float rN = fbm2(pR * 0.55);
        roughnessFactor = clamp(roughnessFactor * mix(0.88, 1.20, rN), 0.02, 1.0);
        `
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `
        #include <metalnessmap_fragment>
        vec2 pM = wallCoords(vWorldPos, vWorldN);
        float mN = fbm2(pM * 0.25);
        metalnessFactor = clamp(metalnessFactor * mix(0.85, 1.15, mN), 0.0, 1.0);
        `
      )
      .replace(
        "#include <emissivemap_fragment>",
        `
        #include <emissivemap_fragment>

        vec2 pE = wallCoords(vWorldPos, vWorldN);
        float s0 = panelSeams(pE, vec2(1.8, 1.8));
        float s1 = panelSeams(pE + vec2(0.35, 0.55), vec2(4.8, 4.8));
        float s = clamp(s0 * 0.9 + s1 * 0.35, 0.0, 1.0);
        float flicker = 0.65 + 0.35 * noise2(pE * 0.35);
        vec3 seamCol = mix(vec3(0.0, 0.75, 1.0), vec3(1.0, 0.0, 0.9), noise2(pE * 0.12));
        totalEmissiveRadiance += seamCol * (0.09 * s * flicker);
        `
      );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      {...props}
    />
  );
}

export function SciFiLamp({ lampPos }: { lampPos: [number, number, number] }) {
  return (
    <group position={lampPos}>
      {/* Base */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.15, 0.25, 0.2, 8]} />
        <meshStandardMaterial color="#111" roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Glowing Pole */}
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 4, 8]} />
        <meshStandardMaterial
          color="#ff00ff"
          emissive="#ff00ff"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      {/* Top Light */}
      <pointLight
        position={[0, 3.5, 0]}
        intensity={2}
        color="#ff00ff"
        distance={15}
        decay={2}
      />
      <mesh position={[0, 4, 0]}>
        <octahedronGeometry args={[0.2, 0]} />
        <meshBasicMaterial color="#ffccff" wireframe toneMapped={false} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function SciFiPlanters() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      groupRef.current.children.forEach((child, i) => {
        // Animate the holographic plant inside
        const holo = child.getObjectByName("holo");
        if (holo) {
          holo.rotation.y = -t * 0.5 + i;
          holo.rotation.z = Math.sin(t * 0.5 + i) * 0.1;
        }
      });
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const radius = 16.5;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, -angle, 0]}>
            {/* Planter pedestal */}
            <mesh position={[0, 0.16, 0]}>
              <cylinderGeometry args={[1.15, 1.2, 0.32, 10]} />
              <meshStandardMaterial
                color="#0a0a14"
                roughness={0.35}
                metalness={0.8}
              />
            </mesh>

            {/* (Removed) decorative benches not spawned by the chessboards */}

            {/* Holographic data stream in center */}
            <group name="holo" position={[0, 1.62, 0]}>
              <mesh>
                <cylinderGeometry args={[0.8, 0.8, 2, 6, 4, true]} />
                <meshBasicMaterial
                  color="#00ffaa"
                  wireframe
                  transparent
                  opacity={0.15}
                  toneMapped={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <mesh scale={[0.8, 0.8, 0.8]}>
                <octahedronGeometry args={[0.6, 0]} />
                <meshBasicMaterial
                  color="#00ffaa"
                  wireframe
                  transparent
                  opacity={0.4}
                  toneMapped={false}
                />
              </mesh>
            </group>
            {/* Inner glow for holo */}
            <pointLight
              position={[0, 1.05, 0]}
              color="#00ffaa"
              intensity={1.5}
              distance={6}
              decay={2}
            />

            {/* Floating HoloTape */}
            <HoloTape
              position={[0, 2.62, 0]}
              color="#00ffaa"
              label={`TERMINAL_0${i + 1}`}
            />
          </group>
        );
      })}
    </group>
  );
}

function GiantTV({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock }) => {
    if (materialRef.current)
      materialRef.current.uniforms.time.value = clock.getElapsedTime();
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[3, 2, 0.2]} />
        <meshStandardMaterial color="#111" roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.11]}>
        <planeGeometry args={[2.8, 1.8]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={{ time: { value: 0 } }}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform float time;
            varying vec2 vUv;
            
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
              vec2 uv = vUv;
              // Glitchy static effect
              float noise = random(uv * vec2(100.0, 100.0) + time * 10.0);
              
              // Moving bars
              float bar = step(0.9, sin(uv.y * 20.0 + time * 5.0));
              
              vec3 col = vec3(0.0, 0.8, 1.0) * noise * 0.5;
              col += vec3(1.0, 0.0, 0.5) * bar * 0.5;
              
              // Scanlines
              col *= 0.8 + 0.2 * sin(uv.y * 200.0 + time * 10.0);
              
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>
    </group>
  );
}

function SciFiDecorations() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      groupRef.current.children.forEach((child, i) => {
        // Animate rings
        const ring1 = child.getObjectByName("ring1");
        const ring2 = child.getObjectByName("ring2");
        if (ring1) ring1.rotation.z = t * 0.2 + i;
        if (ring2) ring2.rotation.x = t * 0.3 + i;
      });
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const radius = 28;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        return (
          <group
            key={i}
            position={[x, 0, z]}
            rotation={[0, -angle + Math.PI / 2, 0]}
          >
            {/* Data Pillar */}
            <mesh position={[0, 4, 0]}>
              <boxGeometry args={[0.8, 8, 0.8]} />
              <meshStandardMaterial
                color="#050510"
                roughness={0.1}
                metalness={0.9}
              />
            </mesh>
            {/* Glowing seams */}
            <mesh position={[0, 4, 0]}>
              <boxGeometry args={[0.82, 8, 0.82]} />
              <meshBasicMaterial
                color="#ff00ff"
                wireframe
                transparent
                opacity={0.1}
              />
            </mesh>

            {/* Floating rings around pillar */}
            <mesh
              name="ring1"
              position={[0, 6, 0]}
              rotation={[Math.PI / 2, 0.2, 0]}
            >
              <torusGeometry args={[1.5, 0.05, 8, 4]} />
              <meshBasicMaterial color="#00ffff" toneMapped={false} />
            </mesh>
            <mesh
              name="ring2"
              position={[0, 3, 0]}
              rotation={[Math.PI / 2, -0.2, 0]}
            >
              <torusGeometry args={[1.8, 0.05, 8, 4]} />
              <meshBasicMaterial color="#ff00ff" toneMapped={false} />
            </mesh>

            {/* HoloTape attached to pillar */}
            <HoloTape
              position={[0, 5, 1.5]}
              color={i % 2 === 0 ? "#ff00ff" : "#00ffff"}
              label={`SERVER_NODE_${i}`}
            />

            {/* Giant TV on every other pillar */}
            {i % 2 === 0 && (
              <GiantTV position={[0, 3, -1.2]} rotation={[0, Math.PI, 0]} />
            )}
          </group>
        );
      })}
    </group>
  );
}

function ArenaCrowds() {
  return (
    <group>
      {/* 6 arc-shaped balcony platforms around the arena (large gaps) */}
      {Array.from({ length: 6 }).map((_, arcIndex) => {
        const rand = (seed: number) => {
          const x = Math.sin(seed * 9999.123) * 43758.5453123;
          return x - Math.floor(x);
        };

        const slices = 6;
        const full = Math.PI * 2;
        const gap = 0.7; // generous gaps
        const sliceAngle = full / slices;
        const arcSpan = sliceAngle - gap;
        const startAngle = arcIndex * sliceAngle + gap * 0.5;

        const platformInner = 18.0;
        const platformOuter = 24.0;
        const platformTopY = 2.8;
        const platformThickness = 0.45;

        const parapetRadius = platformInner + 0.15;
        const parapetHeight = 0.55;
        const parapetY = platformTopY + parapetHeight * 0.5 + 0.04;

        // Spectators stand on the platform, behind the parapet (slightly outward)
        const crowdMinR = parapetRadius + 0.9;
        const crowdMaxR = platformOuter - 0.8;
        const crowdCount = 16;
        const crowdBaseY = platformTopY + 0.55;

        return (
          <group key={`arc${arcIndex}`}>
            {/* Platform top */}
            <mesh
              position={[0, platformTopY, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
            >
              <ringGeometry
                args={[
                  platformInner,
                  platformOuter,
                  110,
                  1,
                  startAngle,
                  arcSpan,
                ]}
              />
              <meshStandardMaterial
                color="#1a1a2a"
                roughness={0.75}
                metalness={0.35}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* Platform thickness/skirt */}
            <mesh position={[0, platformTopY - platformThickness * 0.5, 0]}>
              <cylinderGeometry
                args={[
                  platformOuter,
                  platformOuter,
                  platformThickness,
                  110,
                  1,
                  true,
                  startAngle,
                  arcSpan,
                ]}
              />
              <meshStandardMaterial
                color="#101022"
                roughness={0.85}
                metalness={0.35}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* Random spectators on top of platform */}
            {Array.from({ length: crowdCount }).map((_, personIndex) => {
              const seed = arcIndex * 1000 + personIndex * 17;
              const a = startAngle + rand(seed + 1) * arcSpan;
              const r = crowdMinR + rand(seed + 2) * (crowdMaxR - crowdMinR);

              const x = Math.cos(a) * r;
              const z = Math.sin(a) * r;
              const yaw = -(a + Math.PI / 2);

              const bodyH = 0.78 + rand(seed + 3) * 0.28;
              const bodyW = 0.42 + rand(seed + 4) * 0.18;
              const headSize = 0.26 + rand(seed + 5) * 0.14;
              const armW = 0.12;
              const legW = 0.16;
              const shoulderY = bodyH * 0.85;
              const hipY = bodyH * 0.15;
              const pose = rand(seed + 6);

              // small jitter so it doesn't look like a perfect arc grid
              const tangJitter = (rand(seed + 7) - 0.5) * 0.45;
              const radialJitter = (rand(seed + 8) - 0.5) * 0.25;
              const xj =
                x +
                Math.cos(a + Math.PI / 2) * tangJitter +
                Math.cos(a) * radialJitter;
              const zj =
                z +
                Math.sin(a + Math.PI / 2) * tangJitter +
                Math.sin(a) * radialJitter;

              return (
                <group
                  key={`p${arcIndex}_${personIndex}`}
                  position={[xj, crowdBaseY, zj]}
                  rotation={[0, yaw, 0]}
                >
                  {/* Torso */}
                  <mesh position={[0, bodyH / 2, 0]} castShadow>
                    <boxGeometry args={[bodyW, bodyH, 0.35]} />
                    <meshStandardMaterial
                      color={
                        seed % 3 === 0
                          ? "#2a4a6a"
                          : seed % 3 === 1
                          ? "#4a2a6a"
                          : "#2a6a4a"
                      }
                      emissive={seed % 2 === 0 ? "#001133" : "#110033"}
                      emissiveIntensity={0.35}
                      roughness={0.8}
                    />
                  </mesh>
                  {/* Head */}
                  <mesh position={[0, bodyH + headSize * 0.6, 0]} castShadow>
                    <sphereGeometry args={[headSize, 8, 8]} />
                    <meshStandardMaterial
                      color={
                        seed % 3 === 0
                          ? "#3a5a7a"
                          : seed % 3 === 1
                          ? "#5a3a7a"
                          : "#3a7a5a"
                      }
                      emissive={seed % 2 === 0 ? "#002255" : "#220055"}
                      emissiveIntensity={0.45}
                      roughness={0.7}
                    />
                  </mesh>
                  {/* Arms */}
                  <mesh
                    position={[-bodyW / 2 - armW / 2, shoulderY, 0]}
                    rotation={[0, 0, pose > 0.5 ? 0.35 : -0.25]}
                    castShadow
                  >
                    <boxGeometry args={[armW, 0.5, 0.15]} />
                    <meshStandardMaterial color="#1a2a4a" roughness={0.9} />
                  </mesh>
                  <mesh
                    position={[bodyW / 2 + armW / 2, shoulderY, 0]}
                    rotation={[0, 0, pose > 0.5 ? -0.35 : 0.25]}
                    castShadow
                  >
                    <boxGeometry args={[armW, 0.5, 0.15]} />
                    <meshStandardMaterial color="#1a2a4a" roughness={0.9} />
                  </mesh>
                  {/* Legs */}
                  <mesh position={[-bodyW / 4, hipY - 0.3, 0]} castShadow>
                    <boxGeometry args={[legW, 0.6, 0.18]} />
                    <meshStandardMaterial color="#0a1a2a" roughness={0.95} />
                  </mesh>
                  <mesh position={[bodyW / 4, hipY - 0.3, 0]} castShadow>
                    <boxGeometry args={[legW, 0.6, 0.18]} />
                    <meshStandardMaterial color="#0a1a2a" roughness={0.95} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function HoloJellyfish({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      groupRef.current.position.y = position[1] + Math.sin(t * 0.5) * 2;
      groupRef.current.rotation.y = t * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Bell */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial
          color="#00ffaa"
          wireframe
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Tentacles */}
      {Array.from({ length: 8 }).map((_, i) => (
        <group key={i} rotation={[0, (i / 8) * Math.PI * 2, 0]}>
          <mesh position={[1.5, -2, 0]}>
            <cylinderGeometry args={[0.05, 0.02, 4, 4]} />
            <meshBasicMaterial color="#00ffaa" transparent opacity={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function slugifySignText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashStringToUnitFloat(input: string) {
  // Deterministic, fast hash -> [0, 1]. Used to desync flicker across signs.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function visibleCharCount(text: string) {
  // GLB glyph meshes are per-visible character; spaces/punctuation shouldn't count.
  const compact = text.trim().replace(/[^a-z0-9]/gi, "");
  return Math.max(1, compact.length);
}

function NeonTextModel({
  text,
  color,
  fontFolder,
  scale = 1,
  signSeed,
}: {
  text: string;
  color: string;
  fontFolder?: string;
  scale?: number;
  signSeed?: number;
}) {
  const slug = slugifySignText(text);
  const modelPath = fontFolder
    ? `/models/neon-signs/${fontFolder}/${slug}.glb`
    : `/models/neon-signs/${slug}.glb`;
  const { scene } = useGLTF(modelPath);

  const materialsRef = useRef<THREE.ShaderMaterial[]>([]);

  const makeNeonFlickerMaterial = useCallback(
    (
      baseColor: string,
      seed: number,
      minX: number,
      maxX: number,
      chars: number
    ) => {
      const c = new THREE.Color(baseColor);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
          uTime: { value: 0 },
          uSeed: { value: seed },
          uMinX: { value: minX },
          uMaxX: { value: maxX },
          uChars: { value: Math.max(1, chars) },
        },
        vertexShader: `
        varying vec3 vLocal;
        varying vec3 vWorld;
        void main() {
          vLocal = position;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
        fragmentShader: `
        precision highp float;
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uSeed;
        uniform float uMinX;
        uniform float uMaxX;
        uniform float uChars;
        varying vec3 vLocal;
        varying vec3 vWorld;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          float t = uTime;

          // Approximate "character index" from local X across the word.
          // This allows us to flicker one character segment at a time even when
          // the model is a single mesh.
          float w = max(1e-4, (uMaxX - uMinX));
          float x01 = clamp((vLocal.x - uMinX) / w, 0.0, 0.9999);
          float chars = max(1.0, uChars);
          float charIndex = floor(x01 * chars);

          // Choose one active character per time bucket (independent per sign via uSeed).
          float bucket = floor(t * 9.0);
          float activeChar = floor(hash(vec2(bucket + uSeed * 3.1, 5.23)) * chars);
          float isActive = 1.0 - step(0.5, abs(charIndex - activeChar));

          // Randomized flicker that changes in time "buckets" so it feels erratic.
          float rSlow = noise(vec2(floor(t * 7.0) + uSeed * 13.0, 0.0));
          float rFast = noise(vec2(floor(t * 21.0) + uSeed * 19.0, 1.0));

          float slowAmp = mix(0.70, 1.20, rSlow);
          float fastAmp = mix(0.80, 1.15, rFast);

          // Micro shimmer to keep it alive even when "steady".
          float shimmer = 0.92 + 0.08 * sin(t * (8.0 + rFast * 10.0) + uSeed * 9.0);
          float flick = slowAmp * fastAmp * shimmer;

          // Rare hard dropout (transformer pop).
          float dropChance = noise(vec2(floor(t * 9.0) + uSeed * 11.0, 2.0));
          float dropout = step(0.992, dropChance);
          flick *= mix(1.0, 0.12, dropout);

          // Glitch band that affects only a slice of the mesh.
          float bandPhase = fract(vLocal.y * 0.12 + t * 2.2);
          float bandMask = smoothstep(0.08, 0.0, abs(bandPhase - 0.52));
          float bandTrig = step(0.990, noise(vec2(floor(t * 13.0) + uSeed * 7.0, 3.0)));
          flick *= mix(1.0, 0.55, bandTrig * bandMask);

          // Occasional bright pulse (wow) that is also random.
          float pulseChance = noise(vec2(floor(t * 17.0) + uSeed * 23.0, 4.0));
          float pulse = step(0.996, pulseChance);
          flick *= mix(1.0, 1.65, pulse);

          // Micro jitter noise for extra sparkle.
          float sparkle = noise(vec2(vWorld.x * 0.35 + uSeed, vWorld.y * 0.35 + t * 1.8));

          // Only the active character gets the full flicker; the rest stay mostly steady.
          float steady = 0.95 + 0.05 * sin(t * (6.0 + rSlow * 5.0) + uSeed * 2.0);
          float amp = mix(steady, flick, isActive);
          float intensity = clamp(amp * (1.05 + 0.25 * sparkle), 0.0, 1.5);

          vec3 col = uColor * intensity;
          float alpha = clamp(intensity, 0.0, 1.0);
          gl_FragColor = vec4(col * alpha, alpha);
        }
      `,
      });

      mat.toneMapped = false;
      return mat;
    },
    []
  );

  const clonedScene = useMemo(() => {
    // Dispose previous materials on re-clone.
    for (const m of materialsRef.current) m.dispose();
    materialsRef.current = [];

    const clone = scene.clone();
    let meshIndex = 0;
    const baseSeed =
      (signSeed ??
        hashStringToUnitFloat(`${fontFolder ?? ""}|${text}`) * 997.0) + 17.31;
    const chars = visibleCharCount(text);

    clone.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;

        const g = mesh.geometry as THREE.BufferGeometry | undefined;
        if (g && !g.boundingBox) g.computeBoundingBox();
        const bb = g?.boundingBox;
        const minX = bb?.min.x ?? -1;
        const maxX = bb?.max.x ?? 1;

        const seed = baseSeed + (meshIndex + 1) * 31.73;
        const mat = makeNeonFlickerMaterial(color, seed, minX, maxX, chars);
        materialsRef.current.push(mat);
        mesh.material = mat;
        mesh.castShadow = false;
        meshIndex += 1;
      }
    });
    return clone;
  }, [scene, color, makeNeonFlickerMaterial, signSeed, fontFolder, text]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (const m of materialsRef.current) {
      m.uniforms.uTime.value = t;
    }
  });

  return <primitive object={clonedScene} scale={scale} />;
}

// Preload the sign models used on buildings
[
  // Orbitron-ExtraBold
  "/models/neon-signs/Orbitron-ExtraBold/nexus.glb",
  "/models/neon-signs/Orbitron-ExtraBold/grid.glb",
  "/models/neon-signs/Orbitron-ExtraBold/cyber.glb",

  // Orbitron-Bold
  "/models/neon-signs/Orbitron-Bold/shimata.glb",
  "/models/neon-signs/Orbitron-Bold/data.glb",

  // Michroma-Regular
  "/models/neon-signs/Michroma-Regular/sector-7.glb",

  // Syncopate-Bold
  "/models/neon-signs/Syncopate-Bold/cyber.glb",
  "/models/neon-signs/Syncopate-Bold/neon.glb",
  "/models/neon-signs/Syncopate-Bold/synth.glb",

  // Neonderthaw-Regular
  "/models/neon-signs/Neonderthaw-Regular/tech.glb",
  "/models/neon-signs/Neonderthaw-Regular/parallel.glb",

  // Audiowide-Regular
  "/models/neon-signs/Audiowide-Regular/pawnsquare.glb",

  // Orbitron-SemiBold
  "/models/neon-signs/Orbitron-SemiBold/grid.glb",

  // BebasNeue-Regular
  "/models/neon-signs/BebasNeue-Regular/neon.glb",
  "/models/neon-signs/BebasNeue-Regular/nexus.glb",
  "/models/neon-signs/BebasNeue-Regular/pawnsquare.glb",
].forEach((p) => useGLTF.preload(p));

function CyberpunkBuildings() {
  const buildings = useMemo(() => {
    const localY = (h: number, fromBottom01: number) =>
      -h / 2 + fromBottom01 * h;
    return [
      // Distant mega towers
      {
        pos: [-60, 25, -70] as [number, number, number],
        size: [12, 50, 12] as [number, number, number],
        color: "#130022",
        accent: "#ff00ff",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(50, 0.86),
            text: "NEXUS",
            font: "Orbitron-ExtraBold",
            color: "#ff00ff",
            size: [8, 3] as [number, number],
          },
          {
            face: "front",
            x: 0,
            y: localY(50, 0.74),
            text: "CYBER",
            font: "Orbitron-ExtraBold",
            color: "#ff0066",
            size: [5, 1.8] as [number, number],
          },
        ],
      },
      {
        pos: [70, 30, -60] as [number, number, number],
        size: [15, 60, 15] as [number, number, number],
        color: "#001428",
        accent: "#00ffaa",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(60, 0.86),
            text: "SHIMATA",
            font: "Orbitron-Bold",
            color: "#00ff66",
            size: [10, 4] as [number, number],
          },
          {
            face: "front",
            x: -4.8,
            y: localY(60, 0.76),
            text: "DATA",
            font: "Orbitron-Bold",
            color: "#ffff00",
            size: [2.6, 6.8] as [number, number],
            rotZ: Math.PI / 2,
            scaleMul: 1.25,
          },
        ],
      },
      {
        pos: [-75, 20, 50] as [number, number, number],
        size: [10, 40, 10] as [number, number, number],
        color: "#1a1400",
        accent: "#ff3300",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(40, 0.84),
            text: "SECTOR 7",
            font: "Michroma-Regular",
            color: "#ff3300",
            size: [7, 3] as [number, number],
          },
        ],
      },
      {
        pos: [65, 35, 60] as [number, number, number],
        size: [18, 70, 18] as [number, number, number],
        color: "#0a0014",
        accent: "#00ffff",
        signs: [
          // Screenshot-style stack: GRID left, CYBER/NEON/SYNTH centered-right.
          {
            face: "front",
            x: 1.46,
            y: localY(70, 0.88),
            text: "CYBER",
            font: "Syncopate-Bold",
            color: "#00ffff",
            size: [7.6, 3.4] as [number, number],
            scaleMul: 0.72,
          },
          {
            face: "front",
            x: 1.46,
            y: localY(70, 0.79),
            text: "NEON",
            font: "Syncopate-Bold",
            color: "#ff00ff",
            size: [7.0, 3.0] as [number, number],
            scaleMul: 0.72,
          },
          {
            face: "front",
            x: 1.46,
            y: localY(70, 0.71),
            text: "SYNTH",
            font: "Syncopate-Bold",
            color: "#ff0000",
            size: [5.4, 2.0] as [number, number],
            rotZ: 0.02,
            scaleMul: 0.76,
          },
        ],
      },
      {
        pos: [0, 28, -80] as [number, number, number],
        size: [20, 56, 20] as [number, number, number],
        color: "#001616",
        accent: "#0099ff",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(56, 0.86),
            text: "TECH",
            font: "Neonderthaw-Regular",
            color: "#0099ff",
            size: [14, 4] as [number, number],
          },
          {
            face: "front",
            x: 0,
            y: localY(56, 0.75),
            text: "PARALLEL",
            font: "Neonderthaw-Regular",
            color: "#ff9900",
            size: [12, 3] as [number, number],
            rotZ: -0.08,
            scaleMul: 1.15,
          },
        ],
      },
      {
        pos: [-80, 22, -50] as [number, number, number],
        size: [11, 44, 11] as [number, number, number],
        color: "#160000",
        accent: "#ff0066",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(44, 0.86),
            text: "PAWNSQUARE",
            font: "Audiowide-Regular",
            color: "#ff0066",
            size: [8.5, 3.2] as [number, number],
            scaleMul: 1.05,
          },
        ],
      },
      {
        pos: [80, 26, 40] as [number, number, number],
        size: [13, 52, 13] as [number, number, number],
        color: "#000a14",
        accent: "#66ff00",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(52, 0.86),
            text: "GRID",
            font: "Orbitron-SemiBold",
            color: "#66ff00",
            size: [4.5, 1.75] as [number, number],
          },
        ],
      },
      // Smaller mid-distance buildings
      {
        pos: [-45, 12, -50] as [number, number, number],
        size: [8, 24, 8] as [number, number, number],
        color: "#0a0a16",
        accent: "#ff00ff",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(24, 0.86),
            text: "NEON",
            font: "BebasNeue-Regular",
            color: "#ff00ff",
            size: [5, 2] as [number, number],
          },
        ],
      },
      {
        pos: [50, 15, -45] as [number, number, number],
        size: [9, 30, 9] as [number, number, number],
        color: "#160a0a",
        accent: "#00ffff",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(30, 0.86),
            text: "NEXUS",
            font: "BebasNeue-Regular",
            color: "#00ffff",
            size: [6, 2.5] as [number, number],
          },
        ],
      },
      {
        pos: [-55, 18, 45] as [number, number, number],
        size: [10, 36, 10] as [number, number, number],
        color: "#0a160a",
        accent: "#ffff00",
        signs: [
          {
            face: "front",
            x: 0,
            y: localY(36, 0.86),
            text: "PAWNSQUARE",
            font: "BebasNeue-Regular",
            color: "#ffff00",
            size: [7.5, 3.1] as [number, number],
            scaleMul: 1.05,
          },
        ],
      },
    ];
  }, []);

  const rand01 = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  const signTextScaleFactor = (text: string, font?: string) => {
    // Keep long words from overflowing panels.
    // Aggressive falloff so things like PAWNSQUARE / PARALLEL become much smaller.
    const normalized = text.trim().replace(/\s+/g, " ");
    const compact = normalized.replace(/[^a-z0-9]/gi, "");
    const spaces = (normalized.match(/ /g) ?? []).length;
    const effectiveLen = Math.max(1, compact.length + spaces * 3);

    // tuned by eye: 4-5 chars is our "base" size; longer shrinks *very* fast
    const target = 4.2;
    const ratio = target / effectiveLen;
    const falloff = Math.pow(ratio, 2.3);
    const base = Math.min(1, falloff);

    // Script fonts tend to have very wide glyph bounds.
    const fontMul = font?.includes("Neonderthaw") ? 0.35 : 1;

    return Math.max(0.08, base * fontMul);
  };

  const faceTransform = (
    face: "front" | "back" | "left" | "right",
    w: number,
    d: number
  ) => {
    const pad = 0.14;
    switch (face) {
      case "front":
        return {
          pos: [0, 0, d / 2 + pad] as [number, number, number],
          rotY: 0,
        };
      case "back":
        return {
          pos: [0, 0, -d / 2 - pad] as [number, number, number],
          rotY: Math.PI,
        };
      case "left":
        return {
          pos: [-w / 2 - pad, 0, 0] as [number, number, number],
          rotY: -Math.PI / 2,
        };
      case "right":
        return {
          pos: [w / 2 + pad, 0, 0] as [number, number, number],
          rotY: Math.PI / 2,
        };
    }
  };

  return (
    <group>
      {buildings.map((building: any, i) => {
        // Face roughly toward the origin (player area) with a little jitter.
        const px = building.pos[0] as number;
        const pz = building.pos[2] as number;
        const faceOriginYaw = Math.atan2(-px, -pz);
        const jitter = (rand01(i * 101 + 7) - 0.5) * 0.9;
        const yaw = faceOriginYaw + jitter;

        const [bw, bh, bd] = building.size as [number, number, number];
        const variant = i % 6;

        const shellMat = (
          <meshStandardMaterial
            color={building.color}
            roughness={0.75}
            metalness={0.35}
          />
        );

        return (
          <group key={i} position={building.pos} rotation={[0, yaw, 0]}>
            {/* Building tower (varied silhouettes) */}
            {variant === 0 && (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[bw, bh, bd]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[bw * 0.15, bh * 0.18, bd * 0.12]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.62, bh * 0.38, bd * 0.62]} />
                  {shellMat}
                </mesh>
                <mesh position={[0, bh / 2 - 1.8, 0]} castShadow receiveShadow>
                  <boxGeometry args={[bw * 0.58, 3.6, bd * 0.58]} />
                  {shellMat}
                </mesh>
              </>
            )}
            {variant === 1 && (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[bw, bh, bd]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[0, -bh * 0.05, bd * 0.34]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.82, bh * 0.35, bd * 0.28]} />
                  {shellMat}
                </mesh>
                <mesh position={[0, bh / 2 + 1.8, 0]}>
                  <cylinderGeometry args={[0.12, 0.18, 3.6, 8]} />
                  <meshBasicMaterial
                    color={building.accent}
                    transparent
                    opacity={0.75}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              </>
            )}
            {variant === 2 && (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[bw, bh * 0.7, bd]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[bw * -0.08, bh * 0.1, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.78, bh * 0.38, bd * 0.78]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[bw * 0.05, bh * 0.32, bd * -0.06]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.56, bh * 0.28, bd * 0.56]} />
                  {shellMat}
                </mesh>
              </>
            )}
            {variant === 3 && (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[bw, bh, bd]} />
                  {shellMat}
                </mesh>
                <mesh position={[bw / 2 + 0.35, 0, 0]} castShadow receiveShadow>
                  <boxGeometry args={[0.7, bh * 0.8, bd * 0.22]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[-bw / 2 - 0.35, 0, 0]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[0.7, bh * 0.75, bd * 0.18]} />
                  {shellMat}
                </mesh>
                <mesh position={[0, bh / 2 - 2.0, 0]} castShadow receiveShadow>
                  <boxGeometry args={[bw * 0.7, 4, bd * 0.7]} />
                  {shellMat}
                </mesh>
              </>
            )}

            {variant === 4 && (
              <>
                {/* Jagged stepped tower */}
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[bw, bh, bd]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[bw * 0.18, bh * 0.08, bd * -0.12]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.62, bh * 0.38, bd * 0.62]} />
                  {shellMat}
                </mesh>
                <mesh
                  position={[bw * -0.12, bh * 0.24, bd * 0.18]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.46, bh * 0.26, bd * 0.46]} />
                  {shellMat}
                </mesh>
                {/* Slanted cap */}
                <mesh
                  position={[0, bh / 2 - 2.2, 0]}
                  rotation={[0, 0, 0.18]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[bw * 0.7, 3.0, bd * 0.7]} />
                  {shellMat}
                </mesh>
              </>
            )}

            {variant === 5 && (
              <>
                {/* Jagged fin tower */}
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[bw, bh, bd]} />
                  {shellMat}
                </mesh>
                <mesh position={[0, bh * 0.18, 0]} castShadow receiveShadow>
                  <boxGeometry args={[bw * 0.7, bh * 0.4, bd * 0.7]} />
                  {shellMat}
                </mesh>
                {(
                  [
                    { x: bw / 2 + 0.18, z: 0, h: bh * 0.85 },
                    { x: -bw / 2 - 0.18, z: bd * 0.1, h: bh * 0.7 },
                    { x: bw * 0.15, z: bd / 2 + 0.18, h: bh * 0.65 },
                  ] as Array<{ x: number; z: number; h: number }>
                ).map((f, idx) => (
                  <mesh
                    key={`fin_${idx}`}
                    position={[f.x, 0, f.z]}
                    castShadow
                    receiveShadow
                  >
                    <boxGeometry args={[0.22, f.h, 0.32]} />
                    {shellMat}
                  </mesh>
                ))}
              </>
            )}

            {/* Neon edge trims (fake neon) */}
            {(
              [
                [bw / 2 + 0.06, 0, bd / 2 + 0.06],
                [-bw / 2 - 0.06, 0, bd / 2 + 0.06],
                [bw / 2 + 0.06, 0, -bd / 2 - 0.06],
                [-bw / 2 - 0.06, 0, -bd / 2 - 0.06],
              ] as Array<[number, number, number]>
            ).map((p, idx) => (
              <mesh key={`trim_${idx}`} position={p}>
                <boxGeometry args={[0.08, bh * 0.95, 0.08]} />
                <meshBasicMaterial
                  color={building.accent}
                  transparent
                  opacity={0.55}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ))}

            {(() => {
              // Facade-takeover holo ads.
              // Every building becomes a full "media skin"; tiny dot-windows stay underneath for sparkle.
              const r0 = rand01(i * 917 + 3);
              const r1 = rand01(i * 917 + 11);
              const r2 = rand01(i * 917 + 29);

              const hasFacadeAd = true;
              const addSide = r0 > 0.52;

              const pPick = rand01(i * 1009 + 101);
              const sPick = rand01(i * 1009 + 131);
              const primary =
                pPick > 0.78
                  ? building.accent
                  : pPick > 0.56
                  ? "#00ffff"
                  : pPick > 0.33
                  ? "#ff00ff"
                  : "#66ff00";
              const secondary =
                sPick > 0.7 ? "#0099ff" : sPick > 0.46 ? "#ffaa00" : "#ff0066";

              const bigSeed = i * 1337 + 17;
              const sideSeed = i * 1337 + 114;

              const frontFace = faceTransform("front", bw, bd);
              const sideFace = faceTransform(
                r1 > 0.5 ? "right" : "left",
                bw,
                bd
              );

              // Overscan the facade slightly so there are no blank edge strips.
              // (We float the panel off the surface, so a bit of oversize looks good.)
              const fw = Math.max(2.5, bw * 1.04);
              const fh = Math.max(6, bh * 1.04);

              // Side panel: overscan but keep narrower than front.
              const sw = Math.max(2.2, (r2 > 0.55 ? bd : bw) * 0.86);
              const sh = Math.max(5.5, bh * 0.98);

              return (
                <>
                  {/* Tiny facade dots underneath (keeps building texture even with full ads) */}
                  <group position={[0, 0, bd / 2 + 0.021]}>
                    <WindowPanel
                      width={Math.max(2.5, bw * 0.92)}
                      height={Math.max(6, bh * 0.92)}
                      seed={i * 97 + 13}
                      accent={building.accent}
                    />
                  </group>

                  {hasFacadeAd && (
                    <>
                      <group position={[0, 0, 0]}>
                        <group
                          position={frontFace.pos}
                          rotation={[0, frontFace.rotY, 0]}
                        >
                          <mesh position={[0, 0, -0.06]}>
                            <planeGeometry args={[fw * 1.03, fh * 1.03]} />
                            <meshBasicMaterial
                              color="#000000"
                              transparent
                              opacity={0.42}
                            />
                          </mesh>
                          <group position={[0, 0, 0.02]}>
                            <HoloAdPanel
                              width={fw}
                              height={fh}
                              seed={bigSeed}
                              primary={primary}
                              secondary={secondary}
                            />
                          </group>
                        </group>
                      </group>

                      {addSide && (
                        <group position={[0, 0, 0]}>
                          <group
                            position={sideFace.pos}
                            rotation={[0, sideFace.rotY, 0]}
                          >
                            <mesh position={[0, 0, -0.06]}>
                              <planeGeometry args={[sw * 1.03, sh * 1.03]} />
                              <meshBasicMaterial
                                color="#000000"
                                transparent
                                opacity={0.36}
                              />
                            </mesh>
                            <group position={[0, 0, 0.02]}>
                              <HoloAdPanel
                                width={sw}
                                height={sh}
                                seed={sideSeed}
                                primary={secondary}
                                secondary={primary}
                              />
                            </group>
                          </group>
                        </group>
                      )}
                    </>
                  )}
                </>
              );
            })()}

            {/* Neon signs */}
            {building.signs.map((sign: any, si: number) => {
              const face = faceTransform(sign.face, bw, bd);
              const scaleFactor = sign.text
                ? signTextScaleFactor(sign.text, sign.font)
                : 1;
              const scaleMul = (sign.scaleMul ?? 1) as number;

              const normalized =
                typeof sign.text === "string"
                  ? sign.text.trim().replace(/\s+/g, " ")
                  : "";
              const compactLen = normalized.replace(/[^a-z0-9]/gi, "").length;
              const isWidePanel =
                Array.isArray(sign.size) &&
                typeof sign.size[0] === "number" &&
                typeof sign.size[1] === "number" &&
                sign.size[0] >= sign.size[1] * 1.35;
              const autoRotate =
                !!normalized &&
                sign.rotZ == null &&
                sign.autoRotate !== false &&
                compactLen >= 9 &&
                isWidePanel;

              const rotZ = (sign.rotZ ??
                (autoRotate ? Math.PI / 2 : 0)) as number;
              const rotNorm =
                ((rotZ % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
              const rot90 =
                Math.abs(rotNorm - Math.PI / 2) < 0.01 ||
                Math.abs(rotNorm - (3 * Math.PI) / 2) < 0.01;
              const panelSize = rot90
                ? ([sign.size[1], sign.size[0]] as [number, number])
                : (sign.size as [number, number]);

              const effectiveScaleMul = scaleMul * (autoRotate ? 1.12 : 1);

              // Keep signs from spilling past the building silhouette (most noticeable on the front face).
              const margin = 0.35;
              const maxX = Math.max(0, bw / 2 - panelSize[0] / 2 - margin);
              const desiredXBase = (sign.x ?? 0) as number;
              const desiredX =
                rot90 && Math.abs(desiredXBase) < 1e-6 ? -maxX : desiredXBase;
              const clampedX = Math.max(-maxX, Math.min(maxX, desiredX));

              const signSeed =
                (i + 1) * 1000 +
                (si + 1) * 97 +
                hashStringToUnitFloat(`${sign.font ?? ""}|${sign.text ?? ""}`) *
                  911;

              return (
                <group key={si} position={[clampedX, sign.y ?? 0, 0]}>
                  <group position={face.pos} rotation={[0, face.rotY, 0]}>
                    <group rotation={[0, 0, rotZ]}>
                      {/* Background panel */}
                      <mesh position={[0, 0, -0.08]}>
                        <planeGeometry args={panelSize} />
                        <meshBasicMaterial
                          color="#000000"
                          transparent
                          opacity={0.7}
                        />
                      </mesh>
                      {/* 3D Neon Text Model */}
                      {sign.text && (
                        <group position={[0, 0, 0.02]}>
                          <NeonTextModel
                            text={sign.text}
                            color={sign.color}
                            fontFolder={sign.font}
                            scale={
                              panelSize[1] *
                              0.2 *
                              10 *
                              scaleFactor *
                              effectiveScaleMul
                            }
                            signSeed={signSeed}
                          />
                        </group>
                      )}
                      {/* Extra glow effect */}
                    </group>
                  </group>
                </group>
              );
            })}

            {/* Extra cyberpunk linework on the front face (cheap, adds density) */}
            {(
              [
                {
                  y: -bh / 2 + bh * 0.16,
                  w: bw * 0.95,
                  h: 0.12,
                  c: building.accent,
                },
                { y: -bh / 2 + bh * 0.28, w: bw * 0.85, h: 0.1, c: "#00ffff" },
                { y: -bh / 2 + bh * 0.4, w: bw * 0.75, h: 0.1, c: "#ff00ff" },
              ] as Array<{ y: number; w: number; h: number; c: string }>
            ).map((s, idx) => (
              <group key={`line_${idx}`} position={[0, s.y, bd / 2 + 0.06]}>
                <mesh>
                  <boxGeometry args={[s.w, s.h, 0.06]} />
                  <meshBasicMaterial
                    color={s.c}
                    transparent
                    opacity={0.35}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}

      {/* Sky-bridges between tall towers (world-space; not nested in a building transform) */}
      {(
        [
          { a: 0, b: 4, drop: 11, w: 4.0, h: 1.7, c: "#050010", n: "#00ffff" },
          { a: 1, b: 4, drop: 15, w: 3.6, h: 1.5, c: "#120006", n: "#ff00ff" },
        ] as Array<{
          a: number;
          b: number;
          drop: number;
          w: number;
          h: number;
          c: string;
          n: string;
        }>
      ).map((br, bi) => {
        const A = buildings[br.a];
        const B = buildings[br.b];
        if (!A || !B) return null;

        const ax = A.pos[0] as number;
        const ay = A.pos[1] as number;
        const az = A.pos[2] as number;
        const bx = B.pos[0] as number;
        const by = B.pos[1] as number;
        const bz = B.pos[2] as number;

        const ah = (A.size?.[1] as number) ?? 40;
        const bh2 = (B.size?.[1] as number) ?? 40;
        const aw = (A.size?.[0] as number) ?? 10;
        const bw2 = (B.size?.[0] as number) ?? 10;

        const topA = ay + ah / 2;
        const topB = by + bh2 / 2;
        const y = Math.min(topA, topB) - br.drop;

        const dx = bx - ax;
        const dz = bz - az;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 1e-3) return null;
        const yaw = Math.atan2(dx, dz);

        // Shorten by half widths so the bridge reaches the facades.
        const len = Math.max(8, dist - (aw / 2 + bw2 / 2) * 1.05);
        const px = (ax + bx) / 2;
        const pz = (az + bz) / 2;

        return (
          <group
            key={`bridge_${bi}`}
            position={[px, y, pz]}
            rotation={[0, yaw, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[br.w, br.h, len]} />
              <meshStandardMaterial
                color={br.c}
                roughness={0.85}
                metalness={0.35}
              />
            </mesh>
            {/* Neon rails */}
            <mesh position={[br.w / 2 + 0.08, br.h / 2 + 0.08, 0]}>
              <boxGeometry args={[0.12, 0.16, len * 0.98]} />
              <meshBasicMaterial
                color={br.n}
                transparent
                opacity={0.55}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[-br.w / 2 - 0.08, br.h / 2 + 0.08, 0]}>
              <boxGeometry args={[0.12, 0.16, len * 0.98]} />
              <meshBasicMaterial
                color={br.n}
                transparent
                opacity={0.55}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function SciFiLobby({
  leaderboard,
  showLeaderboardWall = true,
}: {
  leaderboard?: LeaderboardEntry[];
  showLeaderboardWall?: boolean;
}) {
  return (
    <>
      {/* Cyberpunk lighting: Darker ambient, strong colored rims */}
      <ambientLight intensity={0.4} color="#2a0a4a" />
      <hemisphereLight intensity={0.6} color="#4a00ff" groundColor="#000000" />

      {/* Strong overhead spotlights */}
      <directionalLight
        intensity={1.5}
        position={[0, 25, 0]}
        color="#aaccff"
        castShadow
      />
      <directionalLight
        intensity={2.0}
        position={[15, 10, 10]}
        color="#00ffff"
      />
      <directionalLight
        intensity={2.0}
        position={[-15, 10, -10]}
        color="#ff00ff"
      />

      {/* Arena spot lights */}
      <spotLight
        position={[0, 18, 0]}
        angle={Math.PI / 3}
        penumbra={0.5}
        intensity={2}
        color="#ffffff"
        distance={40}
        castShadow
      />

      <SciFiSky />
      <Stars
        radius={100}
        depth={50}
        count={1600}
        factor={4}
        saturation={0}
        fade
        speed={1}
      />
      <SciFiFloor />
      {/* ArenaCrowds removed */}
      <SciFiPlanters />
      <SciFiDecorations />

      {/* BETA sign (theme under construction) */}
      <group position={[0, 7.5, 9]}>
        <Billboard follow>
          <mesh position={[0, 0, -0.05]}>
            <planeGeometry args={[10, 3.2]} />
            <meshBasicMaterial
              color="#000000"
              transparent
              opacity={0.55}
              depthWrite={false}
            />
          </mesh>
          <Text
            fontSize={1.2}
            color="#ffff00"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.08}
            outlineColor="#ffff00"
            outlineOpacity={0.7}
          >
            BETA
          </Text>
          <Text
            position={[0, -1.05, 0]}
            fontSize={0.42}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            maxWidth={9}
            lineHeight={1.1}
          >
            UNDER CONSTRUCTION
          </Text>
        </Billboard>
      </group>

      {/* Blimps with Ads */}
      <Blimp
        position={[0, 18, -40]}
        text="CYBER"
        color="#00ffff"
        range={60}
        speed={0.04}
      />
      <Blimp
        position={[0, 22, 35]}
        text="SHIMATA"
        color="#ff00ff"
        range={65}
        speed={0.03}
      />

      {/* Cyberpunk Mega Buildings (LOD) */}
      <CyberpunkBuildings />

      {/* Distant flying cars (light streaks) */}
      {(
        [
          {
            a: [-92, 0, -40] as [number, number, number],
            b: [78, 0, 58] as [number, number, number],
            y: 40,
            c: "#00ffff",
            s: 0.05,
            seed: 0.12,
          },
          {
            a: [85, 0, -10] as [number, number, number],
            b: [-70, 0, 70] as [number, number, number],
            y: 36,
            c: "#ff00ff",
            s: 0.06,
            seed: 0.33,
          },
          {
            a: [-88, 0, -75] as [number, number, number],
            b: [65, 0, -55] as [number, number, number],
            y: 44,
            c: "#66ff00",
            s: 0.045,
            seed: 0.58,
          },
          {
            a: [95, 0, 20] as [number, number, number],
            b: [-60, 0, -70] as [number, number, number],
            y: 42,
            c: "#ffaa00",
            s: 0.04,
            seed: 0.81,
          },
        ] as Array<{
          a: [number, number, number];
          b: [number, number, number];
          y: number;
          c: string;
          s: number;
          seed: number;
        }>
      ).map((r, idx) => (
        <FlyingCar
          key={`car_${idx}`}
          a={r.a}
          b={r.b}
          y={r.y}
          color={r.c}
          speed={r.s}
          seed={r.seed}
        />
      ))}

      {/* Holographic Jellyfish */}
      <HoloJellyfish position={[20, 15, -20]} />
      <HoloJellyfish position={[-20, 20, 20]} />

      {/* Wall enclosures (north/south) for future credits/leaderboard */}
      <group position={[0, 0, 14]}>
        <mesh position={[0, 0.6, 3]} castShadow receiveShadow>
          <boxGeometry args={[36, 1.2, 1]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>

        {/* Leaderboard display mounted to the north back wall */}
        {showLeaderboardWall ? (
          <group position={[0, 0, 2.2]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 2.8, 0]} castShadow receiveShadow>
              <boxGeometry args={[4.8, 5.6, 0.25]} />
              <SciFiWallMaterial
                color="#0b0b12"
                roughness={0.55}
                metalness={0.75}
              />
            </mesh>

            <Text
              position={[0, 5.25, 0.16]}
              fontSize={0.52}
              font="/fonts/Orbitron-ExtraBold.ttf"
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
            >
              LEADERBOARD
            </Text>

            {(leaderboard ?? []).slice(0, 10).map((e, idx) => {
              const minutes = Math.max(1, Math.round(e.playMs / 60000));
              const line = `${idx + 1}. ${e.name}  ${
                e.moves
              }m  ${minutes}min  ${(e.score ?? 0).toFixed(2)}`;
              return (
                <Text
                  key={e.id}
                  position={[-2.25, 4.65 - idx * 0.38, 0.16]}
                  fontSize={0.26}
                  font="/fonts/Orbitron-Regular.ttf"
                  color="#ffffff"
                  anchorX="left"
                  anchorY="middle"
                  maxWidth={4.4}
                >
                  {line}
                </Text>
              );
            })}
          </group>
        ) : null}

        {/* TV wall panels (north): 2 screens */}
        <mesh position={[-6, 2.8, 2.2]} castShadow receiveShadow>
          <boxGeometry args={[4.8, 5.6, 0.25]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        <mesh position={[6, 2.8, 2.2]} castShadow receiveShadow>
          <boxGeometry args={[4.8, 5.6, 0.25]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        <mesh position={[-17.5, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[1, 1.2, 6]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        <mesh position={[17.5, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[1, 1.2, 6]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
      </group>

      <group position={[0, 0, -14]}>
        <mesh position={[0, 0.6, -3]} castShadow receiveShadow>
          <boxGeometry args={[36, 1.2, 1]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>

        {/* TV wall panels (south): 2 screens */}
        <mesh position={[-6, 2.8, -2.2]} castShadow receiveShadow>
          <boxGeometry args={[4.8, 5.6, 0.25]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        <mesh position={[6, 2.8, -2.2]} castShadow receiveShadow>
          <boxGeometry args={[4.8, 5.6, 0.25]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        <mesh position={[-17.5, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[1, 1.2, 6]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        <mesh position={[17.5, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[1, 1.2, 6]} />
          <SciFiWallMaterial
            color="#0b0b12"
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
      </group>

      <fog attach="fog" args={["#050010", 20, 90]} />
    </>
  );
}

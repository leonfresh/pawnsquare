"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

function getBoardPalette(boardTheme: string) {
  switch (boardTheme) {
    case "board_marble":
      return {
        kind: "marble" as const,
        light: "#d9d9df",
        dark: "#3a3a44",
        base: "#2b2b33",
      };
    case "board_neon":
      return {
        kind: "neon" as const,
        light: "#1f5561",
        dark: "#070a10",
        base: "#07101c",
      };
    case "board_walnut":
      return {
        kind: "wood" as const,
        light: "#c7a07a",
        dark: "#5a2d13",
        base: "#2a1b12",
      };
    default:
      return {
        kind: "wood" as const,
        light: "#deb887",
        dark: "#8b4513",
        base: "#2a1b12",
      };
  }
}

function WoodGrainMaterial({
  color,
  roughness = 0.75,
  metalness = 0.08,
}: {
  color: string;
  roughness?: number;
  metalness?: number;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);

  useEffect(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uBase.value = base;
  }, [base]);

  return (
    <shaderMaterial
      ref={matRef}
      uniforms={{
        uBase: { value: base },
        uRoughness: { value: roughness },
        uMetalness: { value: metalness },
      }}
      vertexShader={`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `}
      fragmentShader={`
        varying vec2 vUv;
        uniform vec3 uBase;
        uniform float uRoughness;
        uniform float uMetalness;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float f = 0.0;
          f += 0.5000 * noise(p); p *= 2.02;
          f += 0.2500 * noise(p); p *= 2.03;
          f += 0.1250 * noise(p); p *= 2.01;
          f += 0.0625 * noise(p);
          return f;
        }

        void main() {
          // Simple wood-like grain: stretched noise + rings
          vec2 uv = vUv;
          vec2 p = uv * vec2(1.0, 10.0);
          float grain = fbm(p);
          float rings = noise(uv * 3.0 + grain * 0.35);
          float pattern = smoothstep(0.22, 0.82, grain * 0.7 + rings * 0.3);

          vec3 darkGrain = uBase * 0.78;
          vec3 lightGrain = uBase * 1.12;
          vec3 col = mix(darkGrain, lightGrain, pattern);

          // Approximate a PBR-ish response without full lighting.
          // Keep it simple: slight vignette + fake spec.
          float v = smoothstep(0.9, 0.2, length(uv - 0.5));
          col *= (0.85 + 0.15 * v);

          gl_FragColor = vec4(col, 1.0);
        }
      `}
    />
  );
}

function MarblePreviewMaterial({ color }: { color: string }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);

  useEffect(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uBase.value = base;
  }, [base]);

  return (
    <shaderMaterial
      ref={matRef}
      uniforms={{
        uBase: { value: base },
      }}
      vertexShader={`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `}
      fragmentShader={`
        varying vec2 vUv;
        uniform vec3 uBase;

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
        float fbm(vec2 p) {
          float f = 0.0;
          f += 0.5000 * noise2(p); p *= 2.02;
          f += 0.2500 * noise2(p); p *= 2.03;
          f += 0.1250 * noise2(p); p *= 2.01;
          f += 0.0625 * noise2(p);
          return f;
        }

        void main() {
          vec2 p = vUv * vec2(2.0, 2.0);
          float n = fbm(p * 2.0);
          float n2 = fbm(p * 5.0 + vec2(1.2, -3.4));
          float flow = sin((p.x + p.y) * 6.0 + n * 8.0);
          float veins = smoothstep(0.65, 0.92, abs(flow)) * smoothstep(0.25, 0.8, n2);

          vec3 col = mix(uBase * 0.82, uBase * 1.08, n);
          col = mix(col, vec3(1.0), veins * 0.22);

          gl_FragColor = vec4(col, 1.0);
        }
      `}
    />
  );
}

function NeonPreviewMaterial({
  color,
  parity,
}: {
  color: string;
  parity: number;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const neon = useMemo(() => new THREE.Color("#4be7ff"), []);
  const neonAlt = useMemo(() => new THREE.Color("#ff4bd8"), []);

  useFrame(({ clock }) => {
    if (matRef.current)
      matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  useEffect(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uBase.value = base;
  }, [base]);

  useEffect(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uParity.value = parity;
  }, [parity]);

  return (
    <shaderMaterial
      ref={matRef}
      uniforms={{
        uTime: { value: 0 },
        uBase: { value: base },
        uNeon: { value: neon },
        uNeonAlt: { value: neonAlt },
        uParity: { value: parity },
      }}
      vertexShader={`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `}
      fragmentShader={`
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uBase;
        uniform vec3 uNeon;
        uniform vec3 uNeonAlt;
        uniform float uParity;

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

        void main() {
          // Dark "circuit panel" style (no scanline/sweep).
          vec2 uv = vUv;
          vec2 p = uv * 10.0;

          vec2 cell = abs(fract(p) - 0.5);
          float grid = 1.0 - smoothstep(0.492, 0.5, min(cell.x, cell.y));

          float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
          float borderLine = 1.0 - smoothstep(0.045, 0.070, edge);

          float grime = fbm2(uv * 7.0);
          float pulse = 0.82 + 0.18 * sin(uTime * 1.10 + (p.x + p.y) * 0.65);

          float s0 = panelSeams(uv * 6.0, vec2(1.8, 1.8));
          float s1 = panelSeams(uv * 6.0 + vec2(0.55, 0.8), vec2(4.6, 4.6));
          float seams = clamp(s0 * 0.9 + s1 * 0.35, 0.0, 1.0);

          float n = fbm2(uv * 14.0 + vec2(2.3, -1.7));
          float traces = smoothstep(0.70, 0.86, n) * 0.55;

          vec3 neonCol = mix(uNeon, uNeonAlt, clamp(uParity, 0.0, 1.0));

          float baseLum = dot(uBase, vec3(0.299, 0.587, 0.114));
          float baseMul = mix(0.28, 0.52, smoothstep(0.08, 0.34, baseLum));

          vec3 col = uBase * baseMul;
          col *= mix(0.92, 1.03, grime);
          float dataPulse = smoothstep(0.92, 1.0, abs(sin((uv.x + uv.y) * 18.0 + uTime * 1.6 + n * 4.0)));
          col += neonCol * (borderLine * 0.085 + grid * 0.040 + traces * 0.035) * pulse;
          col += neonCol * (seams * 0.020) * (0.85 + 0.15 * grime);
          col += neonCol * (dataPulse * 0.012) * (0.8 + 0.2 * pulse);

          gl_FragColor = vec4(col, 1.0);
        }
      `}
    />
  );
}

function CameraResetOnThemeChange({
  boardTheme,
  controlsRef,
  target = [0, 0.02, 0],
}: {
  boardTheme: string;
  controlsRef: React.MutableRefObject<any>;
  target?: [number, number, number];
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0.95, 3.1);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
      if (typeof controls.saveState === "function") controls.saveState();
    }
  }, [boardTheme, camera, controlsRef, target]);
  return null;
}

function BoardPatch({ boardTheme }: { boardTheme: string }) {
  const p = useMemo(() => getBoardPalette(boardTheme), [boardTheme]);
  const squareSize = 0.55;

  return (
    <group>
      <mesh position={[0, -0.06, 0]} receiveShadow castShadow>
        <boxGeometry args={[squareSize * 2.15, 0.08, squareSize * 2.15]} />
        {p.kind === "neon" ? (
          <meshStandardMaterial
            color={p.base}
            roughness={0.25}
            metalness={0.65}
            emissive={"#07101c"}
            emissiveIntensity={0.12}
          />
        ) : (
          <meshStandardMaterial
            color={p.base}
            roughness={0.6}
            metalness={0.25}
          />
        )}
      </mesh>

      {Array.from({ length: 4 }).map((_, idx) => {
        const x = (idx % 2) - 0.5;
        const z = Math.floor(idx / 2) - 0.5;
        const isDark = idx % 2 ^ Math.floor(idx / 2) % 2;
        return (
          <mesh
            key={idx}
            position={[x * squareSize, 0, z * squareSize]}
            receiveShadow
            castShadow
          >
            <boxGeometry args={[squareSize, 0.08, squareSize]} />
            {p.kind === "wood" ? (
              <WoodGrainMaterial color={isDark ? p.dark : p.light} />
            ) : p.kind === "marble" ? (
              <MarblePreviewMaterial color={isDark ? p.dark : p.light} />
            ) : (
              <NeonPreviewMaterial
                color={isDark ? p.dark : p.light}
                parity={isDark ? 1 : 0}
              />
            )}
          </mesh>
        );
      })}
    </group>
  );
}

export function ChessBoardPreview({ boardTheme }: { boardTheme: string }) {
  const [autoRotate, setAutoRotate] = useState(true);
  const controlsRef = useRef<any>(null);
  const resumeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setAutoRotate(true);
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [boardTheme]);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0.95, 3.1], fov: 32 }}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 2]} intensity={1.1} />
      <directionalLight position={[-3, 4, -2]} intensity={0.6} />

      <CameraResetOnThemeChange
        boardTheme={boardTheme}
        controlsRef={controlsRef}
      />
      <BoardPatch boardTheme={boardTheme} />

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={false}
        target={[0, 0.02, 0]}
        minPolarAngle={0.9}
        maxPolarAngle={1.35}
        enableDamping
        dampingFactor={0.08}
        autoRotate={autoRotate}
        autoRotateSpeed={5.3}
        onStart={() => {
          setAutoRotate(false);
          if (resumeTimerRef.current !== null) {
            window.clearTimeout(resumeTimerRef.current);
            resumeTimerRef.current = null;
          }
        }}
        onEnd={() => {
          if (resumeTimerRef.current !== null) {
            window.clearTimeout(resumeTimerRef.current);
          }
          resumeTimerRef.current = window.setTimeout(() => {
            setAutoRotate(true);
            resumeTimerRef.current = null;
          }, 3000);
        }}
      />
    </Canvas>
  );
}

"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Plane, Text, Line, RoundedBox } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import * as THREE from "three";
import {
  usePartyRoom as useP2PRoom,
  type BoardMode,
  type ChatMessage,
  type LeaderboardEntry,
  type Player,
  type Vec3,
} from "@/lib/partyRoom";
import { gooseLegalMovesForSquare } from "@/lib/gooseChess";
import { usePartyVoice } from "@/lib/partyVoice";
import { useWASDKeys } from "@/lib/keyboard";
import { PlayerAvatar } from "@/components/player-avatar";
import { getAvatarSystem } from "@/lib/avatarSystem";
import { OutdoorChess } from "@/components/outdoor-chess";
import { ScifiChess } from "@/components/scifi-chess";
import { OutdoorChess4P } from "@/components/outdoor-chess-4way";
import { VrmPreview } from "@/components/vrm-preview";
import { CoinIcon } from "@/components/coin-icon";
import { ChessSetPreview } from "@/components/chess-set-preview";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import type { User } from "@supabase/supabase-js";
import { BOARD_MODE_DEFS, engineForMode } from "@/lib/boardModes";
import { useRoomDiscovery } from "@/lib/roomDiscovery";

function makeRadialGlowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const inv = 1 / center;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) * inv;
      const dy = (y - center) * inv;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - r);
      const alpha = Math.pow(a, 2.2);

      const i = (y * size + x) * 4;
      data[i + 0] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.floor(alpha * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function stripGuestSuffix(name: string) {
  return name.replace(/\s*\(guest\)\s*$/i, "").trim();
}

function distSq(a: Vec3, b: Vec3) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function hash2(x: number, y: number, seed: number) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return v - Math.floor(v);
}

function smoothstep01(t: number) {
  return t * t * (3 - 2 * t);
}

function voiceGainFromDistanceMeters(d: number) {
  // Simple VRChat-like rolloff: full volume nearby, fades out to silence.
  const NEAR = 2.0;
  // NOTE: Our world coordinates span roughly [-18, 18] in X/Z.
  // Reduced cutoff so proximity feels tighter.
  const FAR = 36.0;
  if (d <= NEAR) return 1;
  if (d >= FAR) return 0;
  const t = (d - NEAR) / (FAR - NEAR);
  return 1 - smoothstep01(t);
}

function valueNoise2(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;

  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);

  const ux = smoothstep01(xf);
  const uy = smoothstep01(yf);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

function fbm2(x: number, y: number, seed: number, octaves = 4) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise2(x * freq, y * freq, seed + i * 19.1);
    freq *= 2.0;
    amp *= 0.5;
  }
  return v;
}

function makeGroundGeometry({
  size = 220,
  segments = 80,
  seed = 3.3,
}: {
  size?: number;
  segments?: number;
  seed?: number;
}) {
  const g = new THREE.PlaneGeometry(size, size, segments, segments);
  g.rotateX(-Math.PI / 2);

  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  // Greener palette with small warm flecks so the park reads as grass instead of plastic dirt.
  const base = new THREE.Color("#2d3f2f");
  const moss = new THREE.Color("#3f6847");
  const sun = new THREE.Color("#5c7a52");
  const dry = new THREE.Color("#4a5a3a");
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    // Gentle height ripples to kill the "flat plastic" look.
    const ripple = (fbm2(x * 0.08, z * 0.08, seed + 15.7, 4) - 0.5) * 0.28;
    const micro = fbm2(x * 0.25 + 3.1, z * 0.25 - 1.7, seed + 21.4, 3) * 0.06;
    // Keep the relief subtle so it doesn't intersect plaza/path decals.
    pos.setY(i, (ripple + micro) * 0.12);

    // Multi-layer color noise for living grass with a few sunlit patches.
    const n1 = fbm2(x * 0.06, z * 0.06, seed, 4); // 0..1
    const n2 = fbm2(x * 0.14 + 20.0, z * 0.14 - 13.0, seed + 8.2, 3);
    const n3 = fbm2(x * 0.35 - 7.4, z * 0.35 + 5.6, seed + 31.8, 2);

    const t = clamp((n1 - 0.32) * 1.25, 0, 1);
    const s = clamp((n2 - 0.42) * 1.35, 0, 1);
    const glow = clamp((n3 - 0.55) * 2.4, 0, 1);

    tmp
      .copy(base)
      .lerp(moss, t)
      .lerp(dry, s * 0.55)
      .lerp(sun, glow * 0.35);

    const o = i * 3;
    colors[o + 0] = tmp.r;
    colors[o + 1] = tmp.g;
    colors[o + 2] = tmp.b;
  }

  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function makeDirtDiskGeometry({
  radius = 22,
  segments = 72,
  seed = 10.1,
  baseColor = "#c9c1b2",
}: {
  radius?: number;
  segments?: number;
  seed?: number;
  baseColor?: string;
}) {
  const g = new THREE.CircleGeometry(radius, segments);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const base = new THREE.Color(baseColor);
  const warm = new THREE.Color("#d8cfbf");
  const cool = new THREE.Color("#a7b0a2");
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);

    const n1 = fbm2(x * 0.12, y * 0.12, seed, 4);
    const n2 = fbm2(x * 0.32 + 9.1, y * 0.32 - 6.4, seed + 4.7, 3);
    const t = clamp((n1 - 0.38) * 1.25, 0, 1);
    const s = clamp((n2 - 0.5) * 1.4, 0, 1);

    const centerWear = 1 - clamp(r / radius, 0, 1);
    const wear = smoothstep01(centerWear);

    tmp
      .copy(base)
      .lerp(warm, t * 0.55 + wear * 0.25)
      .lerp(cool, s * 0.25);

    const o = i * 3;
    colors[o + 0] = tmp.r;
    colors[o + 1] = tmp.g;
    colors[o + 2] = tmp.b;
  }

  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function makeDirtRingGeometry({
  inner = 26,
  outer = 30,
  segments = 80,
  seed = 12.8,
  baseColor = "#b3aa98",
}: {
  inner?: number;
  outer?: number;
  segments?: number;
  seed?: number;
  baseColor?: string;
}) {
  const g = new THREE.RingGeometry(inner, outer, segments);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const base = new THREE.Color(baseColor);
  const warm = new THREE.Color("#c7bfaf");
  const cool = new THREE.Color("#9da89b");
  const tmp = new THREE.Color();

  const mid = (inner + outer) * 0.5;
  const half = (outer - inner) * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);
    const band = 1 - clamp(Math.abs(r - mid) / (half + 1e-6), 0, 1);

    const n1 = fbm2(x * 0.16, y * 0.16, seed, 4);
    const n2 = fbm2(x * 0.42 + 7.2, y * 0.42 - 2.9, seed + 5.1, 3);
    const t = clamp((n1 - 0.4) * 1.2, 0, 1);
    const s = clamp((n2 - 0.52) * 1.5, 0, 1);

    tmp
      .copy(base)
      .lerp(warm, t * 0.45 + band * 0.12)
      .lerp(cool, s * 0.25);

    const o = i * 3;
    colors[o + 0] = tmp.r;
    colors[o + 1] = tmp.g;
    colors[o + 2] = tmp.b;
  }

  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function GradientSky({
  top = "#6b86a8",
  bottom = "#d6a57d",
}: {
  top?: string;
  bottom?: string;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color(top) },
      bottomColor: { value: new THREE.Color(bottom) },
      time: { value: 0 },
      cloudStrength: { value: 0.55 },
      cloudScale: { value: 5.4 },
      cloudSpeed: { value: 0.01 },
      starStrength: { value: 0.9 },
      starDensity: { value: 240.0 },
      starThreshold: { value: 0.9976 },
      starTwinkle: { value: 0.22 },
    }),
    [top, bottom]
  );

  useFrame(({ clock }) => {
    const m = materialRef.current;
    if (m) m.uniforms.time.value = clock.getElapsedTime();
  });

  return (
    <mesh scale={600} frustumCulled={false}>
      <sphereGeometry args={[1, 16, 12]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={
          "varying vec3 vWorldPosition;\n" +
          "void main() {\n" +
          "  vec4 worldPosition = modelMatrix * vec4(position, 1.0);\n" +
          "  vWorldPosition = worldPosition.xyz;\n" +
          "  gl_Position = projectionMatrix * viewMatrix * worldPosition;\n" +
          "}\n"
        }
        fragmentShader={
          "uniform float time;\n" +
          "uniform vec3 topColor;\n" +
          "uniform vec3 bottomColor;\n" +
          "uniform float cloudStrength;\n" +
          "uniform float cloudScale;\n" +
          "uniform float cloudSpeed;\n" +
          "uniform float starStrength;\n" +
          "uniform float starDensity;\n" +
          "uniform float starThreshold;\n" +
          "uniform float starTwinkle;\n" +
          "varying vec3 vWorldPosition;\n" +
          "float hash12(vec2 p) {\n" +
          "  vec3 p3 = fract(vec3(p.xyx) * 0.1031);\n" +
          "  p3 += dot(p3, p3.yzx + 33.33);\n" +
          "  return fract((p3.x + p3.y) * p3.z);\n" +
          "}\n" +
          "\n" +
          "float hash13(vec3 p) {\n" +
          "  p = fract(p * 0.1031);\n" +
          "  p += dot(p, p.yzx + 33.33);\n" +
          "  return fract((p.x + p.y) * p.z);\n" +
          "}\n" +
          "\n" +
          "float noise2(vec2 p) {\n" +
          "  vec2 i = floor(p);\n" +
          "  vec2 f = fract(p);\n" +
          "  float a = hash12(i);\n" +
          "  float b = hash12(i + vec2(1.0, 0.0));\n" +
          "  float c = hash12(i + vec2(0.0, 1.0));\n" +
          "  float d = hash12(i + vec2(1.0, 1.0));\n" +
          "  vec2 u = f * f * (3.0 - 2.0 * f);\n" +
          "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n" +
          "}\n" +
          "\n" +
          "float noise3(vec3 p) {\n" +
          "  vec3 i = floor(p);\n" +
          "  vec3 f = fract(p);\n" +
          "  vec3 u = f * f * (3.0 - 2.0 * f);\n" +
          "\n" +
          "  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));\n" +
          "  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));\n" +
          "  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));\n" +
          "  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));\n" +
          "  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));\n" +
          "  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));\n" +
          "  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));\n" +
          "  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));\n" +
          "\n" +
          "  float nx00 = mix(n000, n100, u.x);\n" +
          "  float nx10 = mix(n010, n110, u.x);\n" +
          "  float nx01 = mix(n001, n101, u.x);\n" +
          "  float nx11 = mix(n011, n111, u.x);\n" +
          "  float nxy0 = mix(nx00, nx10, u.y);\n" +
          "  float nxy1 = mix(nx01, nx11, u.y);\n" +
          "  return mix(nxy0, nxy1, u.z);\n" +
          "}\n" +
          "\n" +
          "float fbm(vec2 p) {\n" +
          "  float v = 0.0;\n" +
          "  float a = 0.5;\n" +
          "  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);\n" +
          "  for (int i = 0; i < 4; i++) {\n" +
          "    v += a * noise2(p);\n" +
          "    p = m * p;\n" +
          "    a *= 0.5;\n" +
          "  }\n" +
          "  return v;\n" +
          "}\n" +
          "\n" +
          "float fbm3(vec3 p) {\n" +
          "  float v = 0.0;\n" +
          "  float a = 0.5;\n" +
          "  for (int i = 0; i < 4; i++) {\n" +
          "    v += a * noise3(p);\n" +
          "    p = p * 1.95 + vec3(0.7, 0.2, 0.9);\n" +
          "    a *= 0.5;\n" +
          "  }\n" +
          "  return v;\n" +
          "}\n" +
          "void main() {\n" +
          "  vec3 dir = normalize(vWorldPosition);\n" +
          "  float h = dir.y * 0.5 + 0.5;\n" +
          "  float t = smoothstep(0.02, 0.98, h);\n" +
          "  vec3 col = mix(bottomColor, topColor, t);\n" +
          "\n" +
          "  // Starfield (procedural, no textures). Fade in toward the zenith.\n" +
          "  float starMask = smoothstep(0.55, 0.98, h);\n" +
          "  vec3 sc = floor(dir * starDensity);\n" +
          "  float sr = hash13(sc);\n" +
          "  float starOn = step(starThreshold, sr);\n" +
          "  float sSize = pow(hash13(sc + vec3(7.1, 3.7, 1.9)), 28.0);\n" +
          "  float sBase = starOn * (0.35 + 1.65 * sSize);\n" +
          "  float tw = 0.5 + 0.5 * sin(time * (1.5 + 6.0 * hash13(sc + vec3(2.0))) + hash13(sc + vec3(9.0)) * 6.2831853);\n" +
          "  float s = sBase * mix(1.0, tw, starTwinkle) * starMask;\n" +
          "  // Slightly cool stars\n" +
          "  col += vec3(0.85, 0.92, 1.0) * (s * starStrength);\n" +
          "\n" +
          "  // Cloud layer: seamless 3D noise in direction space (no UV wrap => no seam)\n" +
          "  vec2 drift = vec2(time * cloudSpeed, time * cloudSpeed * 0.6);\n" +
          "  vec3 p3 = dir * (cloudScale * 1.25) + vec3(drift.x, 0.0, drift.y);\n" +
          "  float n = fbm3(p3 * 1.25);\n" +
          "  float d = noise3(p3 * 6.0);\n" +
          "  n = n * 0.85 + d * 0.15;\n" +
          "  // Keep clouds mostly near the upper sky\n" +
          "  float heightMask = smoothstep(0.35, 0.9, h);\n" +
          "  float clouds = smoothstep(0.45, 0.72, n) * heightMask;\n" +
          "  vec3 cloudCol = mix(col, vec3(1.0, 1.0, 1.0), 0.32) + vec3(0.04, 0.04, 0.05);\n" +
          "  col = mix(col, cloudCol, clouds * cloudStrength);\n" +
          "\n" +
          "  // Gentle horizon haze for depth\n" +
          "  float haze = (1.0 - smoothstep(0.05, 0.22, h)) * 0.18;\n" +
          "  col += vec3(0.08, 0.06, 0.04) * haze;\n" +
          "  gl_FragColor = vec4(col, 1.0);\n" +
          "}\n"
        }
      />
    </mesh>
  );
}

function OrganicPath({
  points,
  y = 0.034,
  width = 2.7,
  color = "#c9c1b2",
}: {
  points: Array<[number, number]>;
  y?: number;
  width?: number;
  color?: string;
}) {
  const geom = useMemo(() => {
    const pts = points.map(([x, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");

    const segments = 160;
    const halfW = width / 2;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize();

      const left = new THREE.Vector3(p.x, y, p.z).addScaledVector(side, halfW);
      const right = new THREE.Vector3(p.x, y, p.z).addScaledVector(
        side,
        -halfW
      );

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, t, 1, t);

      if (i < segments) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();

    // Subtle vertex color variation (cheap, no textures)
    const posAttr = g.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);
    const base = new THREE.Color(color);
    const warm = base.clone().offsetHSL(0.0, -0.02, 0.06);
    const cool = base.clone().offsetHSL(0.0, 0.02, -0.05);
    const tmp = new THREE.Color();
    const seed =
      Math.abs(points[0]?.[0] ?? 0) * 13.7 +
      Math.abs(points[0]?.[1] ?? 0) * 7.9 +
      width * 3.1;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const n1 = fbm2(x * 0.35, z * 0.35, seed, 3);
      const n2 = fbm2(x * 0.9 + 2.0, z * 0.9 - 5.0, seed + 17.2, 2);
      const t = clamp((n1 - 0.45) * 1.1, 0, 1);
      const s = clamp((n2 - 0.5) * 1.4, 0, 1);
      tmp
        .copy(base)
        .lerp(warm, t * 0.35)
        .lerp(cool, s * 0.25);
      const o = i * 3;
      colors[o + 0] = tmp.r;
      colors[o + 1] = tmp.g;
      colors[o + 2] = tmp.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    return g;
  }, [points, y, width, color]);

  return (
    <mesh geometry={geom} receiveShadow renderOrder={5}>
      <meshStandardMaterial
        vertexColors
        roughness={0.96}
        metalness={0.01}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-10}
        polygonOffsetUnits={-10}
      />
    </mesh>
  );
}

function LampPostMaterial(props: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );
    shader.fragmentShader = `
      varying vec3 vPos;
      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      // Cast iron noise
      float noise = fract(sin(dot(vPos.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float fbm = noise * 0.5 + fract(sin(dot(vPos.yz * 2.0, vec2(39.786, 57.012))) * 43758.5453) * 0.25;
      
      vec3 ironColor = vec3(0.15, 0.15, 0.18);
      vec3 rustColor = vec3(0.22, 0.18, 0.16);
      
      diffuseColor.rgb = mix(ironColor, rustColor, fbm * 0.4);
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

function LampGlassMaterial(props: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );
    shader.fragmentShader = `
      uniform float emissiveIntensity;
      varying vec3 vPos;
      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      // Frosted glass noise
      float noise = fract(sin(dot(vPos.xz * 10.0, vec2(12.9898, 78.233))) * 43758.5453);
      
      // Emissive variation
      vec3 glowColor = vec3(1.0, 0.9, 0.7);
      vec3 hotColor = vec3(1.0, 1.0, 0.9);
      
      vec3 finalColor = mix(glowColor, hotColor, noise * 0.2);
      totalEmissiveRadiance = finalColor * emissiveIntensity;
      
      // Glass tint
      diffuseColor.rgb = mix(diffuseColor.rgb, finalColor, 0.5);
      `
    );
  };
  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      transparent
      {...props}
    />
  );
}

export function BoardLamp({
  lampPos,
  targetPos,
}: {
  lampPos: [number, number, number];
  targetPos?: [number, number, number];
}) {
  const keyRef = useRef<THREE.SpotLight>(null);
  const fillRef = useRef<THREE.SpotLight>(null);
  const pointRef = useRef<THREE.PointLight>(null);
  const bulbMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const glowMeshRef = useRef<THREE.Mesh>(null);
  const targetRef = useRef<THREE.Object3D | null>(null);

  const glowTex = useMemo(() => makeRadialGlowTexture(64), []);
  const pulsePhase = useMemo(() => {
    const p = lampPos;
    return (p[0] * 0.37 + p[1] * 1.91 + p[2] * 0.73) % (Math.PI * 2);
  }, [lampPos]);

  useEffect(() => {
    const tPos = targetPos || [lampPos[0], 0, lampPos[2]];
    const target = new THREE.Object3D();
    target.position.set(tPos[0], tPos[1], tPos[2]);
    targetRef.current = target;

    const key = keyRef.current;
    const fill = fillRef.current;
    if (key) key.target = target;
    if (fill) fill.target = target;

    return () => {
      targetRef.current = null;
    };
  }, [targetPos, lampPos]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const w = 0.55;
    const pulse = 0.72 + 0.28 * Math.sin(t * w + pulsePhase);
    const flicker = 0.97 + 0.03 * Math.sin(t * 3.2 + pulsePhase * 1.7);
    const k = pulse * flicker;

    const point = pointRef.current;
    if (point) point.intensity = 0.9 * (0.75 + 0.55 * k);

    const key = keyRef.current;
    if (key) key.intensity = 1.05 * (0.8 + 0.45 * k);

    const fill = fillRef.current;
    if (fill) fill.intensity = 0.45 * (0.85 + 0.35 * k);

    const bulbMat = bulbMatRef.current;
    if (bulbMat) bulbMat.emissiveIntensity = 0.35 * (0.9 + 0.8 * k);

    const glowMat = glowMatRef.current;
    if (glowMat) glowMat.opacity = 0.22 + 0.38 * k;

    const glowMesh = glowMeshRef.current;
    if (glowMesh) {
      const s = 1.65 + 0.55 * k;
      glowMesh.scale.set(s, s, s);
    }
  });

  return (
    <>
      <group position={lampPos}>
        {/* Base */}
        <mesh castShadow receiveShadow position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.25, 0.3, 0.4, 8]} />
          <LampPostMaterial roughness={0.8} metalness={0.5} />
        </mesh>
        {/* Post */}
        <mesh castShadow receiveShadow position={[0, 1.7, 0]}>
          <cylinderGeometry args={[0.08, 0.12, 2.6, 8]} />
          <LampPostMaterial roughness={0.8} metalness={0.5} />
        </mesh>
        {/* Lamp Head Holder */}
        <mesh castShadow receiveShadow position={[0, 3.05, 0]}>
          <cylinderGeometry args={[0.2, 0.08, 0.1, 8]} />
          <LampPostMaterial roughness={0.8} metalness={0.5} />
        </mesh>

        {/* Inner Bulb */}
        <mesh position={[0, 3.25, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color="#ffaa00"
            emissive="#ffaa00"
            emissiveIntensity={2.0}
            toneMapped={false}
          />
        </mesh>

        {/* Lamp Glass (Lantern shape) */}
        <mesh castShadow position={[0, 3.3, 0]}>
          <cylinderGeometry args={[0.25, 0.15, 0.5, 6]} />
          <LampGlassMaterial
            ref={bulbMatRef}
            emissiveIntensity={0.2}
            roughness={0.2}
            metalness={0.1}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            color="#ffeedd"
          />
        </mesh>
        {/* Cap */}
        <mesh castShadow position={[0, 3.6, 0]}>
          <coneGeometry args={[0.35, 0.15, 6]} />
          <LampPostMaterial roughness={0.8} metalness={0.5} />
        </mesh>

        <Billboard position={[0, 3.3, 0]}>
          <mesh ref={glowMeshRef}>
            <planeGeometry args={[1.5, 1.5]} />
            <meshBasicMaterial
              ref={glowMatRef}
              map={glowTex}
              color="#ffd1a6"
              transparent
              opacity={0.5}
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </Billboard>
        <pointLight
          ref={pointRef}
          position={[0, 3.3, 0]}
          intensity={0.9}
          distance={14}
          decay={2}
          color="#ffcf98"
        />
      </group>

      <spotLight
        ref={keyRef}
        position={[lampPos[0], lampPos[1] + 3.4, lampPos[2]]}
        angle={0.58}
        penumbra={0.85}
        intensity={1.05}
        distance={34}
        decay={2}
        color="#fff1d6"
      />
      <spotLight
        ref={fillRef}
        position={[lampPos[0] - 6.0, lampPos[1] + 6.0, lampPos[2] + 4.5]}
        angle={0.68}
        penumbra={0.9}
        intensity={0.45}
        distance={24}
        decay={2}
        color="#ffe3b5"
      />
      {targetRef.current ? <primitive object={targetRef.current} /> : null}
    </>
  );
}
function AvatarBody({
  color,
  isSelf,
  movingSpeed,
  gender = "male",
}: {
  color: string;
  isSelf?: boolean;
  movingSpeed: number;
  gender?: "male" | "female";
}) {
  const {
    shirt,
    shirtDark,
    pants,
    pantsDark,
    skin,
    skinLight,
    skinDark,
    shoes,
    shoeSole,
    hair,
    hairShine,
    lips,
    lipsDark,
    irisColor,
    outfitType,
    skinTone,
    hairstyleType,
    accent1,
    accent2,
    belt,
    bodyHeight,
    bodyBuild,
  } = useMemo(() => {
    const base = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);

    // Use hue to determine character features for variety
    const hash = Math.floor(hsl.h * 1000);

    // Body proportions - height and build variation
    const heightVariation = (((hash * 3) % 20) - 10) / 100; // -0.1 to +0.1
    const bodyHeight = 1 + heightVariation;
    const buildIndex = hash % 3; // 0=slim, 1=average, 2=stocky
    const bodyBuild = buildIndex;

    // Diverse realistic skin tones (5 different tones)
    const skinToneIndex = hash % 5;
    const skinTones = [
      { h: 0.08, s: 0.48, l: 0.72 }, // Light peachy
      { h: 0.06, s: 0.38, l: 0.65 }, // Medium light
      { h: 0.07, s: 0.42, l: 0.55 }, // Medium
      { h: 0.05, s: 0.35, l: 0.42 }, // Medium dark
      { h: 0.04, s: 0.32, l: 0.32 }, // Dark
    ];
    const skinTone = skinToneIndex;
    const selectedSkin = skinTones[skinToneIndex];
    const skin = new THREE.Color().setHSL(
      selectedSkin.h,
      selectedSkin.s,
      selectedSkin.l
    );
    const skinLight = new THREE.Color().setHSL(
      selectedSkin.h,
      selectedSkin.s * 0.9,
      selectedSkin.l * 1.08
    );
    const skinDark = new THREE.Color().setHSL(
      selectedSkin.h,
      selectedSkin.s * 1.05,
      selectedSkin.l * 0.86
    );

    // Outfit types (casual, formal, dress, suit, sporty)
    const outfitTypeIndex = Math.floor((hash * 7) % 5);
    const outfitType = outfitTypeIndex;

    let shirt, shirtDark, pants, pantsDark, accent1, accent2, belt;

    if (outfitTypeIndex === 0) {
      // Casual t-shirt and jeans
      const shirtSat = clamp(0.5 + hsl.s * 0.5, 0.5, 0.75);
      const shirtLit = clamp(0.5 + hsl.l * 0.15, 0.5, 0.65);
      shirt = new THREE.Color().setHSL(hsl.h, shirtSat, shirtLit);
      shirtDark = new THREE.Color().setHSL(
        hsl.h,
        shirtSat * 0.9,
        shirtLit * 0.75
      );
      pants = new THREE.Color().setHSL(0.6, 0.5, 0.35); // Blue jeans
      pantsDark = new THREE.Color().setHSL(0.6, 0.5, 0.25);
      accent1 = shirt;
      accent2 = pants;
      belt = new THREE.Color().setHSL(0.08, 0.2, 0.2);
    } else if (outfitTypeIndex === 1) {
      // Formal suit/blazer
      const suitHue = (hsl.h + 0.5) % 1;
      shirt = new THREE.Color().setHSL(0, 0, 0.95); // White shirt
      shirtDark = new THREE.Color().setHSL(0, 0, 0.85);
      pants = new THREE.Color().setHSL(suitHue, 0.15, 0.2); // Dark pants
      pantsDark = new THREE.Color().setHSL(suitHue, 0.15, 0.15);
      accent1 = new THREE.Color().setHSL(hsl.h, 0.7, 0.4); // Tie/accent
      accent2 = new THREE.Color().setHSL(suitHue, 0.2, 0.25); // Jacket
      belt = new THREE.Color().setHSL(0.08, 0.3, 0.15);
    } else if (outfitTypeIndex === 2 && gender === "female") {
      // Dress
      const dressSat = clamp(0.6 + hsl.s * 0.4, 0.6, 0.8);
      const dressLit = clamp(0.45 + hsl.l * 0.2, 0.45, 0.6);
      shirt = new THREE.Color().setHSL(hsl.h, dressSat, dressLit);
      shirtDark = new THREE.Color().setHSL(
        hsl.h,
        dressSat * 0.9,
        dressLit * 0.75
      );
      pants = shirt; // Dress continues
      pantsDark = shirtDark;
      accent1 = new THREE.Color().setHSL((hsl.h + 0.1) % 1, 0.5, 0.5);
      accent2 = shirt;
      belt = new THREE.Color().setHSL(hsl.h, 0.4, 0.35);
    } else if (outfitTypeIndex === 3) {
      // Business casual
      shirt = new THREE.Color().setHSL((hsl.h + 0.3) % 1, 0.4, 0.6);
      shirtDark = new THREE.Color().setHSL((hsl.h + 0.3) % 1, 0.4, 0.5);
      pants = new THREE.Color().setHSL(0.08, 0.2, 0.25); // Khaki/brown
      pantsDark = new THREE.Color().setHSL(0.08, 0.2, 0.18);
      accent1 = new THREE.Color().setHSL(hsl.h, 0.5, 0.45);
      accent2 = pants;
      belt = new THREE.Color().setHSL(0.08, 0.25, 0.2);
    } else {
      // Sporty/athletic
      const sportSat = clamp(0.7 + hsl.s * 0.3, 0.7, 0.85);
      shirt = new THREE.Color().setHSL(hsl.h, sportSat, 0.5);
      shirtDark = new THREE.Color().setHSL(hsl.h, sportSat, 0.4);
      pants = new THREE.Color().setHSL((hsl.h + 0.5) % 1, 0.2, 0.2); // Dark athletic pants
      pantsDark = new THREE.Color().setHSL((hsl.h + 0.5) % 1, 0.2, 0.15);
      accent1 = new THREE.Color().setHSL((hsl.h + 0.2) % 1, 0.7, 0.55);
      accent2 = new THREE.Color().setHSL(0, 0, 0.95);
      belt = pants;
    }

    // Varied shoe colors
    const shoes = new THREE.Color().setHSL(
      hsl.h,
      Math.min(0.2, hsl.s * 0.25),
      0.15 + (hash % 30) / 100
    );
    const shoeSole = new THREE.Color().setHSL(0, 0.05, 0.85);

    // Diverse hair colors (natural browns, blacks, blondes, reds, and fantasy colors)
    const hairTypeIndex = Math.floor((hash * 13) % 8);
    const hairstyleType = Math.floor((hash * 17) % 4); // 4 different hairstyles
    let hair, hairShine;

    if (hairTypeIndex === 0) {
      // Black hair
      hair = new THREE.Color().setHSL(0.05, 0.25, 0.12);
      hairShine = new THREE.Color().setHSL(0.05, 0.15, 0.25);
    } else if (hairTypeIndex === 1) {
      // Dark brown
      hair = new THREE.Color().setHSL(0.08, 0.45, 0.22);
      hairShine = new THREE.Color().setHSL(0.08, 0.35, 0.4);
    } else if (hairTypeIndex === 2) {
      // Light brown
      hair = new THREE.Color().setHSL(0.08, 0.4, 0.35);
      hairShine = new THREE.Color().setHSL(0.08, 0.3, 0.5);
    } else if (hairTypeIndex === 3) {
      // Blonde
      hair = new THREE.Color().setHSL(0.12, 0.55, 0.6);
      hairShine = new THREE.Color().setHSL(0.12, 0.4, 0.75);
    } else if (hairTypeIndex === 4) {
      // Red/Auburn
      hair = new THREE.Color().setHSL(0.02, 0.7, 0.35);
      hairShine = new THREE.Color().setHSL(0.02, 0.5, 0.5);
    } else if (hairTypeIndex === 5) {
      // White/Silver
      hair = new THREE.Color().setHSL(0, 0, 0.85);
      hairShine = new THREE.Color().setHSL(0, 0, 0.95);
    } else {
      // Fantasy colors based on base hue
      hair = new THREE.Color().setHSL(hsl.h, 0.6, 0.4);
      hairShine = new THREE.Color().setHSL(hsl.h, 0.4, 0.6);
    }

    const lips = new THREE.Color().setHSL(0.98, 0.52, 0.65);
    const lipsDark = new THREE.Color().setHSL(0.98, 0.48, 0.55);
    const irisColor = new THREE.Color().setHSL(hsl.h, 0.45, 0.33);

    return {
      shirt,
      shirtDark,
      pants,
      pantsDark,
      skin,
      skinLight,
      skinDark,
      shoes,
      shoeSole,
      hair,
      hairShine,
      lips,
      lipsDark,
      irisColor,
      outfitType,
      skinTone,
      hairstyleType,
      accent1,
      accent2,
      belt,
      bodyHeight,
      bodyBuild,
    };
  }, [color, gender]);

  // Calculate body scale factors based on build
  const torsoScale = useMemo((): [number, number, number] => {
    if (bodyBuild === 0)
      return gender === "female" ? [0.95, 1, 0.95] : [0.92, 1, 0.92]; // slim
    if (bodyBuild === 2)
      return gender === "female" ? [1.08, 1, 1.08] : [1.12, 1, 1.12]; // stocky
    return [1, 1, 1]; // average
  }, [bodyBuild, gender]);

  const armScale = useMemo(() => {
    if (bodyBuild === 0) return 0.92; // slim
    if (bodyBuild === 2) return 1.08; // stocky
    return 1; // average
  }, [bodyBuild]);

  const legScale = useMemo(() => {
    if (bodyBuild === 0) return 0.94; // slim
    if (bodyBuild === 2) return 1.06; // stocky
    return 1; // average
  }, [bodyBuild]);

  const hipsRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const legLRef = useRef<THREE.Group>(null);
  const legRRef = useRef<THREE.Group>(null);

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const m = clamp(movingSpeed / 3.2, 0, 1);
    const idle = 1 - m; // idle amount (inverse of movement)

    const ease = clamp(dt * 12, 0, 1);

    // Idle breathing animation
    const breathe = Math.sin(t * 1.2) * 0.015 * idle;

    const walkSpeed = 8.5;
    const phase = t * walkSpeed;
    const swing = Math.sin(phase) * (0.65 * m);
    const swing2 = Math.sin(phase + Math.PI) * (0.65 * m);
    const bob = Math.abs(Math.sin(phase * 2)) * (0.08 * m);

    if (hipsRef.current) {
      hipsRef.current.position.y = THREE.MathUtils.lerp(
        hipsRef.current.position.y,
        bob + breathe * 0.5,
        ease
      );
    }

    if (torsoRef.current) {
      torsoRef.current.rotation.x = THREE.MathUtils.lerp(
        torsoRef.current.rotation.x,
        -0.1 * m + breathe,
        ease
      );
      torsoRef.current.rotation.z = THREE.MathUtils.lerp(
        torsoRef.current.rotation.z,
        0.05 * Math.sin(phase) * m,
        ease
      );
      // Subtle scale for breathing
      const breathScale = 1 + breathe * 0.5;
      torsoRef.current.scale.y = THREE.MathUtils.lerp(
        torsoRef.current.scale.y,
        breathScale,
        ease
      );
    }

    if (headRef.current) {
      headRef.current.rotation.x = THREE.MathUtils.lerp(
        headRef.current.rotation.x,
        0.06 * Math.sin(phase * 0.5) * m + breathe * 0.3,
        ease
      );
      headRef.current.rotation.z = THREE.MathUtils.lerp(
        headRef.current.rotation.z,
        0.04 * Math.sin(phase * 0.5) * m,
        ease
      );
    }

    if (armLRef.current) {
      armLRef.current.rotation.x = THREE.MathUtils.lerp(
        armLRef.current.rotation.x,
        swing - breathe * 0.2,
        ease
      );
    }
    if (armRRef.current) {
      armRRef.current.rotation.x = THREE.MathUtils.lerp(
        armRRef.current.rotation.x,
        swing2 - breathe * 0.2,
        ease
      );
    }
    if (legLRef.current) {
      legLRef.current.rotation.x = THREE.MathUtils.lerp(
        legLRef.current.rotation.x,
        swing2,
        ease
      );
    }
    if (legRRef.current) {
      legRRef.current.rotation.x = THREE.MathUtils.lerp(
        legRRef.current.rotation.x,
        swing,
        ease
      );
    }
  });

  return (
    <group position={[0, 0.7, 0]} scale={[1, bodyHeight, 1]}>
      <group ref={hipsRef} position={[0, 0, 0]}>
        {/* Sims 4 style - characteristic proportions with bigger heads */}
        <group ref={torsoRef} position={[0, 0.35, 0]}>
          {/* Torso - Sims 4 has shorter, more stylized torsos */}
          <mesh castShadow scale={torsoScale}>
            <capsuleGeometry
              args={
                gender === "female"
                  ? [0.16, 0.32, 12, 24]
                  : [0.18, 0.35, 12, 24]
              }
            />
            <meshStandardMaterial
              color={shirt}
              roughness={0.75}
              metalness={0.02}
            />
          </mesh>

          {/* Chest/bust area - subtle for female */}
          {gender === "female" ? (
            <mesh position={[0, 0.1, 0.07]} castShadow>
              <sphereGeometry
                args={[0.1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]}
              />
              <meshStandardMaterial color={shirt} roughness={0.76} />
            </mesh>
          ) : null}

          {/* Arms - Sims 4 style shorter and simpler */}
          <group
            ref={armLRef}
            position={gender === "female" ? [-0.22, 0.12, 0] : [-0.24, 0.14, 0]}
            scale={[armScale, 1, armScale]}
          >
            {/* Shoulder */}
            <mesh castShadow>
              <sphereGeometry args={[0.08, 14, 12]} />
              <meshStandardMaterial color={shirt} roughness={0.74} />
            </mesh>
            {/* Upper arm */}
            <mesh position={[0, -0.14, 0]} castShadow>
              <capsuleGeometry args={[0.06, 0.22, 10, 16]} />
              <meshStandardMaterial color={shirt} roughness={0.76} />
            </mesh>
            {/* Elbow */}
            <mesh position={[0, -0.27, 0]} castShadow>
              <sphereGeometry args={[0.055, 12, 10]} />
              <meshStandardMaterial color={skin} roughness={0.72} />
            </mesh>
            {/* Forearm - skin tone, simplified */}
            <mesh position={[0, -0.37, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.16, 10, 16]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>
            {/* Hand - simplified Sims style */}
            <mesh position={[0, -0.48, 0]} castShadow>
              <sphereGeometry args={[0.055, 12, 10]} scale={[0.9, 1.2, 0.7]} />
              <meshStandardMaterial color={skin} roughness={0.74} />
            </mesh>
          </group>

          <group
            ref={armRRef}
            position={gender === "female" ? [0.22, 0.12, 0] : [0.24, 0.14, 0]}
            scale={[armScale, 1, armScale]}
          >
            {/* Shoulder */}
            <mesh castShadow>
              <sphereGeometry args={[0.08, 14, 12]} />
              <meshStandardMaterial color={shirt} roughness={0.74} />
            </mesh>
            {/* Upper arm */}
            <mesh position={[0, -0.14, 0]} castShadow>
              <capsuleGeometry args={[0.06, 0.22, 10, 16]} />
              <meshStandardMaterial color={shirt} roughness={0.76} />
            </mesh>
            {/* Elbow */}
            <mesh position={[0, -0.27, 0]} castShadow>
              <sphereGeometry args={[0.055, 12, 10]} />
              <meshStandardMaterial color={skin} roughness={0.72} />
            </mesh>
            {/* Forearm - skin tone, simplified */}
            <mesh position={[0, -0.37, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.16, 10, 16]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>
            {/* Hand - simplified Sims style */}
            <mesh position={[0, -0.48, 0]} castShadow>
              <sphereGeometry args={[0.055, 12, 10]} scale={[0.9, 1.2, 0.7]} />
              <meshStandardMaterial color={skin} roughness={0.74} />
            </mesh>
          </group>

          {/* Neck - Sims 4 style thinner and shorter */}
          <mesh position={[0, 0.28, 0]} castShadow>
            <capsuleGeometry args={[0.045, 0.08, 10, 14]} />
            <meshStandardMaterial color={skinLight} roughness={0.68} />
          </mesh>

          {/* Head group - BIGGER for Sims 4 characteristic look */}
          <group ref={headRef} position={[0, 0.52, 0]}>
            {/* Head - larger, more egg-shaped like Sims */}
            <mesh castShadow>
              <sphereGeometry
                args={[0.28, 24, 20]}
                scale={[0.95, 1.15, 0.92]}
              />
              <meshStandardMaterial color={skin} roughness={0.65} />
            </mesh>

            {/* Cheeks - Sims style rounded */}
            <mesh position={[-0.16, -0.04, 0.2]}>
              <sphereGeometry args={[0.08, 14, 12]} />
              <meshStandardMaterial
                color={lips}
                transparent
                opacity={0.12}
                roughness={1}
              />
            </mesh>
            <mesh position={[0.16, -0.04, 0.2]}>
              <sphereGeometry args={[0.08, 14, 12]} />
              <meshStandardMaterial
                color={lips}
                transparent
                opacity={0.12}
                roughness={1}
              />
            </mesh>

            {/* Ears - helps silhouette read more "Sims" */}
            <mesh position={[-0.26, 0.02, 0]} castShadow>
              <sphereGeometry args={[0.05, 12, 10]} scale={[0.7, 1, 0.7]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>
            <mesh position={[0.26, 0.02, 0]} castShadow>
              <sphereGeometry args={[0.05, 12, 10]} scale={[0.7, 1, 0.7]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>

            {/* Soft jaw shadow */}
            <mesh position={[0, -0.08, 0.12]}>
              <sphereGeometry args={[0.16, 14, 12]} scale={[1.0, 0.7, 0.8]} />
              <meshStandardMaterial
                color={skinDark}
                transparent
                opacity={0.12}
                roughness={1}
              />
            </mesh>

            {/* Hair - Sims 4 style VOLUMINOUS and stylized */}
            {gender === "female" ? (
              <>
                {/* Female hair - varied styles based on hairstyleType */}
                {hairstyleType === 0 ? (
                  /* Long flowing hair */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry
                        args={[0.3, 18, 16]}
                        scale={[1, 0.95, 1.05]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.22, 0]} castShadow>
                      <sphereGeometry
                        args={[0.22, 16, 14]}
                        scale={[1.1, 1, 1.1]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[-0.22, 0.05, 0]} castShadow>
                      <sphereGeometry
                        args={[0.15, 14, 12]}
                        scale={[1.2, 1.3, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0.22, 0.05, 0]} castShadow>
                      <sphereGeometry
                        args={[0.15, 14, 12]}
                        scale={[1.2, 1.3, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.02, -0.22]} castShadow>
                      <sphereGeometry
                        args={[0.2, 16, 14]}
                        scale={[1.15, 1.25, 1]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh
                      position={[-0.16, -0.32, -0.1]}
                      rotation={[0.12, 0, 0.15]}
                      castShadow
                    >
                      <capsuleGeometry args={[0.05, 0.62, 12, 16]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh
                      position={[0.16, -0.32, -0.1]}
                      rotation={[0.12, 0, -0.15]}
                      castShadow
                    >
                      <capsuleGeometry args={[0.05, 0.62, 12, 16]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh
                      position={[0, -0.35, -0.18]}
                      rotation={[0.18, 0, 0]}
                      castShadow
                    >
                      <capsuleGeometry args={[0.06, 0.66, 12, 16]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                  </>
                ) : hairstyleType === 1 ? (
                  /* Bun/updo */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry
                        args={[0.29, 18, 16]}
                        scale={[1, 0.92, 1.02]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.18, -0.24]} castShadow>
                      <sphereGeometry
                        args={[0.18, 16, 14]}
                        scale={[1.2, 1.1, 1.2]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.26, -0.22]} castShadow>
                      <sphereGeometry
                        args={[0.14, 14, 12]}
                        scale={[1.15, 1, 1.15]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[-0.12, 0.15, -0.18]} castShadow>
                      <capsuleGeometry args={[0.05, 0.15, 10, 14]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0.12, 0.15, -0.18]} castShadow>
                      <capsuleGeometry args={[0.05, 0.15, 10, 14]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                  </>
                ) : hairstyleType === 2 ? (
                  /* Short pixie cut */
                  <>
                    <mesh position={[0, 0.08, -0.01]} castShadow>
                      <sphereGeometry
                        args={[0.29, 18, 16]}
                        scale={[1, 0.88, 1.06]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.18, 0.08]} castShadow>
                      <sphereGeometry
                        args={[0.16, 16, 14]}
                        scale={[1.2, 0.9, 1.1]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[-0.2, 0.08, 0]} castShadow>
                      <sphereGeometry
                        args={[0.12, 14, 12]}
                        scale={[1.1, 1.05, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0.2, 0.08, 0]} castShadow>
                      <sphereGeometry
                        args={[0.12, 14, 12]}
                        scale={[1.1, 1.05, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                  </>
                ) : (
                  /* Shoulder-length bob */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry
                        args={[0.3, 18, 16]}
                        scale={[1, 0.95, 1.05]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.2, 0]} castShadow>
                      <sphereGeometry
                        args={[0.2, 16, 14]}
                        scale={[1.1, 1, 1.08]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[-0.22, -0.02, 0]} castShadow>
                      <sphereGeometry
                        args={[0.16, 14, 12]}
                        scale={[1.2, 1.4, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0.22, -0.02, 0]} castShadow>
                      <sphereGeometry
                        args={[0.16, 14, 12]}
                        scale={[1.2, 1.4, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, -0.02, -0.22]} castShadow>
                      <sphereGeometry
                        args={[0.18, 16, 14]}
                        scale={[1.15, 1.3, 1]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh
                      position={[-0.14, -0.15, -0.08]}
                      rotation={[0.1, 0, 0.12]}
                      castShadow
                    >
                      <capsuleGeometry args={[0.06, 0.28, 12, 16]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh
                      position={[0.14, -0.15, -0.08]}
                      rotation={[0.1, 0, -0.12]}
                      castShadow
                    >
                      <capsuleGeometry args={[0.06, 0.28, 12, 16]} />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                  </>
                )}

                {/* Top tuft - adds volume without looking like glass */}
                <mesh position={[0, 0.18, 0.12]} castShadow>
                  <sphereGeometry
                    args={[0.13, 12, 10]}
                    scale={[1.25, 0.9, 0.7]}
                  />
                  <meshStandardMaterial
                    color={hair}
                    roughness={0.32}
                    metalness={0}
                  />
                </mesh>
              </>
            ) : (
              <>
                {/* Male hair - varied styles based on hairstyleType */}
                {hairstyleType === 0 ? (
                  /* Classic short */
                  <>
                    <mesh position={[0, 0.08, -0.01]} castShadow>
                      <sphereGeometry
                        args={[0.28, 18, 16]}
                        scale={[1, 0.85, 1.08]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.2, 0.04]} castShadow>
                      <sphereGeometry
                        args={[0.18, 16, 14]}
                        scale={[1.15, 0.95, 1.1]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.9} />
                    </mesh>
                    <mesh position={[0, 0.15, 0.2]} castShadow>
                      <sphereGeometry
                        args={[0.12, 14, 12]}
                        scale={[1.3, 0.9, 1]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.89} />
                    </mesh>
                  </>
                ) : hairstyleType === 1 ? (
                  /* Slicked back */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry
                        args={[0.28, 18, 16]}
                        scale={[1, 0.82, 1.15]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.7} />
                    </mesh>
                    <mesh position={[0, 0.18, -0.08]} castShadow>
                      <sphereGeometry
                        args={[0.2, 16, 14]}
                        scale={[1.05, 0.9, 1.2]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.65} />
                    </mesh>
                    <mesh position={[0, 0.05, -0.22]} castShadow>
                      <sphereGeometry
                        args={[0.16, 14, 12]}
                        scale={[1.1, 1.05, 1]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.68} />
                    </mesh>
                  </>
                ) : hairstyleType === 2 ? (
                  /* Mohawk/spiky */
                  <>
                    <mesh position={[0, 0.08, 0]} castShadow>
                      <sphereGeometry
                        args={[0.27, 18, 16]}
                        scale={[1, 0.8, 1.05]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.26, 0.02]} castShadow>
                      <sphereGeometry
                        args={[0.095, 16, 14]}
                        scale={[0.8, 1.05, 1]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.2, 0.08]} castShadow>
                      <sphereGeometry
                        args={[0.085, 14, 12]}
                        scale={[0.9, 1.05, 0.9]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                    <mesh position={[0, 0.22, -0.06]} castShadow>
                      <sphereGeometry
                        args={[0.09, 14, 12]}
                        scale={[0.85, 1.05, 0.95]}
                      />
                      <meshStandardMaterial
                        color={hair}
                        roughness={0.32}
                        metalness={0}
                      />
                    </mesh>
                  </>
                ) : (
                  /* Longer messy */
                  <>
                    <mesh position={[0, 0.08, -0.01]} castShadow>
                      <sphereGeometry
                        args={[0.29, 18, 16]}
                        scale={[1, 0.88, 1.08]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.2, 0.04]} castShadow>
                      <sphereGeometry
                        args={[0.19, 16, 14]}
                        scale={[1.15, 1, 1.15]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.9} />
                    </mesh>
                    <mesh position={[-0.2, 0.06, 0.02]} castShadow>
                      <sphereGeometry
                        args={[0.14, 14, 12]}
                        scale={[1.15, 1.15, 0.95]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0.2, 0.06, 0.02]} castShadow>
                      <sphereGeometry
                        args={[0.14, 14, 12]}
                        scale={[1.15, 1.15, 0.95]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.04, -0.22]} castShadow>
                      <sphereGeometry
                        args={[0.17, 14, 12]}
                        scale={[1.2, 1.1, 1]}
                      />
                      <meshStandardMaterial color={hair} roughness={0.87} />
                    </mesh>
                  </>
                )}

                {/* Hair shine */}
                <mesh position={[0, 0.16, 0.14]}>
                  <sphereGeometry
                    args={[0.12, 12, 10]}
                    scale={[1.2, 0.7, 0.6]}
                  />
                  <meshStandardMaterial
                    color={hairShine}
                    transparent
                    opacity={0.6}
                    roughness={0.06}
                    metalness={0}
                  />
                </mesh>
              </>
            )}

            {/* Nose - Sims 4 style rounder and cuter */}
            <mesh position={[0, -0.02, 0.24]} castShadow>
              <capsuleGeometry args={[0.022, 0.05, 8, 12]} />
              <meshStandardMaterial color={skinDark} roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.05, 0.26]} castShadow>
              <sphereGeometry args={[0.032, 12, 10]} scale={[1.1, 0.9, 0.85]} />
              <meshStandardMaterial color={skin} roughness={0.68} />
            </mesh>
            {/* Nostrils - subtle */}
            <mesh position={[-0.018, -0.06, 0.27]}>
              <sphereGeometry args={[0.012, 8, 6]} scale={[0.8, 0.6, 1]} />
              <meshStandardMaterial color={skinDark} roughness={0.8} />
            </mesh>
            <mesh position={[0.018, -0.06, 0.27]}>
              <sphereGeometry args={[0.012, 8, 6]} scale={[0.8, 0.6, 1]} />
              <meshStandardMaterial color={skinDark} roughness={0.8} />
            </mesh>

            {/* Eyes - BIGGER for Sims 4 expressiveness */}
            {/* Left eye */}
            <group position={[-0.11, 0.04, 0.22]}>
              {/* Eye socket depth */}
              <mesh position={[0, 0, -0.01]}>
                <sphereGeometry args={[0.058, 14, 12]} scale={[1.15, 1, 0.5]} />
                <meshStandardMaterial
                  color={skinDark}
                  transparent
                  opacity={0.3}
                  roughness={1}
                />
              </mesh>
              {/* Eye white - larger */}
              <mesh position={[0, 0, 0.02]} castShadow>
                <sphereGeometry args={[0.048, 16, 14]} scale={[1.15, 1, 0.6]} />
                <meshStandardMaterial color="#fefefe" roughness={0.35} />
              </mesh>
              {/* Iris outer ring - adds depth */}
              <mesh position={[0, 0, 0.038]}>
                <sphereGeometry args={[0.035, 18, 16]} scale={[1, 1, 0.35]} />
                <meshStandardMaterial
                  color={irisColor}
                  roughness={0.25}
                  transparent
                  opacity={0.6}
                />
              </mesh>
              {/* Iris - bigger and more expressive */}
              <mesh position={[0, 0, 0.042]}>
                <sphereGeometry args={[0.03, 18, 16]} scale={[1, 1, 0.4]} />
                <meshStandardMaterial color={irisColor} roughness={0.2} />
              </mesh>
              {/* Pupil - larger */}
              <mesh position={[0, 0, 0.052]}>
                <sphereGeometry args={[0.013, 14, 12]} scale={[1, 1, 0.3]} />
                <meshStandardMaterial color="#000000" roughness={0} />
              </mesh>
              {/* Eye shine - dual highlights for Sims sparkle */}
              <mesh position={[-0.009, 0.014, 0.058]}>
                <sphereGeometry args={[0.011, 10, 8]} />
                <meshStandardMaterial
                  color="white"
                  emissive="white"
                  emissiveIntensity={1.2}
                  roughness={0}
                />
              </mesh>
              <mesh position={[0.008, -0.008, 0.056]}>
                <sphereGeometry args={[0.006, 8, 6]} />
                <meshStandardMaterial
                  color="white"
                  emissive="white"
                  emissiveIntensity={0.7}
                  roughness={0}
                  transparent
                  opacity={0.8}
                />
              </mesh>
              {/* Upper eyelid */}
              <mesh
                position={[0, 0.028, 0.032]}
                rotation={[0.15, 0, Math.PI / 2]}
              >
                <capsuleGeometry args={[0.027, 0.064, 8, 12]} />
                <meshStandardMaterial
                  color={skinDark}
                  transparent
                  opacity={0.55}
                  roughness={0.75}
                />
              </mesh>
              {/* Lower eyelid */}
              <mesh
                position={[0, -0.022, 0.028]}
                rotation={[-0.1, 0, Math.PI / 2]}
              >
                <capsuleGeometry args={[0.024, 0.058, 8, 12]} />
                <meshStandardMaterial
                  color={skin}
                  transparent
                  opacity={0.4}
                  roughness={0.8}
                />
              </mesh>

              {/* Eyelashes (female) */}
              {gender === "female" ? (
                <mesh
                  position={[0.006, 0.028, 0.06]}
                  rotation={[0.1, 0, Math.PI / 2 - 0.25]}
                >
                  <capsuleGeometry args={[0.006, 0.06, 6, 10]} />
                  <meshStandardMaterial color={hair} roughness={0.6} />
                </mesh>
              ) : null}
            </group>

            {/* Right eye */}
            <group position={[0.11, 0.04, 0.22]}>
              {/* Eye socket depth */}
              <mesh position={[0, 0, -0.01]}>
                <sphereGeometry args={[0.058, 14, 12]} scale={[1.15, 1, 0.5]} />
                <meshStandardMaterial
                  color={skinDark}
                  transparent
                  opacity={0.3}
                  roughness={1}
                />
              </mesh>
              {/* Eye white - larger */}
              <mesh position={[0, 0, 0.02]} castShadow>
                <sphereGeometry args={[0.048, 16, 14]} scale={[1.15, 1, 0.6]} />
                <meshStandardMaterial color="#fefefe" roughness={0.35} />
              </mesh>
              {/* Iris outer ring - adds depth */}
              <mesh position={[0, 0, 0.038]}>
                <sphereGeometry args={[0.035, 18, 16]} scale={[1, 1, 0.35]} />
                <meshStandardMaterial
                  color={irisColor}
                  roughness={0.25}
                  transparent
                  opacity={0.6}
                />
              </mesh>
              {/* Iris - bigger and more expressive */}
              <mesh position={[0, 0, 0.042]}>
                <sphereGeometry args={[0.03, 18, 16]} scale={[1, 1, 0.4]} />
                <meshStandardMaterial color={irisColor} roughness={0.2} />
              </mesh>
              {/* Pupil - larger */}
              <mesh position={[0, 0, 0.052]}>
                <sphereGeometry args={[0.013, 14, 12]} scale={[1, 1, 0.3]} />
                <meshStandardMaterial color="#000000" roughness={0} />
              </mesh>
              {/* Eye shine - dual highlights for Sims sparkle */}
              <mesh position={[-0.009, 0.014, 0.058]}>
                <sphereGeometry args={[0.011, 10, 8]} />
                <meshStandardMaterial
                  color="white"
                  emissive="white"
                  emissiveIntensity={1.2}
                  roughness={0}
                />
              </mesh>
              <mesh position={[0.008, -0.008, 0.056]}>
                <sphereGeometry args={[0.006, 8, 6]} />
                <meshStandardMaterial
                  color="white"
                  emissive="white"
                  emissiveIntensity={0.7}
                  roughness={0}
                  transparent
                  opacity={0.8}
                />
              </mesh>
              {/* Upper eyelid */}
              <mesh
                position={[0, 0.028, 0.032]}
                rotation={[0.15, 0, Math.PI / 2]}
              >
                <capsuleGeometry args={[0.027, 0.064, 8, 12]} />
                <meshStandardMaterial
                  color={skinDark}
                  transparent
                  opacity={0.55}
                  roughness={0.75}
                />
              </mesh>
              {/* Lower eyelid */}
              <mesh
                position={[0, -0.022, 0.028]}
                rotation={[-0.1, 0, Math.PI / 2]}
              >
                <capsuleGeometry args={[0.024, 0.058, 8, 12]} />
                <meshStandardMaterial
                  color={skin}
                  transparent
                  opacity={0.4}
                  roughness={0.8}
                />
              </mesh>

              {/* Eyelashes (female) */}
              {gender === "female" ? (
                <mesh
                  position={[0.006, 0.028, 0.06]}
                  rotation={[0.1, 0, Math.PI / 2 - 0.25]}
                >
                  <capsuleGeometry args={[0.006, 0.06, 6, 10]} />
                  <meshStandardMaterial color={hair} roughness={0.6} />
                </mesh>
              ) : null}
            </group>

            {/* Eyebrows - Sims style more curved and expressive */}
            <group position={[-0.11, 0.11, 0.22]} rotation={[0, 0, -0.15]}>
              <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.014, 0.06, 8, 12]} />
                <meshStandardMaterial color={hair} roughness={0.9} />
              </mesh>
            </group>
            <group position={[0.11, 0.11, 0.22]} rotation={[0, 0, 0.15]}>
              <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.014, 0.06, 8, 12]} />
                <meshStandardMaterial color={hair} roughness={0.9} />
              </mesh>
            </group>

            {/* Lips - Sims style fuller and more defined */}
            <mesh position={[0, -0.14, 0.24]}>
              <sphereGeometry
                args={[0.048, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]}
                scale={[1.2, 0.75, 0.8]}
              />
              <meshStandardMaterial color={lips} roughness={0.5} />
            </mesh>
            {/* Lip definition */}
            <mesh
              position={[0, -0.132, 0.256]}
              rotation={[1.35, 0, Math.PI / 2]}
            >
              <capsuleGeometry args={[0.006, 0.052, 6, 10]} />
              <meshStandardMaterial
                color={lipsDark}
                transparent
                opacity={0.6}
                roughness={0.6}
              />
            </mesh>
            {/* Lip shine */}
            <mesh position={[0, -0.14, 0.26]}>
              <sphereGeometry args={[0.022, 12, 10]} scale={[1.3, 0.6, 0.5]} />
              <meshStandardMaterial
                color="white"
                transparent
                opacity={0.2}
                roughness={0.2}
              />
            </mesh>

            {/* Chin - Sims style rounded */}
            <mesh position={[0, -0.2, 0.2]} castShadow>
              <sphereGeometry args={[0.065, 14, 12]} scale={[1, 1.1, 0.9]} />
              <meshStandardMaterial
                color={skin}
                transparent
                opacity={0.35}
                roughness={0.7}
              />
            </mesh>
          </group>
        </group>

        {/* Legs - Sims 4 style shorter and more stylized */}
        <group
          ref={legLRef}
          position={[-0.09, 0.02, 0]}
          scale={[legScale, 1, legScale]}
        >
          {/* Hip joint */}
          <mesh castShadow>
            <sphereGeometry args={[0.08, 14, 12]} />
            <meshStandardMaterial color={pants} roughness={0.78} />
          </mesh>
          {/* Upper leg - shorter for Sims proportions */}
          <mesh position={[0, -0.18, 0]} castShadow>
            <capsuleGeometry args={[0.08, 0.3, 12, 18]} />
            <meshStandardMaterial color={pants} roughness={0.76} />
          </mesh>
          {/* Knee */}
          <mesh position={[0, -0.36, 0]} castShadow>
            <sphereGeometry args={[0.07, 12, 14]} />
            <meshStandardMaterial color={pants} roughness={0.78} />
          </mesh>
          {/* Lower leg - shorter */}
          <mesh position={[0, -0.5, 0]} castShadow>
            <capsuleGeometry args={[0.06, 0.24, 12, 16]} />
            <meshStandardMaterial color={pants} roughness={0.8} />
          </mesh>
          {/* Ankle */}
          <mesh position={[0, -0.64, 0]} castShadow>
            <sphereGeometry args={[0.052, 12, 12]} />
            <meshStandardMaterial color={skin} roughness={0.72} />
          </mesh>
          {/* Foot - simplified Sims style */}
          <mesh
            position={[0, -0.69, 0.06]}
            rotation={[-0.1, 0, Math.PI / 2]}
            castShadow
          >
            <capsuleGeometry args={[0.055, 0.11, 10, 14]} />
            <meshStandardMaterial color={shoes} roughness={0.68} />
          </mesh>
          <mesh position={[0, -0.72, 0.11]} castShadow>
            <sphereGeometry args={[0.058, 12, 12]} scale={[1, 0.8, 1.3]} />
            <meshStandardMaterial color={shoes} roughness={0.7} />
          </mesh>
        </group>

        <group
          ref={legRRef}
          position={[0.09, 0.02, 0]}
          scale={[legScale, 1, legScale]}
        >
          {/* Hip joint */}
          <mesh castShadow>
            <sphereGeometry args={[0.08, 14, 12]} />
            <meshStandardMaterial color={pants} roughness={0.78} />
          </mesh>
          {/* Upper leg - shorter for Sims proportions */}
          <mesh position={[0, -0.18, 0]} castShadow>
            <capsuleGeometry args={[0.08, 0.3, 12, 18]} />
            <meshStandardMaterial color={pants} roughness={0.76} />
          </mesh>
          {/* Knee */}
          <mesh position={[0, -0.36, 0]} castShadow>
            <sphereGeometry args={[0.07, 12, 14]} />
            <meshStandardMaterial color={pants} roughness={0.78} />
          </mesh>
          {/* Lower leg - shorter */}
          <mesh position={[0, -0.5, 0]} castShadow>
            <capsuleGeometry args={[0.06, 0.24, 12, 16]} />
            <meshStandardMaterial color={pants} roughness={0.8} />
          </mesh>
          {/* Ankle */}
          <mesh position={[0, -0.64, 0]} castShadow>
            <sphereGeometry args={[0.052, 12, 12]} />
            <meshStandardMaterial color={skin} roughness={0.72} />
          </mesh>
          {/* Foot - simplified Sims style */}
          <mesh
            position={[0, -0.69, 0.06]}
            rotation={[-0.1, 0, Math.PI / 2]}
            castShadow
          >
            <capsuleGeometry args={[0.055, 0.11, 10, 14]} />
            <meshStandardMaterial color={shoes} roughness={0.68} />
          </mesh>
          <mesh position={[0, -0.72, 0.11]} castShadow>
            <sphereGeometry args={[0.058, 12, 12]} scale={[1, 0.8, 1.3]} />
            <meshStandardMaterial color={shoes} roughness={0.7} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function SelfAvatar({
  color,
  name,
  pos,
  rotY,
  speed,
  gender,
  avatarUrl,
  sittingRef,
  bubbleText,
}: {
  color: string;
  name: string;
  pos: React.RefObject<THREE.Vector3>;
  rotY: React.RefObject<number>;
  speed: React.RefObject<number>;
  gender: "male" | "female";
  avatarUrl?: string;
  sittingRef?: React.RefObject<boolean>;
  bubbleText?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [movingSpeed, setMovingSpeed] = useState(0);
  const [pose, setPose] = useState<"stand" | "sit">("stand");
  const lastPoseRef = useRef<"stand" | "sit">("stand");
  const speedUiAccumulatorRef = useRef(0);
  const lastSpeedUiRef = useRef(0);

  useFrame((_state, dt) => {
    const g = groupRef.current;
    const p = pos.current;
    if (!g || !p) return;
    g.position.set(p.x, p.y, p.z);

    // Smooth rotation with shortest path interpolation
    let diff = rotY.current - g.rotation.y;
    // Normalize to -PI...PI
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    g.rotation.y += diff * 0.15;

    // Avoid a React state update every frame.
    speedUiAccumulatorRef.current += dt;
    if (speedUiAccumulatorRef.current >= 0.1) {
      speedUiAccumulatorRef.current = 0;
      const nextSpeed = Number.isFinite(speed.current) ? speed.current : 0;
      if (Math.abs(nextSpeed - lastSpeedUiRef.current) > 0.02) {
        lastSpeedUiRef.current = nextSpeed;
        setMovingSpeed(nextSpeed);
      }
    }

    const nextPose = sittingRef?.current ? "sit" : "stand";
    if (nextPose !== lastPoseRef.current) {
      lastPoseRef.current = nextPose;
      setPose(nextPose);
    }
  });

  return (
    <group ref={groupRef}>
      {bubbleText ? <SpeechBubble text={bubbleText} /> : null}
      <PlayerAvatar
        id={name}
        movingSpeed={movingSpeed}
        gender={gender}
        url={avatarUrl}
        pose={pose}
      />
    </group>
  );
}

const SpeechBubble = memo(({ text }: { text: string }) => {
  const t = (text ?? "").toString();
  // Estimate lines more generously and allow more lines
  const approxLines = Math.max(1, Math.min(10, Math.ceil(t.length / 26)));
  const width = clamp(0.9 + t.length * 0.045, 1.2, 3.6);
  // Allow height to grow larger
  const height = clamp(0.42 + (approxLines - 1) * 0.22, 0.42, 2.5);

  const { shape, points } = useMemo(() => {
    const s = new THREE.Shape();
    const r = 0.15; // corner radius
    const w = width;
    const h = height;
    const x = -w / 2;
    const y = 0;

    const tailWidth = 0.2;
    const tailHeight = 0.2;

    // Start at top-left corner (after curve)
    s.moveTo(x, y + h - r);

    // Top edge
    s.lineTo(x, y + h - r);
    s.quadraticCurveTo(x, y + h, x + r, y + h);
    s.lineTo(x + w - r, y + h);
    s.quadraticCurveTo(x + w, y + h, x + w, y + h - r);

    // Right edge
    s.lineTo(x + w, y + r);
    s.quadraticCurveTo(x + w, y, x + w - r, y);

    // Bottom edge with tail
    s.lineTo(tailWidth / 2, y);
    s.lineTo(0, y - tailHeight); // Tail tip
    s.lineTo(-tailWidth / 2, y); // Left side of tail

    // Continue to bottom-left corner
    s.lineTo(x + r, y);
    s.quadraticCurveTo(x, y, x, y + r);

    // Close loop (left edge)
    s.lineTo(x, y + h - r);

    const p = s
      .getPoints()
      .map((v) => [v.x, v.y, 0] as [number, number, number]);
    return { shape: s, points: p };
  }, [width, height]);

  return (
    <Billboard position={[0, 2.62, 0]}>
      <group position={[0, 0.2, 0]}>
        {/* Bubble Body & Tail */}
        <mesh>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.95}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>

        {/* Outline */}
        <Line
          points={points}
          color="black"
          lineWidth={2}
          position={[0, 0, 0.002]}
          transparent
          opacity={0.8}
        />

        {/* Text */}
        <Text
          position={[0, height * 0.5, 0.01]}
          fontSize={0.18}
          color="#1a1a1a"
          anchorX="center"
          anchorY="middle"
          maxWidth={Math.max(0.6, width - 0.25)}
          textAlign="center"
          renderOrder={100}
        >
          {t}
        </Text>
      </group>
    </Billboard>
  );
});

const RemoteAvatar = memo(function RemoteAvatar({
  id,
  name,
  color,
  targetPosition,
  targetRotY,
  gender,
  avatarUrl,
  bubbleText,
}: {
  id: string;
  name: string;
  color: string;
  targetPosition: Vec3;
  targetRotY: number;
  gender: "male" | "female";
  avatarUrl?: string;
  bubbleText?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const posRef = useRef<THREE.Vector3>(
    new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2])
  );
  const rotRef = useRef<number>(targetRotY);
  const targetRef = useRef<THREE.Vector3>(
    new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2])
  );
  const lastPosRef = useRef<THREE.Vector3>(posRef.current.clone());
  const speedRef = useRef<number>(0);
  const [movingSpeed, setMovingSpeed] = useState(0);
  const speedUiAccumulatorRef = useRef(0);
  const lastSpeedUiRef = useRef(0);
  const [distance, setDistance] = useState(0);
  const distanceCheckRef = useRef(0);

  useFrame((_state, dt) => {
    const g = groupRef.current;
    if (!g) return;

    const alpha = 1 - Math.pow(0.001, dt); // frame-rate independent smoothing
    targetRef.current.set(
      targetPosition[0],
      targetPosition[1],
      targetPosition[2]
    );
    posRef.current.lerp(targetRef.current, alpha);

    // shortest angle lerp
    let d = targetRotY - rotRef.current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    rotRef.current = rotRef.current + d * alpha;

    g.position.set(posRef.current.x, posRef.current.y, posRef.current.z);
    // Apply smooth rotation to visual
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rotRef.current, 0.2);

    // estimate speed
    const dx = posRef.current.x - lastPosRef.current.x;
    const dy = posRef.current.y - lastPosRef.current.y;
    const dz = posRef.current.z - lastPosRef.current.z;
    const sp = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.0001, dt);
    speedRef.current = THREE.MathUtils.lerp(
      speedRef.current,
      sp,
      clamp(dt * 8, 0, 1)
    );
    lastPosRef.current.copy(posRef.current);

    // Avoid a React state update every frame.
    speedUiAccumulatorRef.current += dt;
    if (speedUiAccumulatorRef.current >= 0.1) {
      speedUiAccumulatorRef.current = 0;
      const nextSpeed = Number.isFinite(speedRef.current)
        ? speedRef.current
        : 0;
      if (Math.abs(nextSpeed - lastSpeedUiRef.current) > 0.02) {
        lastSpeedUiRef.current = nextSpeed;
        setMovingSpeed(nextSpeed);
      }
    }

    // Check distance every 0.5 seconds for LOD
    distanceCheckRef.current += dt;
    if (distanceCheckRef.current > 0.5) {
      distanceCheckRef.current = 0;
      const dist = Math.sqrt(
        posRef.current.x * posRef.current.x +
          posRef.current.y * posRef.current.y +
          posRef.current.z * posRef.current.z
      );
      setDistance(dist);
    }
  });

  return (
    <group ref={groupRef}>
      {distance < 30 ? (
        <Billboard position={[0, 2.25, 0]}>
          <Text
            fontSize={0.22}
            color={color}
            outlineWidth={0.012}
            outlineColor="rgba(0,0,0,0.65)"
            anchorX="center"
            anchorY="bottom"
            maxWidth={3.4}
            textAlign="center"
            renderOrder={100}
          >
            {name || id.slice(0, 4)}
          </Text>
        </Billboard>
      ) : null}

      {bubbleText ? <SpeechBubble text={bubbleText} /> : null}

      <PlayerAvatar
        id={id}
        movingSpeed={movingSpeed}
        gender={gender}
        url={avatarUrl}
      />
    </group>
  );
});

function FollowCamera({
  target,
  lookAtOverride,
  orbitApiRef,
  rotateModeRef,
  suppressRightDragRef,
  povMode,
  yawRef,
  setPovMode,
}: {
  target: React.RefObject<THREE.Vector3>;
  lookAtOverride?: React.RefObject<THREE.Vector3 | null>;
  orbitApiRef?: React.MutableRefObject<{
    rotateByPixels: (dx: number, dy: number) => void;
  } | null>;
  rotateModeRef?: React.MutableRefObject<boolean>;
  suppressRightDragRef?: React.MutableRefObject<boolean>;
  povMode?: boolean;
  yawRef?: React.RefObject<number>;
  setPovMode?: (next: boolean) => void;
}) {
  const { gl } = useThree();
  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ dist: number; radius: number } | null>(null);
  const touchIdsRef = useRef<Set<number>>(new Set());

  // Reused vectors to avoid per-frame allocations (reduces GC stutter).
  const povForwardRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const desiredPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const lookAtPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const orbitOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // POV orientation (yaw/pitch) controlled by drag.
  const povYawRef = useRef(0);
  const povPitchRef = useRef(0);
  const povModeRef = useRef(!!povMode);

  const setPovModeRef = useRef<((next: boolean) => void) | undefined>(
    setPovMode
  );

  // Cache the orbit camera's forward direction so POV entry aligns with what you're looking at.
  const lastOrbitDirRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, -1));

  useEffect(() => {
    povModeRef.current = !!povMode;
  }, [povMode]);

  useEffect(() => {
    setPovModeRef.current = setPovMode;
  }, [setPovMode]);

  useEffect(() => {
    if (!povMode) return;
    // When entering POV, initialize to the current camera direction if available,
    // otherwise fall back to the avatar's facing direction.
    const d = lastOrbitDirRef.current;
    if (Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)) {
      povYawRef.current = Math.atan2(d.x, d.z);
      povPitchRef.current = clamp(Math.asin(clamp(d.y, -1, 1)), -1.2, 1.2);
    } else {
      povYawRef.current = yawRef?.current ?? povYawRef.current;
      povPitchRef.current = 0;
    }
  }, [povMode, yawRef]);

  // Camera orbit state (spherical)
  const thetaRef = useRef(0); // azimuth around Y
  const phiRef = useRef(1.06); // polar from +Y (matches ~[0,4.5,8])
  const radiusRef = useRef(9.2);

  useEffect(() => {
    if (!orbitApiRef) return;
    const rotSpeed = 0.004;

    orbitApiRef.current = {
      rotateByPixels: (dx: number, dy: number) => {
        if (povModeRef.current) {
          povYawRef.current -= dx * rotSpeed;
          povPitchRef.current = clamp(
            povPitchRef.current - dy * rotSpeed,
            -1.2,
            1.2
          );
          return;
        }

        thetaRef.current -= dx * rotSpeed;
        phiRef.current = clamp(phiRef.current - dy * rotSpeed, 0.45, 1.45);
      },
    };

    return () => {
      orbitApiRef.current = null;
    };
  }, [orbitApiRef]);

  useEffect(() => {
    const el = gl.domElement;

    const prevTouchAction = el.style.touchAction;
    // Allows us to preventDefault() reliably for pinch/scroll gestures.
    el.style.touchAction = "none";

    const MIN_RADIUS = 3.5;
    const MAX_RADIUS = 18;

    const clampRadius = (r: number) => clamp(r, MIN_RADIUS, MAX_RADIUS);

    const getTouchDist = (t0: Touch, t1: Touch) => {
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      // Desktop: right mouse drag rotates camera.
      // Optional: when rotateModeRef is enabled, left drag rotates too.
      if (e.pointerType !== "touch") {
        const rotateMode = rotateModeRef?.current ?? false;
        if (rotateMode) {
          if (e.button !== 0 && e.button !== 2) return;
        } else {
          if (e.button !== 2) return;
        }
        draggingRef.current = true;
        lastRef.current = { x: e.clientX, y: e.clientY };
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }

      // Mobile: one-finger drag rotates camera.
      touchIdsRef.current.add(e.pointerId);
      if (touchIdsRef.current.size !== 1) {
        // If a second finger is down, stop orbit drag (pinch zoom takes over).
        draggingRef.current = false;
        lastRef.current = null;
        return;
      }

      draggingRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        if (!draggingRef.current) return;

        const rotateMode = rotateModeRef?.current ?? false;
        if (rotateMode) {
          if (e.button !== 0 && e.button !== 2) return;
        } else {
          if (e.button !== 2) return;
        }

        draggingRef.current = false;
        lastRef.current = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }

      touchIdsRef.current.delete(e.pointerId);
      if (touchIdsRef.current.size === 0) {
        draggingRef.current = false;
        lastRef.current = null;
      }
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;

      // If something (like 4P arrow indicators) is using right-drag,
      // cancel camera rotation for this drag.
      if (
        suppressRightDragRef?.current &&
        e.pointerType !== "touch" &&
        (e.buttons & 2) === 2
      ) {
        draggingRef.current = false;
        lastRef.current = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }

      if (e.pointerType === "touch") {
        // Only rotate on single-finger drag.
        if (touchIdsRef.current.size !== 1) return;
      }
      const last = lastRef.current;
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      lastRef.current = { x: e.clientX, y: e.clientY };

      const rotSpeed = 0.004;
      if (povModeRef.current) {
        povYawRef.current -= dx * rotSpeed;
        povPitchRef.current = clamp(
          povPitchRef.current - dy * rotSpeed,
          -1.2,
          1.2
        );
        return;
      }

      thetaRef.current -= dx * rotSpeed;
      phiRef.current = clamp(phiRef.current - dy * rotSpeed, 0.45, 1.45);
    };

    const wheelOptions: AddEventListenerOptions = { passive: false };
    const onWheel = (e: WheelEvent) => {
      // Keep the page from scrolling while zooming over the canvas.
      e.preventDefault();

      // Trackpads and wheels vary; an exponential scale feels consistent.
      const zoomSpeed = 0.0015;
      const factor = Math.exp(e.deltaY * zoomSpeed);
      radiusRef.current = clampRadius(radiusRef.current * factor);

      // Auto-enter POV when zooming in close, and auto-exit when zooming out.
      // Hysteresis avoids toggling back/forth on tiny wheel movements.
      const POV_ENTER_RADIUS = 3.7;
      const POV_EXIT_RADIUS = 4.4;
      const isPov = povModeRef.current;
      if (!isPov && radiusRef.current <= POV_ENTER_RADIUS) {
        setPovModeRef.current?.(true);
      } else if (isPov && radiusRef.current >= POV_EXIT_RADIUS) {
        setPovModeRef.current?.(false);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      // Prevent browser pinch-zoom on the page.
      e.preventDefault();
      pinchRef.current = {
        dist: getTouchDist(e.touches[0], e.touches[1]),
        radius: radiusRef.current,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const pinch = pinchRef.current;
      if (!pinch) return;
      e.preventDefault();

      const nextDist = getTouchDist(e.touches[0], e.touches[1]);
      if (pinch.dist <= 0) return;

      // Pinch out (bigger dist) => zoom in (smaller radius)
      const scale = nextDist / pinch.dist;
      radiusRef.current = clampRadius(pinch.radius / scale);
    };

    const onTouchEnd = () => {
      pinchRef.current = null;
    };

    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("wheel", onWheel, wheelOptions);
    el.addEventListener("touchstart", onTouchStart, wheelOptions);
    el.addEventListener("touchmove", onTouchMove, wheelOptions);
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("wheel", onWheel, wheelOptions as any);
      el.removeEventListener("touchstart", onTouchStart, wheelOptions as any);
      el.removeEventListener("touchmove", onTouchMove, wheelOptions as any);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);

      el.style.touchAction = prevTouchAction;
    };
  }, [gl]);

  useFrame(({ camera }, dt) => {
    const t = target.current;
    if (!t) return;

    if (povMode) {
      const eyeHeight = 1.55;

      const yaw = povYawRef.current;
      const pitch = povPitchRef.current;
      const cy = Math.cos(pitch);
      const forward = povForwardRef.current;
      forward.set(Math.sin(yaw) * cy, Math.sin(pitch), Math.cos(yaw) * cy);

      const desired = desiredPosRef.current;
      desired.set(t.x, t.y + eyeHeight, t.z);
      camera.position.lerp(desired, clamp(dt * 14, 0, 1));

      const lookAt = lookAtPosRef.current;
      lookAt.copy(desired).add(forward);
      camera.lookAt(lookAt);
      return;
    }

    // Use lookAtOverride as orbit center when watching a board
    const orbitCenter = lookAtOverride?.current || t;

    const offset = orbitOffsetRef.current;
    offset.setFromSphericalCoords(
      radiusRef.current,
      phiRef.current,
      thetaRef.current
    );

    const desired = desiredPosRef.current;
    desired.set(orbitCenter.x, orbitCenter.y, orbitCenter.z).add(offset);
    camera.position.lerp(desired, clamp(dt * 6, 0, 1));
    camera.lookAt(orbitCenter.x, orbitCenter.y + 1.0, orbitCenter.z);

    // Cache direction so POV entry can align with current camera heading.
    camera.getWorldDirection(lastOrbitDirRef.current);
  });

  return null;
}

// FPS Tracker Component
function FpsTracker({
  labelRef,
}: {
  labelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lastSampleMsRef = useRef(0);
  const framesSinceSampleRef = useRef(0);
  const lastReportedFpsRef = useRef(-1);

  useFrame(() => {
    const now = performance.now();
    framesSinceSampleRef.current += 1;

    const last = lastSampleMsRef.current;
    if (last === 0) {
      lastSampleMsRef.current = now;
      framesSinceSampleRef.current = 0;
      return;
    }

    // Throttle React updates: sample ~4 times/sec.
    const elapsed = now - last;
    if (elapsed < 250) return;

    const fpsNow = Math.round((framesSinceSampleRef.current * 1000) / elapsed);
    framesSinceSampleRef.current = 0;
    lastSampleMsRef.current = now;

    // Avoid redundant DOM updates.
    if (fpsNow === lastReportedFpsRef.current) return;
    lastReportedFpsRef.current = fpsNow;

    const el = labelRef.current;
    if (!el) return;
    el.textContent = `FPS: ${fpsNow}`;
  });

  return null;
}

const DEBUG_AVATAR_URLS = {
  defaultMale: "/three-avatar/avatars/default_male.vrm",
  cherryRoseOptimized5mb: "/three-avatar/avatars/cherry_rose_optimized_5mb.vrm",
  kawaiiOptimized5mb: "/three-avatar/avatars/kawaii_optimized_5mb.vrm",
  fuyukiOptimized: "/three-avatar/avatars/fuyuki_optimized_5mb.vrm",
  miuOptimized: "/three-avatar/avatars/miu_optimized_5mb.vrm",
  renOptimized7mb: "/three-avatar/avatars/ren_optimized_7mb.vrm",
  defaultFemale: "/three-avatar/asset/avatar-example/default_female.vrm",
  vrmV0: "/three-avatar/asset/avatar-example/vrm-v0.vrm",
  rpm: "/three-avatar/asset/avatar-example/rpm.glb",
} as const;

const SHOP_ITEMS = [
  {
    id: "default_male",
    name: "Default Male",
    url: DEBUG_AVATAR_URLS.defaultMale,
    price: 0,
    type: "avatar",
  },
  {
    id: "default_female",
    name: "Default Female",
    url: DEBUG_AVATAR_URLS.defaultFemale,
    price: 0,
    type: "avatar",
  },
  {
    id: "kawaii",
    name: "Kawaii",
    url: DEBUG_AVATAR_URLS.kawaiiOptimized5mb,
    price: 200,
    type: "avatar",
  },
  {
    id: "ren",
    name: "Ren",
    url: DEBUG_AVATAR_URLS.renOptimized7mb,
    price: 200,
    type: "avatar",
  },
  {
    id: "cherry",
    name: "Cherry Rose",
    url: DEBUG_AVATAR_URLS.cherryRoseOptimized5mb,
    price: 800,
    type: "avatar",
  },
  {
    id: "fuyuki",
    name: "Fuyuki",
    url: DEBUG_AVATAR_URLS.fuyukiOptimized,
    price: 800,
    type: "avatar",
  },
  {
    id: "miu",
    name: "Miu",
    url: DEBUG_AVATAR_URLS.miuOptimized,
    price: 1200,
    type: "avatar",
  },
  {
    id: "theme_park",
    name: "Park World",
    url: "",
    price: 0,
    type: "theme",
    previewImage: "/shop/theme-park.png",
  },
  {
    id: "theme_scifi",
    name: "Sci-Fi World",
    url: "",
    price: 1200,
    type: "theme",
    previewImage: "/shop/theme-scifi.png",
  },
  {
    id: "chess_wood",
    name: "Wood Chess Set",
    url: "",
    price: 0,
    type: "chess",
    chessKind: "set",
  },
  {
    id: "chess_marble",
    name: "Marble Chess Set",
    url: "",
    price: 200,
    type: "chess",
    chessKind: "set",
  },
  {
    id: "chess_glass",
    name: "Glass Chess Set",
    url: "",
    price: 300,
    type: "chess",
    chessKind: "set",
  },
  {
    id: "chess_gold",
    name: "Gold Chess Set",
    url: "",
    price: 400,
    type: "chess",
    chessKind: "set",
  },
  {
    id: "board_classic",
    name: "Classic Chess Board",
    url: "",
    price: 0,
    type: "chess",
    chessKind: "board",
  },
  {
    id: "board_marble",
    name: "Marble Chess Board",
    url: "",
    price: 200,
    type: "chess",
    chessKind: "board",
  },
  {
    id: "board_neon",
    name: "Neon Chess Board",
    url: "",
    price: 300,
    type: "chess",
    chessKind: "board",
  },
] as const;

function normalizeOwnedItemIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    // If it's already a stable ID, keep it.
    if (SHOP_ITEMS.some((i) => i.id === v)) {
      out.push(v);
      continue;
    }
    // Back-compat: map avatar URL -> its item ID.
    const avatarMatch = SHOP_ITEMS.find(
      (i) => i.type === "avatar" && i.url && i.url === v
    );
    if (avatarMatch) {
      out.push(avatarMatch.id);
      continue;
    }
    // Unknown string (future item ID or other identifier): keep.
    out.push(v);
  }
  return Array.from(new Set(out));
}

type BoardControlsOpen = {
  type: "open";
  boardKey: string;
  lobby: "scifi" | "park";
  timeMinutes: number;
  incrementSeconds: number;
  fen: string;
  mySide: "w" | "b" | null;
  turn: "w" | "b";
  boardOrientation: "white" | "black";
  canMove2d: boolean;
  chess4Variant?: "2v2" | "ffa";
  canSetChess4Variant?: boolean;
  onSetChess4Variant?: (variant: "2v2" | "ffa") => void;
  chess4Scores?: Record<"r" | "g" | "y" | "b", number>;
  chess4Claimable?: {
    leader: "r" | "g" | "y" | "b";
    runnerUp: "r" | "g" | "y" | "b";
    lead: number;
  } | null;
  chess4CanClaimWin?: boolean;
  onChess4ClaimWin?: () => void;
  gooseSquare?: string;
  goosePhase?: "piece" | "goose";
  startledSquares?: string[];
  canPlaceGoose?: boolean;
  onPlaceGoose?: (sq: string) => boolean;
  checkersBoard?: Record<string, { color: "w" | "b"; king: boolean }>;
  canInc: boolean;
  canDec: boolean;
  canIncIncrement: boolean;
  canDecIncrement: boolean;
  canReset: boolean;
  canCenter: boolean;
  onMove2d: (
    from: string,
    to: string,
    promotion?: "q" | "r" | "b" | "n"
  ) => boolean;
  onInc: () => void;
  onDec: () => void;
  onIncIncrement: () => void;
  onDecIncrement: () => void;
  onReset: () => void;
  onCenter: () => void;
};

type Board2dSync = {
  type: "sync2d";
  boardKey: string;
  lobby: "scifi" | "park";
  fen: string;
  mySide: "w" | "b" | null;
  turn: "w" | "b";
  boardOrientation: "white" | "black";
  canMove2d: boolean;
  gooseSquare?: string;
  goosePhase?: "piece" | "goose";
  startledSquares?: string[];
  canPlaceGoose?: boolean;
  onPlaceGoose?: (sq: string) => boolean;
  checkersBoard?: Record<string, { color: "w" | "b"; king: boolean }>;
  onMove2d: (
    from: string,
    to: string,
    promotion?: "q" | "r" | "b" | "n"
  ) => boolean;
};

type BoardControlsEvent =
  | BoardControlsOpen
  | Board2dSync
  | { type: "close"; boardKey?: string };

function toLegacyOwnedAvatarsValues(ownedItemIds: string[]): string[] {
  const out: string[] = [];
  for (const id of ownedItemIds) {
    out.push(id);
    const item = SHOP_ITEMS.find((i) => i.id === id);
    if (item?.type === "avatar" && item.url) out.push(item.url);
  }
  return Array.from(new Set(out));
}

function isShopItemOwned(
  item: (typeof SHOP_ITEMS)[number],
  ownedItemIds: string[]
) {
  // Treat all price=0 items as always owned (defaults), even if not in DB.
  if (item.price === 0) return true;
  if (ownedItemIds.includes(item.id)) return true;
  // Back-compat: some rows historically stored avatar URLs.
  if (item.url && ownedItemIds.includes(item.url)) return true;
  return false;
}

const COIN_PACKS = [
  { id: "p80", coins: 200, priceLabel: "$1" },
  { id: "p450", coins: 1200, priceLabel: "$5" },
  { id: "p1000", coins: 3000, priceLabel: "$10" },
] as const;

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const SHOP_TAB_STORAGE_KEY = "pawnsquare:shopTab";

function isShopItemLocked(
  item: (typeof SHOP_ITEMS)[number],
  ownedItemIds: string[]
): boolean {
  // All items are directly purchasable
  return false;
}

function SelfSimulation({
  enabled,
  keysRef,
  pos,
  rotY,
  lastSent,
  sendSelfState,
  speedRef,
  moveTargetRef,
  sittingRef,
  lookAtTargetRef,
}: {
  enabled: boolean;
  keysRef: ReturnType<typeof useWASDKeys>;
  pos: React.RefObject<THREE.Vector3>;
  rotY: React.RefObject<number>;
  lastSent: React.RefObject<{ t: number; p: Vec3; r: number }>;
  sendSelfState: (position: Vec3, rotY: number) => void;
  speedRef: React.RefObject<number>;
  moveTargetRef: React.RefObject<{
    dest: Vec3;
    rotY?: number;
    sit?: boolean;
    sitDest?: Vec3;
    lookAtTarget?: Vec3;
  } | null>;
  sittingRef: React.RefObject<boolean>;
  lookAtTargetRef: React.RefObject<THREE.Vector3 | null>;
}) {
  const vRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const camDirRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const forwardRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const rightRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const upRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
  const lastPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const aligningToSitStartRef = useRef<number | null>(null);

  useFrame((state, dt) => {
    if (!enabled) return;

    const keys = keysRef.current;
    const v = vRef.current;
    const inputForward = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    const inputRight = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

    const hasKeyboardInput = inputForward !== 0 || inputRight !== 0;
    if (hasKeyboardInput) {
      // Keyboard input always cancels click-to-move and standing up from sitting.
      moveTargetRef.current = null;
      aligningToSitStartRef.current = null;
      lookAtTargetRef.current = null; // Clear camera override
      if (sittingRef.current && process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[sit] canceled via keyboard");
      }
      sittingRef.current = false;
    }

    // If we're sitting, ignore movement until user provides input or click-to-move sets a target.
    if (sittingRef.current && !hasKeyboardInput && !moveTargetRef.current) {
      speedRef.current = THREE.MathUtils.lerp(
        speedRef.current,
        0,
        clamp(dt * 10, 0, 1)
      );
      lastPosRef.current.copy(pos.current);
      return;
    }

    // Camera-relative movement (horizontal plane only)
    const camDir = camDirRef.current;
    state.camera.getWorldDirection(camDir);
    const forward = forwardRef.current;
    forward.set(camDir.x, 0, camDir.z);
    if (forward.lengthSq() < 1e-6) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }
    const right = rightRef.current;
    right.crossVectors(forward, upRef.current).normalize();

    v.set(0, 0, 0);
    if (hasKeyboardInput) {
      v.copy(forward)
        .multiplyScalar(inputForward)
        .addScaledVector(right, inputRight);
    } else if (moveTargetRef.current) {
      const d = moveTargetRef.current.dest;
      v.set(d[0] - pos.current.x, 0, d[2] - pos.current.z);
      const dist = v.length();

      // Check if we are in the "aligning" phase of sitting
      if (aligningToSitStartRef.current !== null) {
        // Force position to target while turning
        pos.current.set(d[0], pos.current.y, d[2]);
        v.set(0, 0, 0);

        // Wait for turn to complete (approx 0.5s)
        if (state.clock.elapsedTime - aligningToSitStartRef.current > 0.5) {
          // Snap to sitDest if available
          if (moveTargetRef.current?.sitDest) {
            const sd = moveTargetRef.current.sitDest;
            pos.current.set(sd[0], pos.current.y, sd[2]);
          }

          sittingRef.current = true;
          // Set camera lookAt target if provided
          if (moveTargetRef.current?.lookAtTarget) {
            const lat = moveTargetRef.current.lookAtTarget;
            if (!lookAtTargetRef.current) {
              lookAtTargetRef.current = new THREE.Vector3(
                lat[0],
                lat[1],
                lat[2]
              );
            } else {
              lookAtTargetRef.current.set(lat[0], lat[1], lat[2]);
            }
          }
          moveTargetRef.current = null;
          aligningToSitStartRef.current = null;
        }
      } else if (dist < 0.25) {
        // Arrived at destination.
        pos.current.set(d[0], pos.current.y, d[2]);
        v.set(0, 0, 0);

        if (moveTargetRef.current.sit) {
          // Start aligning phase
          if (typeof moveTargetRef.current.rotY === "number") {
            rotY.current = moveTargetRef.current.rotY;
          }
          aligningToSitStartRef.current = state.clock.elapsedTime;
        } else {
          // Normal move end
          if (typeof moveTargetRef.current.rotY === "number") {
            rotY.current = moveTargetRef.current.rotY;
          }
          moveTargetRef.current = null;
        }
      }
    }

    const speed = 3.2;
    if (v.lengthSq() > 0) {
      // face movement direction (before scaling by dt)
      rotY.current = Math.atan2(v.x, v.z);

      v.normalize().multiplyScalar(speed * dt);
      pos.current.add(v);
    }

    // track movement speed for animation
    const dx = pos.current.x - lastPosRef.current.x;
    const dy = pos.current.y - lastPosRef.current.y;
    const dz = pos.current.z - lastPosRef.current.z;
    const sp = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.0001, dt);
    speedRef.current = THREE.MathUtils.lerp(
      speedRef.current,
      sp,
      clamp(dt * 10, 0, 1)
    );
    lastPosRef.current.copy(pos.current);

    // keep within a simple bounds box for the demo
    pos.current.x = clamp(pos.current.x, -18, 18);
    pos.current.z = clamp(pos.current.z, -18, 18);

    // network throttle
    const now = performance.now();
    const p: Vec3 = [pos.current.x, pos.current.y, pos.current.z];
    const r = rotY.current;
    const last = lastSent.current;

    const shouldSend =
      now - last.t > 90 ||
      distSq(p, last.p) > 0.0009 ||
      Math.abs(r - last.r) > 0.02;

    if (shouldSend) {
      lastSent.current = { t: now, p, r };
      sendSelfState(p, r);
    }
  });

  return null;
}

import { ParkLobby } from "@/components/park-lobby";
import { SciFiLobby, SciFiLamp } from "@/components/scifi-lobby";
import {
  ShopIcon,
  CloseIcon,
  UserIcon,
  PaletteIcon,
  ChessPieceIcon,
  ThemeIcon,
  CoinsIcon,
  MenuIcon,
  RotateArrowsIcon,
  GoogleIcon,
  DiscordIcon,
  PaperPlaneIcon,
} from "@/components/icons";
import { ChessBoardPreview } from "@/components/chess-board-preview";
import { LoadTestPanel } from "@/components/load-test-panel";

type TvWallScreen = {
  id: string;
  position: [number, number, number];
  rotationY: number;
  boardKey: string;
  shaderVariant?: "starfield" | "triangleTunnel";
};

type FenPiece = {
  color: "w" | "b";
  kind: "p" | "n" | "b" | "r" | "q" | "k";
};

function parseFenToSquareMap(fen: string): Record<string, FenPiece> {
  const out: Record<string, FenPiece> = {};
  const boardPart = (fen || "").split(" ")[0] || "";
  const rows = boardPart.split("/");
  if (rows.length !== 8) return out;

  for (let row = 0; row < 8; row++) {
    const r = rows[row] || "";
    let col = 0;
    for (const ch of r) {
      if (col >= 8) break;
      const code = ch.charCodeAt(0);
      if (code >= 48 && code <= 57) {
        col += Number(ch);
        continue;
      }
      const isWhite = ch === ch.toUpperCase();
      const kind = ch.toLowerCase() as FenPiece["kind"];
      if ("pnbrqk".includes(kind)) {
        const file = String.fromCharCode(97 + col);
        const rank = String(8 - row);
        out[`${file}${rank}`] = { color: isWhite ? "w" : "b", kind };
      }
      col += 1;
    }
  }
  return out;
}

function getTvBoardRectPx(W: number, H: number) {
  // Smaller padding so the board fills the screen more.
  const pad = 28;
  const inner = {
    x: pad,
    y: pad,
    w: W - pad * 2,
    h: H - pad * 2,
  };
  const boardSize = Math.min(inner.w, inner.h) - 12;
  const boardX = inner.x + (inner.w - boardSize) / 2;
  // Slightly bias down to leave room for the header badge.
  const boardY = inner.y + (inner.h - boardSize) / 2 + 8;
  return { inner, boardX, boardY, boardSize };
}

const TV_SPACE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Shared uniforms so all TV starfields animate in sync (and avoids cases where
// only one instance updates time).
const TV_SPACE_UNIFORMS: { uTime: { value: number } } = { uTime: { value: 0 } };

const TV_SPACE_FRAGMENT = /* glsl */ `
  // mediump is typically faster on mobile/low-end GPUs
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;

  #define TAU 6.28318530718
  #define PI 3.14159265359

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Smooth HSV to RGB (iq)
  vec3 hsv2rgb(in vec3 c) {
    vec3 rgb = clamp(
      abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
    rgb = rgb * rgb * (3.0 - 2.0 * rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
  }

  float star(vec2 uv, float flare) {
    float d = length(uv);
    float m = 0.03 / max(d, 0.0005);
    float rays = max(0.0, 0.5 - abs(uv.x * uv.y * 1000.0));
    m += rays * flare * 2.0;
    m *= smoothstep(1.0, 0.1, d);
    return m;
  }

  vec3 starLayer(vec2 uv) {
    vec3 col = vec3(0.0);
    vec2 gv = fract(uv) - 0.5;
    vec2 id = floor(uv);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offs = vec2(float(x), float(y));
        float n = hash21(id + offs);
        float size = fract(n);
        vec2 p = gv - offs - vec2(n, fract(n * 34.0)) + 0.5;
        float s = star(p, smoothstep(0.1, 0.9, size) * 0.46);
        // More saturated, fireworks-like star colors (cheap HSV).
        float hue = fract(n * 13.17 + (id.x + id.y) * 0.013 + uTime * 0.02);
        // Slightly less saturated/bright than the previous pass.
        float sat = mix(0.55, 0.88, smoothstep(0.35, 0.95, size));
        float val = mix(0.72, 1.05, smoothstep(0.55, 0.98, size));
        vec3 color = hsv2rgb(vec3(hue, sat, val));

        // Occasionally push a very bright, colorful "firework" sparkle.
        float fire = smoothstep(0.90, 0.995, size);
        color = mix(color, hsv2rgb(vec3(fract(hue + 0.33), 0.9, 1.18)), fire * 0.55);
        // twinkle
        s *= sin(uTime * 0.6 + n * TAU) * 0.5 + 0.5;
        col += s * (0.70 + 0.65 * fire) * size * color;
      }
    }
    return col;
  }

  void main() {
    // Convert to shadertoy-like UV: centered, aspect-correct
    vec2 uv = vUv;
    vec2 p = uv - 0.5;
    // Wide aspect (approx 6.35/3.6) for proper star shape
    float aspect = 6.35 / 3.6;
    p.x *= aspect;

    // Subtle camera drift
    vec2 drift = vec2(sin(uTime * 0.22), cos(uTime * 0.22)) * 0.05;

    // Background base
    float r = length(p);
    // Slightly brighter base so the screen doesn't read as "off".
    vec3 col = vec3(0.015, 0.014, 0.026);

    // Layered starfield (parallax)
    float t = uTime * 0.025;
    // Main perf knob: fewer layers = fewer shader ops per pixel.
    const float NUM_LAYERS = 5.0;
    for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYERS) {
      float depth = fract(i + t);
      float scale = mix(22.0, 0.8, depth);
      float fade = depth * smoothstep(1.0, 0.9, depth);
      vec2 suv = (p + drift) * scale + i * 453.2 - uTime * 0.05;
      col += starLayer(suv) * fade * 1.05;
    }

    // Soft nebula tint so it isn't just black + stars
    float neb = exp(-3.5 * r * r);
    col += vec3(0.07, 0.025, 0.10) * neb;
    col += vec3(0.016, 0.075, 0.13) * exp(-5.0 * (p.x + 0.35) * (p.x + 0.35) - 3.0 * p.y * p.y);

    // Vignette
    // Softer vignette so corners aren't crushed.
    float vig = smoothstep(1.15, 0.12, r);
    col *= vig;

    // Mild contrast boost
    // Slight brightness lift + saturation feel.
    col = pow(col, vec3(0.88));
    col *= 1.04;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Triangle tunnel background (optimized, TV-sized): inspired by the reference shader in
// src/ref/triangle-tunnel but adapted for our simple vUv + uTime setup.
const TV_TRIANGLE_TUNNEL_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;

  // 2D rotation
  mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  // Signed distance to an equilateral triangle (iq)
  float sdEquilateralTriangle(vec2 p) {
    const float k = 1.7320508075688772; // sqrt(3)
    p.x = abs(p.x) - 1.0;
    p.y = p.y + 1.0 / k;
    if (p.x + k * p.y > 0.0) {
      p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
    }
    p.x -= clamp(p.x, -2.0, 0.0);
    return -length(p) * sign(p.y);
  }

  vec3 palette(float t) {
    // Saturated neon-ish palette.
    vec3 a = vec3(0.55, 0.22, 0.72);
    vec3 b = vec3(0.70, 0.95, 0.55);
    vec3 c = vec3(1.00, 1.00, 1.00);
    vec3 d = vec3(0.00, 0.20, 0.55);
    return a + b * cos(6.2831853 * (c * t + d));
  }

  void main() {
    // Centered, aspect-correct coordinates.
    vec2 p = vUv - 0.5;
    float aspect = 6.35 / 3.6;
    p.x *= aspect;

    // Gentle camera drift.
    // Slow down the tunnel motion by 50%.
    float t = uTime * 0.5;
    p *= rot(0.12 * t);
    p += vec2(sin(t * 0.17), cos(t * 0.13)) * 0.04;

    // Brighter base so it reads vivid behind the board.
    vec3 col = vec3(0.016, 0.013, 0.030);

    // Layered tunnel rings. Main perf knob is NUM.
    const float NUM = 6.0;
    float tt = t * 0.17;
    for (float i = 0.0; i < 1.0; i += 1.0 / NUM) {
      float z = fract(i + tt);
      float depth = 1.0 - z;

      // Scale grows with depth to create a tunnel feel.
      float s = mix(0.85, 6.5, depth);
      vec2 q = p * s;
      q *= rot(t * 0.35 + i * 9.0);

      // Triangle distance: thin glowing edges.
      float d = abs(sdEquilateralTriangle(q));
      float glow = exp(-d * 9.5);
      // Add subtle streaking along edges.
      float streak = 0.5 + 0.5 * sin(8.0 * (q.x + q.y) + t * 1.3 + i * 7.0);
      glow *= mix(0.75, 1.2, streak);

      vec3 c = palette(i + t * 0.03);
      col += c * glow * (0.13 + 0.62 * depth);
    }

    // Vignette
    float r = length(p);
    col *= smoothstep(1.12, 0.16, r);
    col = pow(col, vec3(0.88));
    col *= 1.06;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function uvToSquareInTvBoard(
  uv: THREE.Vector2,
  orientation: "white" | "black",
  W: number,
  H: number
): string | null {
  const u = clamp(uv.x, 0, 0.999999);
  const v = clamp(uv.y, 0, 0.999999);

  // Convert UV to pixel-space with (0,0) at top-left.
  const x = u * W;
  const y = (1 - v) * H;
  const { boardX, boardY, boardSize } = getTvBoardRectPx(W, H);

  if (
    x < boardX ||
    x >= boardX + boardSize ||
    y < boardY ||
    y >= boardY + boardSize
  ) {
    return null;
  }

  const fx = (x - boardX) / boardSize;
  const fy = (y - boardY) / boardSize;
  const col = clamp(Math.floor(fx * 8), 0, 7);
  const rowFromTop = clamp(Math.floor(fy * 8), 0, 7);

  let fileIndex = col;
  let rank = 8 - rowFromTop;
  if (orientation === "black") {
    fileIndex = 7 - col;
    rank = rowFromTop + 1;
  }

  const file = String.fromCharCode(97 + fileIndex);
  return `${file}${rank}`;
}

function drawGooseIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fill: string,
  stroke: string
) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, Math.floor(size * 0.08));

  // Body
  ctx.beginPath();
  ctx.ellipse(0, size * 0.12, size * 0.44, size * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Neck
  ctx.beginPath();
  ctx.moveTo(size * 0.18, size * 0.02);
  ctx.bezierCurveTo(
    size * 0.28,
    -size * 0.22,
    size * 0.24,
    -size * 0.4,
    size * 0.02,
    -size * 0.46
  );
  ctx.bezierCurveTo(
    -size * 0.08,
    -size * 0.48,
    -size * 0.02,
    -size * 0.3,
    size * 0.06,
    -size * 0.18
  );
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.ellipse(
    size * 0.02,
    -size * 0.48,
    size * 0.12,
    size * 0.12,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.stroke();

  // Beak
  ctx.beginPath();
  ctx.moveTo(size * 0.12, -size * 0.5);
  ctx.lineTo(size * 0.28, -size * 0.46);
  ctx.lineTo(size * 0.12, -size * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Eye
  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(size * 0.04, -size * 0.52, Math.max(1, size * 0.03), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function pieceToGlyph(p: FenPiece): string {
  const key = `${p.color}${p.kind}`;
  switch (key) {
    case "wk":
      return "♔";
    case "wq":
      return "♕";
    case "wr":
      return "♖";
    case "wb":
      return "♗";
    case "wn":
      return "♘";
    case "wp":
      return "♙";
    case "bk":
      return "♚";
    case "bq":
      return "♛";
    case "br":
      return "♜";
    case "bb":
      return "♝";
    case "bn":
      return "♞";
    case "bp":
      return "♟";
    default:
      return "";
  }
}

const InWorldTv = memo(function InWorldTv({
  screen,
  sync,
  mode,
}: {
  screen: TvWallScreen;
  sync: Board2dSync | null;
  mode: BoardMode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);

  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    // Match the physical TV screen aspect (6.1 / 3.45) so the texture is not
    // stretched on the plane. We'll render a square board letterboxed inside.
    c.width = 1024;
    c.height = 580;
    return c;
  }, []);

  const chessPieceImages = useMemo(() => {
    const paths = {
      wp: "/2d/wp.png",
      wn: "/2d/wn.png",
      wb: "/2d/wb.png",
      wr: "/2d/wr.png",
      wq: "/2d/wq.png",
      wk: "/2d/wk.png",
      bp: "/2d/bp.png",
      bn: "/2d/bn.png",
      bb: "/2d/bb.png",
      br: "/2d/br.png",
      bq: "/2d/bq.png",
      bk: "/2d/bk.png",
    } as const;

    const out: Record<string, HTMLImageElement> = {};
    for (const [k, src] of Object.entries(paths)) {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      out[k] = img;
    }
    return out;
  }, []);

  useEffect(() => {
    // When piece images load, bump a version to redraw.
    let alive = true;
    const imgs = Object.values(chessPieceImages);
    let remaining = imgs.length;
    const onDone = () => {
      if (!alive) return;
      setImageVersion((v) => v + 1);
    };
    for (const img of imgs) {
      if (img.complete && img.naturalWidth > 0) {
        remaining -= 1;
        continue;
      }
      img.onload = () => {
        remaining -= 1;
        onDone();
      };
      img.onerror = () => {
        remaining -= 1;
        onDone();
      };
    }
    if (remaining === 0) onDone();
    return () => {
      alive = false;
    };
  }, [chessPieceImages]);

  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, [canvas]);

  useFrame((state) => {
    TV_SPACE_UNIFORMS.uTime.value = state.clock.elapsedTime;
  });

  const isChess4Way = screen.boardKey === "m";
  const engine = engineForMode(mode);
  const supported =
    (engine === "chess" || engine === "checkers") && !isChess4Way;

  const pieceMap = useMemo(
    () =>
      engine === "chess" && sync?.fen ? parseFenToSquareMap(sync.fen) : {},
    [engine, sync?.fen]
  );

  useEffect(() => {
    // Clear selection when the board position changes.
    setSelected(null);
  }, [sync?.fen, screen.boardKey]);

  useEffect(() => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Transparent canvas; the background is handled by the space shader mesh.
    const { inner, boardX, boardY, boardSize } = getTvBoardRectPx(W, H);

    // Header badge
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    const badgeW = 215;
    const badgeH = 46;
    const bx = inner.x + 10;
    const by = inner.y + 10;
    ctx.beginPath();
    ctx.roundRect(bx, by, badgeW, badgeH, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 24px system-ui, sans-serif";
    ctx.fillText(screen.boardKey.toUpperCase(), bx + 14, by + 32);
    const status =
      supported && sync ? (sync.canMove2d ? "Your turn" : "View") : "";
    if (status) {
      ctx.globalAlpha = 0.78;
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.fillText(status, bx + 60, by + 32);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Goose badge in header (goose mode)
    if (mode === "goose") {
      drawGooseIcon(
        ctx,
        inner.x + inner.w - 34,
        inner.y + 34,
        44,
        "rgba(255,255,255,0.92)",
        "rgba(10,14,24,0.95)"
      );
    }

    // Content
    if (!supported) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "700 34px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("2D board unavailable", W / 2, H / 2 - 18);
      ctx.fillText("for this mode", W / 2, H / 2 + 24);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      texture.needsUpdate = true;
      return;
    }

    if (!sync) {
      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.font = "700 40px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Loading…", W / 2, H / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      texture.needsUpdate = true;
      return;
    }

    const sq = boardSize / 8;

    const light = "#f0d9b5";
    const dark = "#b58863";
    // TV orientation: always show the side-to-move at the bottom.
    // (When it's black's move, flip so black is at the bottom.)
    const orient: "white" | "black" = sync.turn === "b" ? "black" : "white";

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        // Determine square in algebraic for this view cell.
        const col = orient === "white" ? c : 7 - c;
        const rank = orient === "white" ? 8 - r : r + 1;
        const file = String.fromCharCode(97 + col);
        const square = `${file}${rank}`;

        const isDark = (c + r) % 2 === 1;
        ctx.fillStyle = isDark ? dark : light;
        ctx.fillRect(boardX + c * sq, boardY + r * sq, sq, sq);

        if (selected === square) {
          ctx.fillStyle = "rgba(120, 255, 216, 0.28)";
          ctx.fillRect(boardX + c * sq, boardY + r * sq, sq, sq);
        }
      }
    }

    if (engine === "chess") {
      // Pieces (PNG sprites)
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const col = orient === "white" ? c : 7 - c;
          const rank = orient === "white" ? 8 - r : r + 1;
          const file = String.fromCharCode(97 + col);
          const square = `${file}${rank}`;
          const p = pieceMap[square];
          if (!p) continue;

          const key = `${p.color}${p.kind}`;
          const img = chessPieceImages[key];
          const size = sq * 0.9;
          const x = boardX + c * sq + (sq - size) / 2;
          const y = boardY + r * sq + (sq - size) / 2;

          if (img && img.complete && img.naturalWidth > 0) {
            // Drop shadow
            ctx.globalAlpha = 0.35;
            ctx.drawImage(img, x + 2, y + 3, size, size);
            ctx.globalAlpha = 1;
            ctx.drawImage(img, x, y, size, size);
          } else {
            // Fallback glyph
            const glyph = pieceToGlyph(p);
            if (glyph) {
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.font = `700 ${Math.floor(
                sq * 0.72
              )}px "Segoe UI Symbol", "Noto Sans Symbols", system-ui`;
              ctx.fillStyle = "rgba(0,0,0,0.45)";
              ctx.fillText(
                glyph,
                boardX + c * sq + sq / 2 + 2,
                boardY + r * sq + sq / 2 + 3
              );
              ctx.fillStyle = p.color === "w" ? "#ffffff" : "#111111";
              ctx.fillText(
                glyph,
                boardX + c * sq + sq / 2,
                boardY + r * sq + sq / 2
              );
              ctx.textAlign = "left";
              ctx.textBaseline = "alphabetic";
            }
          }
        }
      }

      // Goose overlay piece (goose mode)
      if (mode === "goose" && sync.gooseSquare) {
        const sqId = sync.gooseSquare;
        // Find its screen cell
        const fileIdx = sqId.charCodeAt(0) - 97;
        const rankNum = Number(sqId[1]);
        const c0 = orient === "white" ? fileIdx : 7 - fileIdx;
        const r0 = orient === "white" ? 8 - rankNum : rankNum - 1;
        if (c0 >= 0 && c0 < 8 && r0 >= 0 && r0 < 8) {
          drawGooseIcon(
            ctx,
            boardX + c0 * sq + sq / 2,
            boardY + r0 * sq + sq / 2,
            sq * 0.65,
            "rgba(255,255,255,0.92)",
            "rgba(0,0,0,0.65)"
          );
        }
      }
    } else {
      // Checkers pieces (simple discs, with a "king" ring)
      const board = sync.checkersBoard ?? {};
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const col = orient === "white" ? c : 7 - c;
          const rank = orient === "white" ? 8 - r : r + 1;
          const file = String.fromCharCode(97 + col);
          const square = `${file}${rank}`;
          const p = board[square];
          if (!p) continue;

          const cx = boardX + c * sq + sq / 2;
          const cy = boardY + r * sq + sq / 2;
          const radius = sq * 0.38;

          // Shadow
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.beginPath();
          ctx.arc(cx + 2, cy + 3, radius, 0, Math.PI * 2);
          ctx.fill();

          const fill = p.color === "w" ? "#ffffff" : "#111111";
          const stroke =
            p.color === "w" ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.12)";
          const grad = ctx.createRadialGradient(
            cx - radius * 0.35,
            cy - radius * 0.35,
            radius * 0.1,
            cx,
            cy,
            radius
          );
          grad.addColorStop(0, p.color === "w" ? "#ffffff" : "#2a2a2a");
          grad.addColorStop(1, fill);
          ctx.fillStyle = grad;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = Math.max(2, sq * 0.06);
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (p.king) {
            // Donut / ring (matches the reference style)
            ctx.strokeStyle =
              p.color === "w" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.75)";
            ctx.lineWidth = Math.max(2, sq * 0.09);
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle =
              p.color === "w" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    texture.needsUpdate = true;
  }, [
    canvas,
    texture,
    supported,
    sync,
    pieceMap,
    selected,
    screen.boardKey,
    engine,
    mode,
    chessPieceImages,
    imageVersion,
  ]);

  const handlePointerDown = useCallback(
    (e: any) => {
      e.stopPropagation();
      if (!supported || !sync) return;
      const uv = e.uv as THREE.Vector2 | undefined;
      if (!uv) return;

      const square = uvToSquareInTvBoard(
        uv,
        sync.turn === "b" ? "black" : "white",
        canvas.width,
        canvas.height
      );
      if (!square) return;

      const piece =
        engine === "checkers" ? sync.checkersBoard?.[square] : pieceMap[square];

      if (mode === "goose") {
        const canPlaceGoose = !!(sync as any).canPlaceGoose;
        const onPlaceGoose = (sync as any).onPlaceGoose as
          | ((sq: string) => boolean)
          | undefined;
        if (canPlaceGoose && onPlaceGoose && !piece) {
          const placed = onPlaceGoose(square);
          if (placed) setSelected(null);
          return;
        }
      }

      if (!sync.canMove2d) return;

      // Clicking your own piece selects it.
      if (piece && (piece as any).color === sync.turn) {
        setSelected((cur) => (cur === square ? null : square));
        return;
      }

      // If a piece is selected, attempt a move.
      if (selected) {
        const moved = sync.onMove2d(selected, square);
        setSelected(null);
        if (moved) return;
      }
    },
    [supported, sync, pieceMap, selected, engine, mode, canvas]
  );

  return (
    <group position={screen.position} rotation={[0, screen.rotationY, 0]}>
      {/* Modern TV housing + bezel */}
      <RoundedBox
        args={[6.8, 4.05, 0.26]}
        radius={0.22}
        smoothness={8}
        position={[0, 0, -0.06]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#0b0b10"
          roughness={0.55}
          metalness={0.35}
        />
      </RoundedBox>

      <RoundedBox
        args={[6.65, 3.9, 0.12]}
        radius={0.2}
        smoothness={8}
        position={[0, 0, 0.03]}
      >
        <meshStandardMaterial
          color="#0a0a0f"
          roughness={0.35}
          metalness={0.6}
        />
      </RoundedBox>

      {/* Screen glow plane */}
      <mesh position={[0, 0, 0.095]} renderOrder={0}>
        <planeGeometry args={[6.35, 3.6]} />
        <meshStandardMaterial
          color="#000000"
          emissive="#0a0f18"
          emissiveIntensity={0.9}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Space shader background (fills the whole visible screen) */}
      <mesh position={[0, 0, 0.101]} renderOrder={1}>
        <planeGeometry args={[6.35, 3.6]} />
        <shaderMaterial
          vertexShader={TV_SPACE_VERTEX}
          fragmentShader={
            screen.shaderVariant === "triangleTunnel"
              ? TV_TRIANGLE_TUNNEL_FRAGMENT
              : TV_SPACE_FRAGMENT
          }
          uniforms={TV_SPACE_UNIFORMS}
          side={THREE.DoubleSide}
          transparent={false}
          depthWrite={false}
        />
      </mesh>

      {/* WebGL screen surface (canvas texture) */}
      <mesh
        position={[0, 0, 0.106]}
        onPointerDown={handlePointerDown}
        renderOrder={2}
      >
        <planeGeometry args={[6.35, 3.6]} />
        <meshBasicMaterial
          map={texture}
          toneMapped={false}
          transparent
          opacity={1}
          depthWrite={false}
        />
      </mesh>

      {/* Glass layer (purely visual; does not intercept clicks) */}
      <mesh position={[0, 0, 0.114]} raycast={() => null} renderOrder={3}>
        <planeGeometry args={[6.4, 3.65]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.14}
          roughness={0.08}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.22}
          color="#111118"
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
});

export default function World({
  roomId,
  onExit,
  initialName,
  initialGender = "male",
  lobbyType = "park",
  onLobbyChange,
}: {
  roomId: string;
  onExit: () => void;
  initialName?: string;
  initialGender?: "male" | "female";
  lobbyType?: "park" | "scifi";
  onLobbyChange?: (type: "park" | "scifi") => void;
}) {
  const readStartScreenGender = useCallback((): "male" | "female" => {
    if (typeof window === "undefined") return initialGender ?? "male";
    try {
      const raw = window.localStorage.getItem("pawnsquare-user");
      if (!raw) return initialGender ?? "male";
      const parsed = JSON.parse(raw);
      return parsed?.gender === "female" ? "female" : "male";
    } catch {
      return initialGender ?? "male";
    }
  }, [initialGender]);

  const defaultAvatarUrlForGender = useCallback(
    (gender: "male" | "female") =>
      gender === "female"
        ? DEBUG_AVATAR_URLS.defaultFemale
        : DEBUG_AVATAR_URLS.defaultMale,
    []
  );

  const [isDuplicateSession, setIsDuplicateSession] = useState(false);

  const supabaseUserRef = useRef<User | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel("pawnsquare-game-session");
    const myId = Math.random().toString(36).slice(2);

    channel.onmessage = (event) => {
      if (event.data.type === "NEW_SESSION_STARTED" && event.data.id !== myId) {
        setIsDuplicateSession(true);
        channel.close();
      }
    };

    // Announce presence
    channel.postMessage({ type: "NEW_SESSION_STARTED", id: myId });

    return () => {
      channel.close();
    };
  }, []);

  const {
    self,
    players,
    peerCount,
    connected,
    chat,
    boardModes,
    sendSelfState,
    sendChat,
    setBoardMode,
    setName,
    setAvatarUrl,
    socketRef,
  } = useP2PRoom(
    roomId,
    useMemo(
      () => ({
        initialName,
        initialGender,
        paused: isDuplicateSession,
      }),
      [initialName, initialGender, isDuplicateSession]
    )
  );

  const reportActivityMove = useCallback(
    async (_game: string, _boardKey?: string) => {
      const u = supabaseUserRef.current;
      if (!u) return;
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.rpc("increment_my_stats", {
          p_moves_delta: 1,
          p_play_ms_delta: 0,
        });
        if (error) {
          console.warn("[stats] move increment failed:", error.message);
        }
      } catch (e) {
        console.warn("[stats] move increment failed:", e);
      }
    },
    []
  );

  const postQuestEvent = useCallback(async (payload: any) => {
    const u = supabaseUserRef.current;
    if (!u) return;
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      await fetch("/api/quests/event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("[quests] event failed:", e);
    }
  }, []);

  const questMoveBufferRef = useRef<{
    chess: number;
    goose: number;
    checkers: number;
  }>({
    chess: 0,
    goose: 0,
    checkers: 0,
  });

  const reportActivityMoveWithQuests = useCallback(
    async (game: string, boardKey?: string) => {
      await reportActivityMove(game, boardKey);
      const mode =
        game === "goose" ? "goose" : game === "checkers" ? "checkers" : "chess";
      questMoveBufferRef.current[mode] += 1;
    },
    [reportActivityMove]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = window.setInterval(() => {
      const buf = questMoveBufferRef.current;
      const chessCount = buf.chess;
      const gooseCount = buf.goose;
      const checkersCount = buf.checkers;
      if (chessCount + gooseCount + checkersCount === 0) return;
      questMoveBufferRef.current = { chess: 0, goose: 0, checkers: 0 };

      const base = `moves:${roomId}:${Date.now()}:${Math.random()
        .toString(36)
        .slice(2)}`;
      if (chessCount > 0)
        void postQuestEvent({
          eventId: `${base}:chess`,
          type: "moves",
          mode: "chess",
          count: chessCount,
        });
      if (gooseCount > 0)
        void postQuestEvent({
          eventId: `${base}:goose`,
          type: "moves",
          mode: "goose",
          count: gooseCount,
        });
      if (checkersCount > 0)
        void postQuestEvent({
          eventId: `${base}:checkers`,
          type: "moves",
          mode: "checkers",
          count: checkersCount,
        });
    }, 4000);
    return () => window.clearInterval(t);
  }, [postQuestEvent, roomId]);

  const peerGainMapRef = useRef<Map<string, GainNode | null>>(new Map());

  const voice = usePartyVoice({
    socketRef: socketRef,
    selfId: self?.id || null,
    onRemoteGainForPeerId: (peerId, gain) => {
      peerGainMapRef.current.set(peerId, gain);
    },
    // We'll drive connections based on proximity (instead of full room mesh).
    autoRequestConnections: false,
  });

  const [voiceDesiredPeerIds, setVoiceDesiredPeerIds] = useState<string[]>([]);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [voiceDeafened, setVoiceDeafened] = useState(false);

  const setRemoteGainForPeerId = useCallback(
    (peerId: string, gain: number) => {
      voice.setRemoteGainForPeerId(peerId, voiceDeafened ? 0 : gain);
    },
    [voice.setRemoteGainForPeerId, voiceDeafened]
  );

  useEffect(() => {
    if (!voiceDeafened) return;
    // Apply immediately (otherwise we'd wait for the next proximity tick).
    for (const peerId of voice.connectedPeerIds ?? []) {
      voice.setRemoteGainForPeerId(peerId, 0);
    }
  }, [voiceDeafened, voice.connectedPeerIds, voice.setRemoteGainForPeerId]);

  // Debug: log when voice system initializes
  useEffect(() => {
    console.log("[world] Voice system state:", {
      hasSocket: !!socketRef.current,
      socketState: socketRef.current?.readyState,
      selfId: self?.id,
      micMuted: voice.micMuted,
      peerCount: voice.peerCount,
      streamCount: voice.remoteStreamCount,
    });
  }, [
    socketRef.current,
    self?.id,
    voice.micMuted,
    voice.peerCount,
    voice.remoteStreamCount,
  ]);

  const keysRef = useWASDKeys();

  const [showFps, setShowFps] = useState(false);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const fpsLabelRef = useRef<HTMLDivElement | null>(null);

  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [bubbles, setBubbles] = useState<
    Record<string, { text: string; until: number }>
  >({});
  const lastSeenChatIdRef = useRef<string>("");

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat]);

  // FPS counter toggle with tilde key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "`" || e.key === "~") {
        // Don't toggle if typing in chat
        if (document.activeElement === chatInputRef.current) return;
        e.preventDefault();
        setShowFps((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Push-to-talk toggle with V key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "v" && e.key !== "V") return;
      // Prevent OS key-repeat from toggling rapidly while the key is held.
      if (e.repeat) return;
      // Don't toggle if typing in chat or other input.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      e.preventDefault();
      void voice.toggleMic();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voice.toggleMic]);

  useEffect(() => {
    const last = chat[chat.length - 1];
    if (!last) return;
    if (last.id === lastSeenChatIdRef.current) return;
    lastSeenChatIdRef.current = last.id;

    setBubbles((prev) => ({
      ...prev,
      [last.fromId]: {
        text: last.text,
        until: Date.now() + Math.max(3000, 1500 + last.text.length * 80),
      },
    }));
  }, [chat]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      setBubbles((prev) => {
        let changed = false;
        const next: typeof prev = { ...prev };
        for (const [id, b] of Object.entries(prev)) {
          if (b.until <= now) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 400);
    return () => window.clearInterval(t);
  }, []);

  const avatarSystem = getAvatarSystem();

  const groundGeom = useMemo(
    () => makeGroundGeometry({ size: 220, segments: 80, seed: 3.3 }),
    []
  );
  const plazaGeom = useMemo(
    () =>
      makeDirtDiskGeometry({
        radius: 22,
        segments: 72,
        seed: 10.1,
        baseColor: "#4a4038",
      }),
    []
  );
  const ringGeom = useMemo(
    () =>
      makeDirtRingGeometry({
        inner: 26,
        outer: 30,
        segments: 80,
        seed: 12.8,
        baseColor: "#3b332f",
      }),
    []
  );
  const [debugAvatarUrl, setDebugAvatarUrl] = useState<string>(() =>
    defaultAvatarUrlForGender(initialGender ?? "male")
  );

  const resetToDefaults = () => {
    // Keep local state consistent when signing out / playing as guest.
    const chosenGender = readStartScreenGender();
    const defaultAvatarUrl = defaultAvatarUrlForGender(chosenGender);
    setCoins(500);
    setOwnedItemIds([
      "default_male",
      "default_female",
      "chess_wood",
      "board_classic",
    ]);
    setChessTheme("chess_wood");
    setChessBoardTheme("board_classic");
    setDebugAvatarUrl(defaultAvatarUrl);
    setAvatarUrl(defaultAvatarUrl);
    if (onLobbyChange) onLobbyChange("park");
  };

  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<
    "avatar" | "theme" | "chess" | "quests" | "coins"
  >("avatar");
  const [shopSelectedId, setShopSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("chess-show-coordinates");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });
  const [coins, setCoins] = useState<number>(500);
  const [ownedItemIds, setOwnedItemIds] = useState<string[]>([
    "default_male",
    "default_female",
    "chess_wood", // Default chess set
    "board_classic", // Default chess board
  ]);
  const [chessTheme, setChessTheme] = useState<string>("chess_wood");
  const [chessBoardTheme, setChessBoardTheme] =
    useState<string>("board_classic");
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeMsg, setStripeMsg] = useState<string | null>(null);
  const [questsBusy, setQuestsBusy] = useState(false);
  const [questsMsg, setQuestsMsg] = useState<string | null>(null);
  const [quests, setQuests] = useState<
    {
      id: string;
      title: string;
      period: "daily" | "weekly";
      coins: number;
      claimed: boolean;
      completed: boolean;
      progress: number;
      target: number;
      nextResetAt: string;
    }[]
  >([]);
  const [authEmail, setAuthEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [supabaseUsername, setSupabaseUsername] = useState<string | null>(null);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState<string>("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null
  );
  const lastPlayPingAtRef = useRef<number | null>(null);

  useEffect(() => {
    supabaseUserRef.current = supabaseUser;
  }, [supabaseUser]);

  const mustChooseUsername = !!supabaseUser && !supabaseUsername;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const submitChat = useCallback(() => {
    const cleaned = chatInput.trim().slice(0, 160);
    if (!cleaned) return;

    // Hidden dev command: grant coins locally (and persist if signed in).
    if (cleaned === "/dev") {
      setChatInput("");
      setCoins(5000);

      if (supabaseUser) {
        const supabase = getSupabaseBrowserClient();
        supabase
          .from("profiles")
          .update({ coins: 5000 })
          .eq("id", supabaseUser.id)
          .then(({ error }) => {
            if (error) {
              console.error("[/dev] coin grant failed:", error);
            }
          });
      }
      return;
    }

    if (!connected) return;
    sendChat(cleaned);
    setChatInput("");
  }, [chatInput, connected, sendChat, supabaseUser]);

  const equippedThemeId = lobbyType === "scifi" ? "theme_scifi" : "theme_park";
  const isItemEquipped = (item: (typeof SHOP_ITEMS)[number]) => {
    if (item.type === "avatar") return item.url === debugAvatarUrl;
    if (item.type === "theme") return item.id === equippedThemeId;
    if (item.type === "chess") {
      if ((item as any).chessKind === "board")
        return item.id === chessBoardTheme;
      return item.id === chessTheme;
    }
    return false;
  };

  const openAuthModal = () => {
    setAuthMsg(null);
    setMenuOpen(false);
    setAuthModalOpen(true);
  };

  const openCenteredPopup = (url: string, name: string) => {
    const w = 520;
    const h = 720;
    const left = Math.max(
      0,
      Math.floor(window.screenX + (window.outerWidth - w) / 2)
    );
    const top = Math.max(
      0,
      Math.floor(window.screenY + (window.outerHeight - h) / 2)
    );
    return window.open(
      url,
      name,
      `popup=yes,width=${w},height=${h},left=${left},top=${top}`
    );
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "pawnsquare:auth") return;
      if (event.data?.ok) {
        setAuthMsg(null);
        setMenuOpen(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Close the hamburger menu on outside click / ESC.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) {
        setMenuOpen(false);
        return;
      }
      if (target.closest?.("[data-pawnsquare-menu-root]")) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Restore last-used shop tab from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(SHOP_TAB_STORAGE_KEY);
    if (
      saved === "avatar" ||
      saved === "theme" ||
      saved === "chess" ||
      saved === "quests" ||
      saved === "coins"
    ) {
      setShopTab(saved);
    }
  }, []);

  const fetchQuests = useCallback(async () => {
    setQuestsMsg(null);
    if (!supabaseUser) {
      setQuests([]);
      return;
    }
    try {
      setQuestsBusy(true);
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setQuestsMsg("Sign in required.");
        return;
      }
      const res = await fetch("/api/quests", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        setQuestsMsg(data?.error || "Could not load quests.");
        return;
      }
      const list = Array.isArray(data?.quests) ? data.quests : [];
      setQuests(
        list
          .filter((q: any) => typeof q?.id === "string")
          .map((q: any) => ({
            id: String(q.id),
            title: String(q.title ?? q.id),
            period: q.period === "weekly" ? "weekly" : "daily",
            coins: Number(q.coins ?? 0),
            claimed: Boolean(q.claimed),
            completed: Boolean(q.completed),
            progress: Number(q.progress ?? 0),
            target: Number(q.target ?? 0),
            nextResetAt: String(q.nextResetAt ?? ""),
          }))
      );
    } catch (e) {
      console.warn("[quests] fetch failed:", e);
      setQuestsMsg("Could not load quests.");
    } finally {
      setQuestsBusy(false);
    }
  }, [supabaseUser]);

  const claimQuest = useCallback(
    async (questId: string) => {
      setQuestsMsg(null);
      if (!supabaseUser) {
        setQuestsMsg("Sign in required.");
        return;
      }
      try {
        setQuestsBusy(true);
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          setQuestsMsg("Sign in required.");
          return;
        }
        const res = await fetch("/api/quests/claim", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ questId }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) {
          if (data?.error === "already_claimed") {
            setQuestsMsg("Already claimed.");
          } else {
            setQuestsMsg(data?.error || "Could not claim quest.");
          }
          return;
        }

        if (typeof data?.newCoins === "number") setCoins(data.newCoins);
        await fetchQuests();
      } catch (e) {
        console.warn("[quests] claim failed:", e);
        setQuestsMsg("Could not claim quest.");
      } finally {
        setQuestsBusy(false);
      }
    },
    [fetchQuests, supabaseUser]
  );

  useEffect(() => {
    if (!shopOpen) return;
    if (shopTab !== "quests") return;
    void fetchQuests();
  }, [shopOpen, shopTab, fetchQuests]);

  useEffect(() => {
    if (!questsOpen) return;
    void fetchQuests();
  }, [questsOpen, fetchQuests]);

  // Auto-close the login modal once we're signed in.
  useEffect(() => {
    if (!supabaseUser) return;
    setAuthModalOpen(false);
    setAuthBusy(false);
    setAuthMsg(null);
  }, [supabaseUser]);

  // Fetch leaderboard entries (public) and keep them fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    const refresh = async () => {
      try {
        const { data, error } = await supabase
          .from("leaderboard_entries")
          .select("id,name,moves,play_ms,score")
          .order("score", { ascending: false })
          .limit(10);
        if (cancelled) return;
        if (error) {
          console.warn("[leaderboard] fetch failed:", error.message);
          return;
        }
        const entries = (data ?? []).map(
          (r: any) =>
            ({
              id: String(r.id),
              name: String(r.name ?? "Anonymous"),
              moves: Number(r.moves ?? 0),
              playMs: Number(r.play_ms ?? 0),
              score: Number(r.score ?? 0),
            } satisfies LeaderboardEntry)
        );
        setLeaderboard(entries);
      } catch (e) {
        if (!cancelled) console.warn("[leaderboard] fetch failed:", e);
      }
    };

    void refresh();
    const id = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Persist current shop tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SHOP_TAB_STORAGE_KEY, shopTab);
    } catch {
      // ignore
    }
  }, [shopTab]);

  const persistEquipped = async (patch: {
    equipped_avatar_url?: string | null;
    equipped_theme?: string | null;
    equipped_chess_set?: string | null;
    equipped_chess_board?: string | null;
  }) => {
    if (!supabaseUser) return;
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", supabaseUser.id);
      if (error) {
        console.error("[equip] persist failed:", {
          message: (error as any)?.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          code: (error as any)?.code,
          raw: error,
        });
      }
    } catch (e) {
      console.error("[equip] persist threw:", e);
    }
  };

  // Reset shop view when closing so reopening starts clean.
  useEffect(() => {
    if (shopOpen) return;
    setShopSelectedId(null);
    setStripeBusy(false);
    setStripeMsg(null);
    setAuthMsg(null);
  }, [shopOpen]);

  // Supabase Auth (required before purchases)
  useEffect(() => {
    if (typeof window === "undefined") return;
    let unsub: { data: { subscription: { unsubscribe: () => void } } } | null =
      null;
    try {
      const supabase = getSupabaseBrowserClient();
      void supabase.auth.getUser().then(({ data }) => {
        setSupabaseUser(data.user ?? null);
      });
      unsub = supabase.auth.onAuthStateChange((_event, session) => {
        setSupabaseUser(session?.user ?? null);
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Supabase auth not configured.";
      setAuthMsg(msg);
    }

    return () => {
      try {
        unsub?.data.subscription.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, []);

  // When auth completes in another tab (magic-link or OAuth), refresh auth state here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supabase = getSupabaseBrowserClient();

    const refresh = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        setSupabaseUser(data.user ?? null);
      } catch {
        // ignore
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("pawnsquare-auth");
      bc.onmessage = (event) => {
        if (event.data?.type === "AUTH_OK") {
          void refresh();
        }
      };
    } catch {
      // ignore
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === "pawnsquare:authUpdatedAt") {
        void refresh();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      try {
        bc?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  // Load shop state (Supabase only).
  useEffect(() => {
    if (isDuplicateSession) return;

    if (supabaseUser) {
      const supabase = getSupabaseBrowserClient();

      // Fetch initial profile
      supabase
        .from("profiles")
        .select("*")
        .eq("id", supabaseUser.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setCoins(data.coins ?? 0);
            const ownedFromItems = Array.isArray((data as any).owned_items)
              ? ((data as any).owned_items as string[])
              : null;
            const ownedFromLegacy = Array.isArray((data as any).owned_avatars)
              ? ((data as any).owned_avatars as string[])
              : null;
            setOwnedItemIds(
              normalizeOwnedItemIds(ownedFromItems ?? ownedFromLegacy ?? [])
            );

            const equippedAvatarUrl =
              typeof (data as any).equipped_avatar_url === "string"
                ? ((data as any).equipped_avatar_url as string)
                : null;
            const equippedTheme =
              typeof (data as any).equipped_theme === "string"
                ? ((data as any).equipped_theme as string)
                : null;
            const equippedSet =
              typeof (data as any).equipped_chess_set === "string"
                ? ((data as any).equipped_chess_set as string)
                : null;
            const equippedBoard =
              typeof (data as any).equipped_chess_board === "string"
                ? ((data as any).equipped_chess_board as string)
                : null;

            if (equippedSet) setChessTheme(equippedSet);
            if (equippedBoard) setChessBoardTheme(equippedBoard);

            if (equippedTheme && onLobbyChange) {
              onLobbyChange(equippedTheme === "theme_scifi" ? "scifi" : "park");
            }

            if (equippedAvatarUrl && avatarSystem === "three-avatar") {
              setDebugAvatarUrl(equippedAvatarUrl);
              setAvatarUrl(equippedAvatarUrl);
            }
          }
        });

      // Subscribe to changes
      const channel = supabase
        .channel("profile-changes")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${supabaseUser.id}`,
          },
          (payload) => {
            const newRow = payload.new as {
              coins: number;
              owned_items?: any;
              owned_avatars?: any;
              equipped_avatar_url?: any;
              equipped_theme?: any;
              equipped_chess_set?: any;
              equipped_chess_board?: any;
            };
            setCoins(newRow.coins ?? 0);
            const ownedFromItems = Array.isArray(newRow.owned_items)
              ? (newRow.owned_items as string[])
              : null;
            const ownedFromLegacy = Array.isArray(newRow.owned_avatars)
              ? (newRow.owned_avatars as string[])
              : null;
            setOwnedItemIds(
              normalizeOwnedItemIds(ownedFromItems ?? ownedFromLegacy ?? [])
            );

            if (typeof newRow.equipped_chess_set === "string") {
              setChessTheme(newRow.equipped_chess_set);
            }
            if (typeof newRow.equipped_chess_board === "string") {
              setChessBoardTheme(newRow.equipped_chess_board);
            }
            if (typeof newRow.equipped_theme === "string" && onLobbyChange) {
              onLobbyChange(
                newRow.equipped_theme === "theme_scifi" ? "scifi" : "park"
              );
            }
            if (
              typeof newRow.equipped_avatar_url === "string" &&
              avatarSystem === "three-avatar"
            ) {
              setDebugAvatarUrl(newRow.equipped_avatar_url);
              setAvatarUrl(newRow.equipped_avatar_url);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      // Guest: No coins, only default avatars.
      setCoins(0);
      setOwnedItemIds(["default_male", "default_female"]);
    }
  }, [supabaseUser, isDuplicateSession]);

  // Load (or prompt for) username when signed in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isDuplicateSession) return;

    if (!supabaseUser) {
      setSupabaseUsername(null);
      setUsernameModalOpen(false);
      setUsernameDraft("");
      setUsernameMsg(null);
      setUsernameAvailable(null);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    const boot = async () => {
      try {
        const { data, error } = await supabase
          .from("usernames")
          .select("username")
          .eq("user_id", supabaseUser.id)
          .single();

        if (cancelled) return;
        if (!error && data?.username) {
          const u = String(data.username).trim().slice(0, 24);
          setSupabaseUsername(u);
          setName(u);
          try {
            window.sessionStorage.setItem("pawnsquare:name", u);
          } catch {
            // ignore
          }
          return;
        }

        const initial =
          (window.sessionStorage.getItem("pawnsquare:name") ?? "")
            .toString()
            .trim()
            .slice(0, 24) || "";
        setUsernameDraft(initial);
        setUsernameModalOpen(true);
      } catch (e) {
        console.warn("[username] load failed:", e);

        // Fallback: still prompt so the user can set a username.
        const initial =
          (window.sessionStorage.getItem("pawnsquare:name") ?? "")
            .toString()
            .trim()
            .slice(0, 24) || "";
        setUsernameDraft(initial);
        setUsernameModalOpen(true);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [supabaseUser, isDuplicateSession, setName]);

  // Guest naming: append (Guest) when not signed in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isDuplicateSession) return;

    const raw = (
      window.sessionStorage.getItem("pawnsquare:name") ??
      initialName ??
      ""
    )
      .toString()
      .trim();
    const base = stripGuestSuffix(raw).slice(0, 24) || "Guest";

    if (!supabaseUser) {
      const guestName = `${base} (Guest)`;
      setName(guestName);
      return;
    }

    // Signed in but no username set yet: remove guest suffix if present.
    if (!supabaseUsername) {
      setName(base);
    }
  }, [
    supabaseUser,
    supabaseUsername,
    isDuplicateSession,
    initialName,
    setName,
  ]);

  // Debounced username availability check.
  useEffect(() => {
    if (!usernameModalOpen) return;
    if (!supabaseUser) return;

    const cleaned = usernameDraft.trim().slice(0, 24);
    if (cleaned.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error } = await supabase.rpc("is_username_available", {
            p_username: cleaned,
          });
          if (error) {
            setUsernameAvailable(null);
            return;
          }
          setUsernameAvailable(Boolean(data));
        } catch {
          setUsernameAvailable(null);
        }
      })();
    }, 350);

    return () => window.clearTimeout(t);
  }, [usernameDraft, usernameModalOpen, supabaseUser]);

  // Persist playtime while connected (signed-in only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isDuplicateSession) return;
    if (!supabaseUser) return;
    if (!connected) return;

    const supabase = getSupabaseBrowserClient();
    lastPlayPingAtRef.current = Date.now();

    const flush = async () => {
      const now = Date.now();
      const last = lastPlayPingAtRef.current ?? now;
      const delta = Math.max(0, now - last);
      lastPlayPingAtRef.current = now;
      if (delta <= 0) return;
      try {
        const { error } = await supabase.rpc("increment_my_stats", {
          p_moves_delta: 0,
          p_play_ms_delta: delta,
        });
        if (error) {
          console.warn("[stats] playtime increment failed:", error.message);
        }
      } catch (e) {
        console.warn("[stats] playtime increment failed:", e);
      }
    };

    const id = window.setInterval(flush, 15000);
    return () => {
      window.clearInterval(id);
      void flush();
    };
  }, [supabaseUser, connected, isDuplicateSession]);

  // Persist shop state (Supabase handles this, no localStorage fallback).
  useEffect(() => {
    // No-op
  }, [coins, ownedItemIds, supabaseUser]);

  // Listen for Stripe payment success from popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "pawnsquare:payment-success") {
        const { coins: addedCoins, sessionId } = event.data;

        const claimedRaw = window.localStorage.getItem(
          "pawnsquare:claimedStripeSessions"
        );
        const claimed = new Set(safeParseJson<string[]>(claimedRaw) ?? []);

        if (claimed.has(sessionId)) return;

        setCoins((c) => c + Math.max(0, Math.floor(addedCoins ?? 0)));
        claimed.add(sessionId);
        window.localStorage.setItem(
          "pawnsquare:claimedStripeSessions",
          JSON.stringify(Array.from(claimed))
        );
        setStripeMsg(`Added ${addedCoins} coins!`);
        setStripeBusy(false);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // If the user hasn't changed the selector yet, default males to the male avatar.
  useEffect(() => {
    if (avatarSystem !== "three-avatar") return;
    if (!self) return;
    if (debugAvatarUrl !== DEBUG_AVATAR_URLS.defaultFemale) return;
    if (self.gender === "male") {
      setDebugAvatarUrl(DEBUG_AVATAR_URLS.defaultMale);
      setAvatarUrl(DEBUG_AVATAR_URLS.defaultMale);
    }
  }, [avatarSystem, self, debugAvatarUrl, setAvatarUrl]);

  // Keep HUD selection in sync with the currently broadcast avatarUrl.
  useEffect(() => {
    if (avatarSystem !== "three-avatar") return;
    if (!self?.avatarUrl) return;
    setDebugAvatarUrl(self.avatarUrl);
  }, [avatarSystem, self?.avatarUrl]);

  // Ensure we broadcast a default avatarUrl once self is available.
  useEffect(() => {
    if (avatarSystem !== "three-avatar") return;
    if (!self) return;
    if (self.avatarUrl) return;
    setAvatarUrl(debugAvatarUrl);
  }, [avatarSystem, self, self?.avatarUrl, debugAvatarUrl, setAvatarUrl]);

  const [contextLost, setContextLost] = useState(false);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  // Stage scene mounts to avoid large one-frame spikes (especially during Fast Refresh / scene swaps).
  const [sceneStage, setSceneStage] = useState<0 | 1 | 2>(0);
  const [mountedBoardCount, setMountedBoardCount] = useState(0);

  const selfPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const selfRotRef = useRef<number>(0);
  const selfSpeedRef = useRef<number>(0);
  const lookAtTargetRef = useRef<THREE.Vector3 | null>(null);

  const cameraOrbitApiRef = useRef<{
    rotateByPixels: (dx: number, dy: number) => void;
  } | null>(null);

  const cameraRotateModeRef = useRef(false);
  const suppressCameraRightDragRef = useRef(false);
  const [cameraRotateMode, setCameraRotateMode] = useState(false);
  const [cameraRotateToast, setCameraRotateToast] = useState<"" | "on" | "off">(
    ""
  );

  const [povMode, setPovMode] = useState(false);

  const handleCenterCamera = useCallback(
    (target: Vec3) => {
      // Centering the camera (board focus) should always exit POV.
      setPovMode(false);
      if (!lookAtTargetRef.current) {
        lookAtTargetRef.current = new THREE.Vector3(
          target[0],
          target[1],
          target[2]
        );
      } else {
        lookAtTargetRef.current.set(target[0], target[1], target[2]);
      }
    },
    [setPovMode]
  );

  const [boardControls, setBoardControls] = useState<BoardControlsOpen | null>(
    null
  );

  const [board2dByKey, setBoard2dByKey] = useState<Record<string, Board2dSync>>(
    {}
  );
  const [showGooseInfo, setShowGooseInfo] = useState(false);

  const moveTargetRef = useRef<{
    dest: Vec3;
    rotY?: number;
    sit?: boolean;
    sitDest?: Vec3;
    lookAtTarget?: Vec3;
  } | null>(null);
  const sittingRef = useRef<boolean>(false);
  const sitDebugRef = useRef<{ requested: number }>({ requested: 0 });

  const [joinedBoardKey, setJoinedBoardKey] = useState<string | null>(null);
  const [pendingJoinBoardKey, setPendingJoinBoardKey] = useState<string | null>(
    null
  );
  // Only lock during a pending join; being seated should not prevent switching boards.
  const joinLockedBoardKey = pendingJoinBoardKey;

  const [activeGameEnd, setActiveGameEnd] = useState<{
    boardKey: string;
    mode: BoardMode;
    resultLabel: string;
    didWin: boolean | null;
    hadOpponent?: boolean;
    resultSeq?: number;
    rematch: () => void;
    switchSides: () => void;
    leave: () => void;
    ts: number;
  } | null>(null);

  const [leaveAllNonce, setLeaveAllNonce] = useState(0);
  const [leaveAllExceptBoardKey, setLeaveAllExceptBoardKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!pendingJoinBoardKey) return;
    const t = window.setTimeout(() => {
      setPendingJoinBoardKey((cur) =>
        cur === pendingJoinBoardKey ? null : cur
      );
    }, 8000);
    return () => window.clearTimeout(t);
  }, [pendingJoinBoardKey]);

  const boards = useMemo(
    () =>
      [
        // Centered 2x2 layout so boards don't collide with plaza planters/greenery blocks.
        { key: "a", origin: [-6, 0.04, -6] as [number, number, number] },
        { key: "b", origin: [6, 0.04, -6] as [number, number, number] },
        { key: "c", origin: [-6, 0.04, 6] as [number, number, number] },
        { key: "d", origin: [6, 0.04, 6] as [number, number, number] },
      ] as const,
    []
  );

  // Room ID parsing:
  // - Channels: `base-chN` (where `base` alone is treated as channel 1 in UI)
  // - 4P rooms: `base-4p` (and optionally `base-4p-chN`)
  const roomIdNoChannel = useMemo(
    () => roomId.replace(/-ch\d+$/i, ""),
    [roomId]
  );
  const is4pRoom = useMemo(
    () => roomIdNoChannel.toLowerCase().endsWith("-4p"),
    [roomIdNoChannel]
  );
  const baseRoomId = useMemo(
    () =>
      roomIdNoChannel.toLowerCase().endsWith("-4p")
        ? roomIdNoChannel.slice(0, -3)
        : roomIdNoChannel,
    [roomIdNoChannel]
  );
  const activeBoards = useMemo(
    () => (is4pRoom ? [] : boards),
    [is4pRoom, boards]
  );

  const tvWallScreens = useMemo(() => {
    const y = 2.8;
    // Slightly in front of the wall panels (toward the room center) so the TV doesn't z-fight.
    // Wall groups live at z=±14, and the panel faces are at local z=±2.2.
    const northZ = 16.05;
    const southZ = -16.05;

    const base: Omit<TvWallScreen, "boardKey">[] = [
      {
        id: "north-left",
        position: [-6, y, northZ],
        rotationY: Math.PI,
        shaderVariant: "triangleTunnel",
      },
      { id: "north-right", position: [6, y, northZ], rotationY: Math.PI },
      {
        id: "south-left",
        position: [-6, y, southZ],
        rotationY: 0,
        shaderVariant: "triangleTunnel",
      },
      { id: "south-right", position: [6, y, southZ], rotationY: 0 },
    ];

    if (is4pRoom) {
      // 4P uses a different board; existing UX already disables the 2D board there.
      return base.map((s) => ({ ...s, boardKey: "m" }));
    }

    const pickNearest = (pos: [number, number, number]) => {
      let bestKey: string = activeBoards[0]?.key ?? "a";
      let bestD = Number.POSITIVE_INFINITY;
      for (const b of activeBoards) {
        const dx = pos[0] - b.origin[0];
        const dy = pos[1] - b.origin[1];
        const dz = pos[2] - b.origin[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestKey = b.key as string;
        }
      }
      return bestKey;
    };

    return base.map((s) => ({ ...s, boardKey: pickNearest(s.position) }));
  }, [activeBoards, is4pRoom]);

  const watched2dBoardKeys = useMemo(
    () => new Set(tvWallScreens.map((s) => s.boardKey)),
    [tvWallScreens]
  );

  const quickPlayTokenRef = useRef(0);
  const quickPlayOrderRef = useRef<string[]>([]);
  const [quickPlay, setQuickPlay] = useState<{
    token: number;
    targetBoardKey: string | null;
  } | null>(null);
  const [quickPlayStatus, setQuickPlayStatus] = useState<string | null>(null);

  const startQuickPlay = useCallback(() => {
    if (is4pRoom) {
      setQuickPlayStatus("Quick Play is unavailable in 4P rooms");
      return;
    }

    const candidates = activeBoards
      .map((b) => b.key)
      .filter((k) => (boardModes?.[k] ?? "chess") === "chess");
    if (candidates.length === 0) {
      setQuickPlayStatus("No chess boards are active in this room");
      return;
    }

    const token = (quickPlayTokenRef.current += 1);
    quickPlayOrderRef.current = candidates;
    setQuickPlay({ token, targetBoardKey: candidates[0] });
    setQuickPlayStatus("Finding a seat...");
  }, [activeBoards, boardModes, is4pRoom]);

  const handleQuickPlayResult = useCallback(
    (token: number, boardKey: string, ok: boolean, reason?: string) => {
      setQuickPlay((cur) => {
        if (!cur || cur.token !== token) return cur;
        if (ok) return null;

        const order = quickPlayOrderRef.current;
        const idx = order.indexOf(boardKey);
        const nextKey = idx >= 0 ? order[idx + 1] ?? null : order[0] ?? null;
        return nextKey ? { token, targetBoardKey: nextKey } : null;
      });

      if (ok) {
        setQuickPlayStatus(null);
        return;
      }

      const order = quickPlayOrderRef.current;
      const idx = order.indexOf(boardKey);
      const hasNext = idx >= 0 && idx + 1 < order.length;
      if (hasNext) return;

      if (reason === "full") setQuickPlayStatus("All chess boards are full");
      else if (reason === "in-progress")
        setQuickPlayStatus("No fresh chess games available");
      else setQuickPlayStatus("Quick Play couldn't find a seat");
    },
    []
  );

  const handleGameEnd = useCallback(
    (event: {
      boardKey: string;
      mode: BoardMode;
      resultLabel: string;
      didWin: boolean | null;
      hadOpponent?: boolean;
      resultSeq?: number;
      rematch: () => void;
      switchSides: () => void;
      leave: () => void;
    }) => {
      setActiveGameEnd({ ...event, ts: Date.now() });

      const mode =
        event.mode === "goose"
          ? "goose"
          : event.mode === "checkers"
          ? "checkers"
          : "chess";

      void postQuestEvent({
        eventId: `game_end:${roomId}:${event.boardKey}:${
          event.resultSeq ?? Date.now()
        }`,
        type: "game_end",
        mode,
        didWin: typeof event.didWin === "boolean" ? event.didWin : false,
        hadOpponent: event.hadOpponent ?? true,
      });
    },
    [postQuestEvent, roomId]
  );

  useEffect(() => {
    if (!activeGameEnd) return;
    if (joinedBoardKey !== activeGameEnd.boardKey) setActiveGameEnd(null);
  }, [activeGameEnd, joinedBoardKey]);

  useEffect(() => {
    if (!quickPlayStatus) return;
    const t = window.setTimeout(() => setQuickPlayStatus(null), 2500);
    return () => window.clearTimeout(t);
  }, [quickPlayStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    let nextBoardIndex = 0;

    const clearTimers = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (idleId !== null && "cancelIdleCallback" in window) {
        try {
          (window as any).cancelIdleCallback(idleId);
        } catch {
          // ignore
        }
        idleId = null;
      }
    };

    const runSoon = (fn: () => void, delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        if (!cancelled) fn();
      }, delayMs);
    };

    const runIdle = (fn: () => void) => {
      if ("requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(
          () => {
            idleId = null;
            if (!cancelled) fn();
          },
          { timeout: 250 }
        );
      } else {
        runSoon(fn, 0);
      }
    };

    const mountNextBoard = () => {
      if (cancelled) return;
      nextBoardIndex += 1;
      setMountedBoardCount(nextBoardIndex);
      if (nextBoardIndex < activeBoards.length) {
        runIdle(() => runSoon(mountNextBoard, 80));
      }
    };

    // Reset and progressively mount.
    setSceneStage(0);
    setMountedBoardCount(0);

    // 0: lobby, 1: lamps, 2: boards incrementally.
    runSoon(() => setSceneStage(1), 30);
    runIdle(() =>
      runSoon(() => {
        setSceneStage(2);
        if (activeBoards.length > 0) {
          mountNextBoard();
        }
      }, 60)
    );

    return () => {
      cancelled = true;
      clearTimers();
    };
    // Re-stage on scene/room changes.
  }, [activeBoards.length, lobbyType, roomId]);

  const lastSentRef = useRef<{ t: number; p: Vec3; r: number }>({
    t: 0,
    p: [0, 0, 0],
    r: 0,
  });

  const [showRoomsModal, setShowRoomsModal] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const { allRooms, setMyRoom } = useRoomDiscovery({ enabled: showRoomsModal });

  // Broadcast our current room/channel + player count to the discovery room.
  useEffect(() => {
    // Derive a best-effort player count from the PartyKit world state.
    // Use `players` directly to avoid referencing `remotePlayers` before it is declared.
    const count = Object.keys(players).length;
    try {
      setMyRoom(roomId, Math.max(1, count));
    } catch {
      // ignore
    }
  }, [players, roomId, setMyRoom]);

  const maxPlayersPerRoom = 16;

  const getChannelNumberForRoomId = useCallback(
    (base: string, fullRoomId: string) => {
      // UI channel numbering:
      // - base itself -> CH.1
      // - base-ch1 -> CH.2
      // - base-ch2 -> CH.3 ...
      if (fullRoomId === base) return 1;
      const m = fullRoomId.match(
        new RegExp(
          `^${base.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}-ch(\\d+)$`,
          "i"
        )
      );
      if (!m) return null;
      const n = parseInt(m[1]!, 10);
      if (!Number.isFinite(n)) return null;
      return n + 1;
    },
    []
  );

  const listOccupiedChannels = useCallback(
    (base: string) => {
      // Only show channels with people in them.
      const entries = (allRooms || [])
        .filter((r) => r.roomId === base || r.roomId.startsWith(`${base}-ch`))
        .filter((r) => r.playerCount > 0)
        .map((r) => {
          const ch = getChannelNumberForRoomId(base, r.roomId);
          return { ...r, ch };
        })
        .filter((r) => typeof r.ch === "number")
        .sort((a, b) => a.ch! - b.ch!);

      return entries as Array<{
        roomId: string;
        playerCount: number;
        ch: number;
      }>;
    },
    [allRooms, getChannelNumberForRoomId]
  );

  const pickBestRoomForBase = useCallback(
    (base: string) => {
      const existing = (allRooms || [])
        .filter((r) => r.roomId === base || r.roomId.startsWith(`${base}-ch`))
        .sort((a, b) => b.playerCount - a.playerCount);

      const available = existing.filter(
        (r) => r.playerCount < maxPlayersPerRoom
      );
      if (available[0]) return available[0].roomId;

      // All known channels are full (or none exist). Create the next channel.
      const channels = existing
        .map((r) => getChannelNumberForRoomId(base, r.roomId))
        .filter((n): n is number => typeof n === "number");

      const maxCh = channels.length ? Math.max(...channels) : 1;
      // Next UI channel number -> room id:
      // CH.1 => base
      // CH.k (k>1) => base-ch(k-1)
      const nextUiCh = maxCh + 1;
      return nextUiCh <= 1 ? base : `${base}-ch${nextUiCh - 1}`;
    },
    [allRooms, getChannelNumberForRoomId]
  );

  const goToRoom = useCallback((nextRoomId: string) => {
    if (typeof window === "undefined") return;
    const targetPath = `/room/${encodeURIComponent(nextRoomId)}`;
    if (window.location.pathname === targetPath) {
      setShowRoomsModal(false);
      return;
    }
    window.location.assign(targetPath);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onError = (event: ErrorEvent) => {
      const err = event.error;
      if (err instanceof Error) {
        console.error("[World] Uncaught error:", err.message, err.stack);
      } else {
        console.error("[World] Uncaught error:", err ?? event.message ?? event);
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason instanceof Error) {
        console.error(
          "[World] Unhandled rejection:",
          reason.message,
          reason.stack
        );
      } else {
        console.error("[World] Unhandled rejection:", reason);
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("pawnsquare:name") ?? "";
      const cleaned = saved.trim().slice(0, 24);
      if (cleaned) {
        setNameInput(cleaned);
        setName(cleaned);
      }
    } catch {
      // ignore
    }
  }, [setName]);

  useEffect(() => {
    if (!canvasEl) return;

    const onLost = (e: Event) => {
      // Prevent default so the browser is allowed to attempt context restoration.
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);

    canvasEl.addEventListener(
      "webglcontextlost",
      onLost as EventListener,
      false
    );
    canvasEl.addEventListener(
      "webglcontextrestored",
      onRestored as EventListener,
      false
    );
    return () => {
      canvasEl.removeEventListener("webglcontextlost", onLost as EventListener);
      canvasEl.removeEventListener(
        "webglcontextrestored",
        onRestored as EventListener
      );
    };
  }, [canvasEl]);

  useEffect(() => {
    return () => {
      // Help Fast Refresh/HMR clean up GPU resources promptly.
      try {
        glRef.current?.dispose();
      } catch {
        // ignore
      }
      glRef.current = null;
      canvasElRef.current = null;
      setCanvasEl(null);
    };
  }, []);

  const remotePlayers = useMemo(() => {
    const ids = Object.keys(players);
    return ids.map((id) => players[id]!).filter(Boolean);
  }, [players]);

  const hudPlayers = useMemo(() => {
    const list = [...remotePlayers];
    if (self) {
      list.unshift({
        id: self.id,
        name: self.name,
        color: self.color,
        gender: self.gender,
        position: [0, 0, 0],
        rotY: 0,
        lastSeen: Date.now(),
      });
    }
    return list;
  }, [remotePlayers, self]);

  if (isDuplicateSession) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.85)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h2>Session Active in Another Tab</h2>
        <p style={{ marginTop: 16, color: "#ccc" }}>
          You have opened PawnSquare in a new tab. This session has been paused.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 24,
            padding: "12px 24px",
            background: "#667eea",
            border: "none",
            borderRadius: 8,
            color: "white",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Resume Here
        </button>
      </div>
    );
  }

  const handleBoardControls = useCallback((event: BoardControlsEvent) => {
    if (event.type === "close") {
      setBoardControls((prev) => {
        if (!prev) return null;
        if (event.boardKey && prev.boardKey !== event.boardKey) return prev;
        return null;
      });
      return;
    }

    if (event.type === "sync2d") {
      setBoard2dByKey((prev) => ({ ...prev, [event.boardKey]: event }));

      setBoardControls((prev) => {
        if (!prev) return prev;
        if (prev.boardKey !== event.boardKey) return prev;
        return {
          ...prev,
          fen: event.fen,
          mySide: event.mySide,
          turn: event.turn,
          boardOrientation: event.boardOrientation,
          canMove2d: event.canMove2d,
          checkersBoard: event.checkersBoard ?? prev.checkersBoard,
          onMove2d: event.onMove2d,
        };
      });
      return;
    }

    // event.type === "open"
    setBoardControls(event);
    setBoard2dByKey((prev) => ({
      ...prev,
      [event.boardKey]: {
        type: "sync2d",
        boardKey: event.boardKey,
        lobby: event.lobby,
        fen: event.fen,
        mySide: event.mySide,
        turn: event.turn,
        boardOrientation: event.boardOrientation,
        canMove2d: event.canMove2d,
        gooseSquare: event.gooseSquare,
        goosePhase: event.goosePhase,
        startledSquares: event.startledSquares,
        canPlaceGoose: event.canPlaceGoose,
        onPlaceGoose: event.onPlaceGoose,
        checkersBoard: event.checkersBoard,
        onMove2d: event.onMove2d,
      },
    }));
  }, []);

  const handleJoinIntent = useCallback((boardKey: string) => {
    setPendingJoinBoardKey((prev) => prev ?? boardKey);
    setLeaveAllExceptBoardKey(boardKey);
    setLeaveAllNonce((n) => n + 1);
  }, []);

  const handleSelfSeatChange = useCallback(
    (boardKey: string, isSeated: boolean) => {
      setJoinedBoardKey((prev) => {
        if (isSeated) return boardKey;
        if (prev === boardKey) return null;
        return prev;
      });
      setPendingJoinBoardKey((prev) => (prev === boardKey ? null : prev));
    },
    []
  );

  const handleRequestMove = useCallback(
    (
      dest: Vec3,
      opts?: {
        rotY?: number;
        sit?: boolean;
        sitDest?: Vec3;
        lookAtTarget?: Vec3;
      }
    ) => {
      if (opts?.sit) {
        // Benches / seating should behave like normal camera: exit POV.
        setPovMode(false);
      }
      moveTargetRef.current = {
        dest,
        rotY: opts?.rotY,
        sit: opts?.sit,
        sitDest: opts?.sitDest,
        lookAtTarget: opts?.lookAtTarget,
      };
      sittingRef.current = false;
    },
    [setPovMode]
  );

  const renderBoardLamp = useCallback(
    (origin: [number, number, number]) => {
      const lampPos: [number, number, number] = [
        origin[0] + (origin[0] < 0 ? -5.8 : 5.8),
        0,
        origin[2] + (origin[2] < 0 ? -4.8 : 4.8),
      ];

      return lobbyType === "scifi" ? (
        <SciFiLamp lampPos={lampPos} />
      ) : (
        <BoardLamp lampPos={lampPos} targetPos={[origin[0], 0.2, origin[2]]} />
      );
    },
    [lobbyType]
  );

  const renderChessBoard = useCallback(
    (
      b: { key: string; origin: [number, number, number] },
      controlsOpen: boolean,
      board2dOpen: boolean
    ) => {
      const commonProps = {
        roomId,
        boardKey: b.key,
        origin: b.origin,
        selfPositionRef: selfPosRef,
        selfId: self?.id || "",
        selfName: self?.name || "",
        onActivityMove: reportActivityMoveWithQuests,
        joinLockedBoardKey,
        leaveAllNonce,
        leaveAllExceptBoardKey,
        chessTheme,
        chessBoardTheme,
        gameMode: boardModes?.[b.key] ?? "chess",
        onJoinIntent: handleJoinIntent,
        quickPlay,
        onQuickPlayResult: handleQuickPlayResult,
        onGameEnd: handleGameEnd,
        onSelfSeatChange: handleSelfSeatChange,
        onRequestMove: handleRequestMove,
        onCenterCamera: handleCenterCamera,
        onBoardControls: handleBoardControls,
        controlsOpen,
        board2dOpen,
      };

      return lobbyType === "scifi" ? (
        <ScifiChess {...commonProps} />
      ) : (
        <OutdoorChess {...commonProps} />
      );
    },
    [
      chessBoardTheme,
      chessTheme,
      boardModes,
      quickPlay,
      handleQuickPlayResult,
      handleGameEnd,
      handleBoardControls,
      handleCenterCamera,
      handleJoinIntent,
      handleRequestMove,
      handleSelfSeatChange,
      joinLockedBoardKey,
      leaveAllExceptBoardKey,
      leaveAllNonce,
      lobbyType,
      roomId,
      self?.id,
      self?.name,
    ]
  );

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        key="main-canvas"
        dpr={[1, 1]}
        camera={{ position: [0, 5, 8], fov: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        style={{ background: lobbyType === "scifi" ? "#1a0033" : "#d6a57d" }}
        onCreated={({ gl }) => {
          gl.setClearColor(
            new THREE.Color(lobbyType === "scifi" ? "#1a0033" : "#d6a57d"),
            1
          );
          gl.shadowMap.enabled = false;
          gl.shadowMap.autoUpdate = false;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.06;
          glRef.current = gl;
          canvasElRef.current = gl.domElement;
          setCanvasEl(gl.domElement);
        }}
      >
        <group
          onPointerDown={(e: any) => {
            // Click-to-move: left click anywhere in the world that doesn't stopPropagation
            // (chess squares, join pads, benches already stopPropagation).
            if (e.button !== 0) return;
            if (!self) return;

            const planeY = selfPosRef.current.y;
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
            const hit = new THREE.Vector3();
            const ok = e.ray?.intersectPlane?.(plane, hit);
            if (!ok) return;

            const x = clamp(hit.x, -18, 18);
            const z = clamp(hit.z, -18, 18);
            moveTargetRef.current = { dest: [x, planeY, z] };
            sittingRef.current = false;
            lookAtTargetRef.current = null;
          }}
        >
          {lobbyType === "scifi" ? (
            <SciFiLobby
              leaderboard={leaderboard}
              showLeaderboardWall={!is4pRoom}
            />
          ) : (
            <ParkLobby
              leaderboard={leaderboard}
              showLeaderboardWall={!is4pRoom}
            />
          )}

          {sceneStage >= 2 ? (
            <group>
              {tvWallScreens.map((screen) => (
                <InWorldTv
                  key={screen.id}
                  screen={screen}
                  sync={board2dByKey[screen.boardKey] ?? null}
                  mode={(boardModes?.[screen.boardKey] as BoardMode) ?? "chess"}
                />
              ))}
            </group>
          ) : null}

          {activeBoards.map((b, idx) => (
            <group key={b.key}>
              {sceneStage >= 1 ? renderBoardLamp(b.origin) : null}

              {sceneStage >= 2 && idx < mountedBoardCount ? (
                <Suspense fallback={null}>
                  {renderChessBoard(
                    b,
                    boardControls?.boardKey === b.key,
                    watched2dBoardKeys.has(b.key)
                  )}
                </Suspense>
              ) : null}
            </group>
          ))}

          {/* 4P chess lives in the dedicated "-4p" room */}
          {sceneStage >= 2 && is4pRoom ? (
            <Suspense fallback={null}>
              <OutdoorChess4P
                roomId={roomId}
                boardKey={"m"}
                origin={[0, 0.04, 0]}
                selfPositionRef={selfPosRef}
                selfId={self?.id || ""}
                selfName={self?.name || ""}
                onActivityMove={reportActivityMoveWithQuests}
                joinLockedBoardKey={joinLockedBoardKey}
                leaveAllNonce={leaveAllNonce}
                leaveAllExceptBoardKey={leaveAllExceptBoardKey}
                onJoinIntent={handleJoinIntent}
                onSelfSeatChange={handleSelfSeatChange}
                onRequestMove={handleRequestMove}
                onCenterCamera={handleCenterCamera}
                onBoardControls={handleBoardControls}
                controlsOpen={boardControls?.boardKey === "m"}
                board2dOpen={watched2dBoardKeys.has("m")}
                chessTheme={chessTheme}
                suppressCameraRotateRef={suppressCameraRightDragRef}
              />
            </Suspense>
          ) : null}

          <FollowCamera
            target={selfPosRef}
            lookAtOverride={lookAtTargetRef}
            orbitApiRef={cameraOrbitApiRef}
            rotateModeRef={cameraRotateModeRef}
            suppressRightDragRef={suppressCameraRightDragRef}
            povMode={povMode}
            yawRef={selfRotRef}
            setPovMode={setPovMode}
          />

          <VoiceProximityUpdater
            enabled={!!self}
            selfId={self?.id}
            players={players}
            selfPosRef={selfPosRef}
            setRemoteGainForPeerId={setRemoteGainForPeerId}
            // Proximity voice subscriptions (VRChat-like): only connect within radius.
            requestConnections={voice.requestConnections}
            hangupPeer={voice.hangupPeer}
            onDesiredPeersChange={setVoiceDesiredPeerIds}
          />

          {showFps && <FpsTracker labelRef={fpsLabelRef} />}

          <SelfSimulation
            enabled={!!self}
            keysRef={keysRef}
            pos={selfPosRef}
            rotY={selfRotRef}
            lastSent={lastSentRef}
            sendSelfState={sendSelfState}
            speedRef={selfSpeedRef}
            moveTargetRef={moveTargetRef}
            sittingRef={sittingRef}
            lookAtTargetRef={lookAtTargetRef}
          />

          {self ? (
            <Suspense fallback={null}>
              {!povMode ? (
                <SelfAvatar
                  color={self.color}
                  name={self.name}
                  pos={selfPosRef}
                  rotY={selfRotRef}
                  speed={selfSpeedRef}
                  gender={self.gender}
                  avatarUrl={
                    avatarSystem === "three-avatar" ? debugAvatarUrl : undefined
                  }
                  sittingRef={sittingRef}
                  bubbleText={bubbles[self.id]?.text}
                />
              ) : null}
            </Suspense>
          ) : null}

          <Suspense fallback={null}>
            {remotePlayers.map((p) => (
              <RemoteAvatar
                key={p.id}
                id={p.id}
                name={p.name}
                color={p.color}
                targetPosition={p.position}
                targetRotY={p.rotY}
                gender={p.gender}
                avatarUrl={p.avatarUrl}
                bubbleText={bubbles[p.id]?.text}
              />
            ))}
          </Suspense>
        </group>
      </Canvas>

      {/* Voice HUD: desktop only (mobile uses compact mic button next to chat) */}
      {!isMobile ? (
        <div
          style={{
            position: "fixed",
            right: 12,
            bottom: 12,
            width: 320,
            maxWidth: "calc(100vw - 24px)",
            borderRadius: 10,
            border: "1px solid rgba(127,127,127,0.25)",
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(6px)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            pointerEvents: "auto",
            color: "white",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, opacity: 0.95 }}>Voice</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {showFps ? (
                <div style={{ opacity: 0.8 }}>Push-to-talk: V</div>
              ) : null}
              <button
                onClick={() => setVoiceDeafened((v) => !v)}
                style={{
                  height: 28,
                  width: 28,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: voiceDeafened
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.06)",
                  color: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                }}
                title={
                  voiceDeafened
                    ? "Undeafen (hear others)"
                    : "Deafen (stop hearing)"
                }
                aria-label={
                  voiceDeafened
                    ? "Undeafen (hear others)"
                    : "Deafen (stop hearing)"
                }
              >
                {voiceDeafened ? "🔇" : "🔈"}
              </button>
              <button
                onClick={() => {
                  const next = !voiceSettingsOpen;
                  setVoiceSettingsOpen(next);
                  if (next) {
                    try {
                      void voice.refreshMicDevices?.();
                    } catch {
                      // ignore
                    }
                  }
                }}
                style={{
                  height: 28,
                  width: 28,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                }}
                title="Voice settings"
                aria-label="Voice settings"
              >
                ⚙
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => {
                void voice.toggleMic();
              }}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.16)",
                background: voice.micMuted
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(46, 213, 115, 0.18)",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              title={voice.micMuted ? "Unmute mic" : "Mute mic"}
              aria-label={voice.micMuted ? "Unmute mic" : "Mute mic"}
            >
              {voice.micMuted ? "Unmute" : "Mute"}
            </button>
            <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.2 }}>
              Muted still lets you hear others.
            </div>
          </div>

          {voiceSettingsOpen ? (
            <div
              style={{
                borderTop: "1px solid rgba(127,127,127,0.2)",
                paddingTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 700 }}>
                Microphone
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={voice.selectedMicDeviceId ?? ""}
                  onChange={(e) => {
                    void voice.setMicDeviceId?.(e.target.value);
                  }}
                  style={{
                    height: 32,
                    flex: 1,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    padding: "0 10px",
                    outline: "none",
                  }}
                  aria-label="Select microphone"
                >
                  <option value="">Default microphone</option>
                  {(voice.micDevices ?? []).map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    void voice.refreshMicDevices?.();
                  }}
                  style={{
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  title="Refresh mic list"
                >
                  Refresh
                </button>
              </div>
              {voice.micLastError ? (
                <div style={{ fontSize: 11, opacity: 0.9, color: "#ffb3b3" }}>
                  Mic error: {voice.micLastError}
                </div>
              ) : null}
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Tip: device names may appear only after granting mic permission.
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ opacity: 0.9 }}>
              {voice.micAvailable ? "Mic ready" : "Mic off"}
            </div>
            <div style={{ opacity: 0.9 }}>
              {voice.micMuted ? "Muted" : "Live"}
            </div>
            <div style={{ opacity: 0.9 }}>
              {voiceDeafened ? "Deaf" : "Hearing"}
            </div>
            <div style={{ opacity: 0.9 }}>
              Near: {voiceDesiredPeerIds.length}
            </div>
            <div style={{ opacity: 0.9 }}>Conn: {voice.peerCount}</div>
            <div style={{ opacity: 0.9 }}>
              Streams: {voice.remoteStreamCount}
            </div>
          </div>

          {showFps && voice.debugEvents.length > 0 ? (
            <div
              style={{
                marginTop: 2,
                borderTop: "1px solid rgba(127,127,127,0.2)",
                paddingTop: 6,
                maxHeight: 92,
                overflow: "auto",
                fontSize: 11,
                opacity: 0.9,
                lineHeight: 1.25,
              }}
            >
              {voice.debugEvents.slice(-6).map((e, i) => (
                <div key={`${e.t}-${i}`}>
                  <span style={{ opacity: 0.75 }}>
                    {new Date(e.t).toLocaleTimeString()}
                  </span>
                  <span style={{ fontWeight: 700, opacity: 0.9 }}>
                    {e.kind}
                  </span>
                  {e.peerId ? (
                    <span style={{ opacity: 0.85 }}> {e.peerId}</span>
                  ) : null}
                  {e.message ? (
                    <span style={{ opacity: 0.8 }}> — {e.message}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {contextLost ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.65)",
            color: "white",
            zIndex: 20,
          }}
        >
          <div
            style={{
              border: "1px solid rgba(127,127,127,0.35)",
              borderRadius: 12,
              padding: 16,
              maxWidth: 520,
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.9 }}>
              WebGL context was lost.
            </div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              Try reloading the page. If it keeps happening, we can reduce GPU
              load (shadows/off) or tweak renderer settings.
            </div>{" "}
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 12,
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                background: "#fff",
                color: "#000",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      ) : null}

      {/* FPS Counter */}
      {showFps && (
        <div
          ref={fpsLabelRef}
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          FPS: --
        </div>
      )}

      {/* Camera rotate toast */}
      {cameraRotateToast ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.72)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "white",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.2,
            }}
          >
            {cameraRotateToast === "on"
              ? "Rotate camera: drag anywhere"
              : "Camera rotation off"}
          </div>
        </div>
      ) : null}

      {/* Top Left HUD */}
      <div
        style={{
          position: "fixed",
          top: showFps ? 52 : 12,
          left: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none", // Let clicks pass through to canvas where possible
        }}
      >
        <div style={{ display: "flex", gap: 8, pointerEvents: "none" }}>
          {/* POV (first-person) toggle */}
          <button
            onClick={() => setPovMode((prev) => !prev)}
            title={povMode ? "Exit POV mode" : "Enter POV mode"}
            style={{
              pointerEvents: "auto",
              height: 38,
              borderRadius: 12,
              background: povMode ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.4)",
              backdropFilter: "blur(8px)",
              border: povMode
                ? "1px solid rgba(255,255,255,0.22)"
                : "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 10px",
              color: "white",
              touchAction: "manipulation",
              userSelect: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <UserIcon size={16} />
            <span style={{ lineHeight: 1 }}>POV</span>
          </button>

          {/* Camera rotate toggle */}
          <button
            onClick={() => {
              setCameraRotateMode((prev) => {
                const next = !prev;
                cameraRotateModeRef.current = next;
                setCameraRotateToast(next ? "on" : "off");
                window.setTimeout(() => setCameraRotateToast(""), 1200);
                return next;
              });
            }}
            title={cameraRotateMode ? "Stop rotating camera" : "Rotate camera"}
            style={{
              pointerEvents: "auto",
              height: 38,
              borderRadius: 12,
              background: cameraRotateMode
                ? "rgba(0,0,0,0.6)"
                : "rgba(0,0,0,0.4)",
              backdropFilter: "blur(8px)",
              border: cameraRotateMode
                ? "1px solid rgba(255,255,255,0.22)"
                : "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 10px",
              color: "white",
              touchAction: "manipulation",
              userSelect: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <RotateArrowsIcon size={16} />
            <span style={{ lineHeight: 1 }}>Camera</span>
          </button>
        </div>

        {/* Room Info Card */}
        <div
          style={{
            pointerEvents: "auto",
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            color: "white",
            minWidth: 180,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{roomId}</div>
            <div
              style={{
                fontSize: 12,
                opacity: 0.8,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <UserIcon size={12} />
              {peerCount + 1}
            </div>
          </div>

          {avatarSystem === "three-avatar" ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                color: "#ffd700",
                fontWeight: 500,
                marginTop: 2,
              }}
            >
              <CoinsIcon size={14} />
              {coins}
              <button
                onClick={() => {
                  setShopTab("coins");
                  setShopOpen(true);
                }}
                style={{
                  background: "#667eea",
                  border: "none",
                  borderRadius: "50%",
                  width: 18,
                  height: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  cursor: "pointer",
                  marginLeft: 4,
                  fontSize: 14,
                  lineHeight: 1,
                }}
                title="Buy more coins"
              >
                +
              </button>
            </div>
          ) : null}
        </div>

        {/* Player List (Desktop only or collapsible) */}
        <div
          style={{
            pointerEvents: "auto",
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            color: "white",
            maxHeight: "40vh",
            overflowY: "auto",
            width: 180,
          }}
        >
          <div
            style={{
              fontSize: 11,
              opacity: 0.6,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Players ({hudPlayers.length})
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              overflowY: "auto",
            }}
          >
            {hudPlayers.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: p.color,
                    boxShadow: `0 0 4px ${p.color}`,
                  }}
                />
                <div
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    opacity: 0.9,
                  }}
                >
                  {p.name || "Guest"}
                  {self?.id === p.id ? " (You)" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls / Actions */}
        <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
          <button
            onClick={() => setShowRoomsModal(true)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "white",
              fontSize: 12,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            Rooms
          </button>

          {!is4pRoom ? (
            <button
              onClick={startQuickPlay}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.4)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                fontSize: 12,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              title="Join a fresh chess game"
            >
              Quick Play
            </button>
          ) : null}

          <button
            onClick={onExit}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255, 59, 48, 0.2)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255, 59, 48, 0.3)",
              color: "#ff6b6b",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Exit
          </button>
        </div>

        {quickPlayStatus ? (
          <div
            style={{
              marginTop: 8,
              pointerEvents: "auto",
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "white",
              fontSize: 12,
              maxWidth: 360,
            }}
          >
            {quickPlayStatus}
          </div>
        ) : null}

        {activeGameEnd && joinedBoardKey === activeGameEnd.boardKey ? (
          <div
            style={{
              marginTop: 8,
              pointerEvents: "auto",
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white",
              maxWidth: 420,
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
              {activeGameEnd.resultLabel}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  activeGameEnd.rematch();
                  setActiveGameEnd(null);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.4)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Rematch
              </button>
              <button
                onClick={() => {
                  activeGameEnd.switchSides();
                  setActiveGameEnd(null);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.4)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Switch sides
              </button>
              <button
                onClick={() => {
                  activeGameEnd.leave();
                  setActiveGameEnd(null);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.4)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "white",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Rooms Modal */}
      {showRoomsModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            pointerEvents: "auto",
            padding: 16,
          }}
          onClick={() => setShowRoomsModal(false)}
        >
          <div
            style={{
              width: 360,
              maxWidth: "94vw",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(10,10,12,0.92)",
              color: "white",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "14px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <div
                style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.4 }}
              >
                Rooms
              </div>
              <button
                onClick={() => setShowRoomsModal(false)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                }}
                aria-label="Close"
                title="Close"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <div
              style={{
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => goToRoom(pickBestRoomForBase(baseRoomId))}
                  style={{
                    width: "100%",
                    padding: "14px 14px",
                    border: "none",
                    background: "transparent",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: 800,
                    textAlign: "left",
                  }}
                >
                  Normal Chess
                </button>
                <div
                  style={{
                    padding: "0 14px 12px 14px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  {listOccupiedChannels(baseRoomId).map((r) => (
                    <button
                      key={r.roomId}
                      onClick={() => goToRoom(r.roomId)}
                      style={{
                        height: 30,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(0,0,0,0.25)",
                        color: "white",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                      title={`${r.playerCount}/${maxPlayersPerRoom}`}
                      aria-label={`Channel ${r.ch} (${r.playerCount}/${maxPlayersPerRoom})`}
                    >
                      <span style={{ opacity: 0.95 }}>{`CH.${r.ch}`}</span>
                      <span
                        style={{ opacity: 0.75, fontWeight: 700 }}
                      >{`${r.playerCount}/${maxPlayersPerRoom}`}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() =>
                    goToRoom(pickBestRoomForBase(`${baseRoomId}-4p`))
                  }
                  style={{
                    width: "100%",
                    padding: "14px 14px",
                    border: "none",
                    background: "transparent",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: 800,
                    textAlign: "left",
                  }}
                >
                  4P Chess
                </button>
                <div
                  style={{
                    padding: "0 14px 12px 14px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  {listOccupiedChannels(`${baseRoomId}-4p`).map((r) => (
                    <button
                      key={r.roomId}
                      onClick={() => goToRoom(r.roomId)}
                      style={{
                        height: 30,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(0,0,0,0.25)",
                        color: "white",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                      title={`${r.playerCount}/${maxPlayersPerRoom}`}
                      aria-label={`Channel ${r.ch} (${r.playerCount}/${maxPlayersPerRoom})`}
                    >
                      <span style={{ opacity: 0.95 }}>{`CH.${r.ch}`}</span>
                      <span
                        style={{ opacity: 0.75, fontWeight: 700 }}
                      >{`${r.playerCount}/${maxPlayersPerRoom}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <LoadTestPanel roomId={roomId} />

      <div
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          width: isMobile ? 280 : 320,
          maxWidth: "calc(100vw - 24px)",
          borderRadius: 10,
          border: "1px solid rgba(127,127,127,0.25)",
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(6px)",
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        <div
          ref={chatScrollRef}
          style={{
            maxHeight: 180,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            opacity: 0.95,
          }}
        >
          {chat.slice(-30).map((m: ChatMessage) => (
            <div key={m.id} style={{ lineHeight: 1.25 }}>
              <span style={{ opacity: 0.9, fontWeight: 600 }}>
                {m.fromName}:
              </span>{" "}
              <span style={{ opacity: 0.95 }}>{m.text}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={chatInputRef}
            value={chatInput}
            placeholder={connected ? "Chat..." : "Connecting..."}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              submitChat();
            }}
            style={{
              height: 34,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid rgba(127,127,127,0.25)",
              background: "transparent",
              color: "inherit",
              outline: "none",
              flex: 1,
              minWidth: 0,
            }}
          />

          {/* Compact mobile voice toggle: sits to the right of the chat input */}
          {isMobile ? (
            <button
              onClick={() => {
                void voice.toggleMic();
              }}
              style={{
                height: 34,
                width: 36,
                borderRadius: 8,
                border: "1px solid rgba(127,127,127,0.25)",
                background: voice.micMuted
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(46, 213, 115, 0.18)",
                color: "white",
                fontWeight: 800,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                flex: "0 0 auto",
              }}
              title={voice.micMuted ? "Unmute mic" : "Mute mic"}
              aria-label={voice.micMuted ? "Unmute mic" : "Mute mic"}
            >
              🎙
            </button>
          ) : null}

          {/* Compact mobile deafen toggle */}
          {isMobile ? (
            <button
              onClick={() => setVoiceDeafened((v) => !v)}
              style={{
                height: 34,
                width: 36,
                borderRadius: 8,
                border: "1px solid rgba(127,127,127,0.25)",
                background: voiceDeafened
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(255,255,255,0.06)",
                color: "white",
                fontWeight: 800,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                flex: "0 0 auto",
              }}
              title={
                voiceDeafened
                  ? "Undeafen (hear others)"
                  : "Deafen (stop hearing)"
              }
              aria-label={
                voiceDeafened
                  ? "Undeafen (hear others)"
                  : "Deafen (stop hearing)"
              }
            >
              {voiceDeafened ? "🔇" : "🔈"}
            </button>
          ) : null}

          <button
            onClick={() => {
              submitChat();
            }}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid rgba(127,127,127,0.25)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
              flex: "0 0 auto",
            }}
            title="Send chat (Enter)"
            aria-label="Send chat"
          >
            Enter
          </button>
        </div>
      </div>
      {/* Top Right Dock */}
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 10 : 12,
          alignItems: isMobile ? "flex-end" : "center",
          pointerEvents: "auto",
        }}
        data-pawnsquare-menu-root
      >
        {/* Shop Button */}
        {avatarSystem === "three-avatar" ? (
          <>
            <button
              onClick={() => {
                setShopOpen(true);
              }}
              style={{
                height: 42,
                padding: "0 16px",
                borderRadius: 21,
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                border: "none",
                color: "white",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                fontWeight: 600,
                fontSize: 14,
              }}
              title="Shop"
            >
              <ShopIcon size={18} />
              Shop
            </button>

            <button
              onClick={() => {
                if (!supabaseUser) {
                  openAuthModal();
                  return;
                }
                setQuestsOpen(true);
              }}
              style={{
                height: 42,
                padding: "0 14px",
                borderRadius: 21,
                background: "rgba(0,0,0,0.35)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                fontWeight: 700,
                fontSize: 13,
              }}
              title="Quests"
              aria-label="Quests"
            >
              <CoinsIcon size={18} />
              Quests
            </button>

            <button
              onClick={() => {
                setSettingsOpen((v) => !v);
              }}
              style={{
                height: 42,
                padding: "0 14px",
                borderRadius: 21,
                background: "rgba(0,0,0,0.35)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                fontWeight: 700,
                fontSize: 13,
              }}
              title="Settings"
              aria-label="Settings"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v6m0 6v6m5.2-13.2l-3 3m-4.4 4.4l-3 3m13.2-4.2l-3 3m-4.4 4.4l-3 3" />
              </svg>
              Settings
            </button>

            <button
              onClick={() => {
                if (!supabaseUser) {
                  openAuthModal();
                  return;
                }
                setMenuOpen((v) => !v);
              }}
              style={{
                height: 42,
                padding: "0 14px",
                borderRadius: 21,
                background: "rgba(0,0,0,0.35)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                fontWeight: 700,
                fontSize: 13,
              }}
              title={supabaseUser ? "Account" : "Login"}
              aria-label={supabaseUser ? "Account" : "Login"}
            >
              <UserIcon size={18} />
              {supabaseUser ? "Account" : "Login"}
            </button>

            {menuOpen ? (
              <div
                style={{
                  position: "fixed",
                  top: 62,
                  right: 12,
                  width: 320,
                  maxWidth: "calc(100vw - 24px)",
                  background: "rgba(0,0,0,0.78)",
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 14,
                  padding: 14,
                  color: "white",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
                  zIndex: 60,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {supabaseUser
                    ? `Signed in${
                        supabaseUser.email ? ` as ${supabaseUser.email}` : ""
                      }`
                    : "Sign in to sync coins + purchases"}
                </div>

                {!supabaseUser ? (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        placeholder="Email"
                        inputMode="email"
                        autoComplete="email"
                        style={{
                          flex: 1,
                          height: 36,
                          padding: "0 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.18)",
                          background: "rgba(255,255,255,0.06)",
                          color: "white",
                          outline: "none",
                          fontSize: 13,
                        }}
                      />
                      <button
                        disabled={authBusy}
                        onClick={async () => {
                          const email = authEmail.trim();
                          if (!email) {
                            setAuthMsg("Enter an email.");
                            return;
                          }
                          setAuthMsg(null);
                          setAuthBusy(true);
                          try {
                            const supabase = getSupabaseBrowserClient();
                            const redirectTo = `${window.location.origin}/auth/magic-link`;
                            const { error } = await supabase.auth.signInWithOtp(
                              {
                                email,
                                options: { emailRedirectTo: redirectTo },
                              }
                            );
                            if (error) {
                              setAuthMsg(error.message);
                            } else {
                              setAuthMsg(
                                "Check your email for the magic link."
                              );
                            }
                          } catch (e) {
                            setAuthMsg(
                              e instanceof Error
                                ? e.message
                                : "Could not start sign-in."
                            );
                          } finally {
                            setAuthBusy(false);
                          }
                        }}
                        style={{
                          height: 36,
                          padding: "0 12px",
                          borderRadius: 10,
                          border: "none",
                          background: authBusy
                            ? "rgba(255,255,255,0.12)"
                            : "#667eea",
                          color: "white",
                          fontWeight: 700,
                          cursor: authBusy ? "not-allowed" : "pointer",
                          fontSize: 13,
                        }}
                      >
                        {authBusy ? "..." : "Email"}
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        disabled={authBusy}
                        onClick={async () => {
                          setAuthMsg(null);
                          try {
                            setAuthBusy(true);
                            const supabase = getSupabaseBrowserClient();
                            const redirectTo = `${window.location.origin}/auth/popup`;
                            const { data, error } =
                              await supabase.auth.signInWithOAuth({
                                provider: "google",
                                options: {
                                  redirectTo,
                                  skipBrowserRedirect: true,
                                },
                              });

                            if (error || !data?.url) {
                              setAuthMsg(
                                error?.message ||
                                  "Could not start Google sign-in."
                              );
                              return;
                            }

                            const popup = openCenteredPopup(
                              data.url,
                              "pawnsquare-oauth"
                            );
                            if (!popup) {
                              setAuthMsg(
                                "Popup blocked. Allow popups and try again."
                              );
                              return;
                            }
                            setAuthMsg("Complete sign-in in the popup...");
                          } catch {
                            setAuthMsg("Could not start Google sign-in.");
                          } finally {
                            setAuthBusy(false);
                          }
                        }}
                        style={{
                          height: 34,
                          padding: "0 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "transparent",
                          color: "white",
                          fontWeight: 700,
                          cursor: authBusy ? "not-allowed" : "pointer",
                          fontSize: 13,
                          opacity: authBusy ? 0.6 : 1,
                        }}
                      >
                        Google
                      </button>

                      <button
                        disabled={authBusy}
                        onClick={async () => {
                          setAuthMsg(null);
                          try {
                            setAuthBusy(true);
                            const supabase = getSupabaseBrowserClient();
                            const redirectTo = `${window.location.origin}/auth/popup`;
                            const { data, error } =
                              await supabase.auth.signInWithOAuth({
                                provider: "discord",
                                options: {
                                  redirectTo,
                                  skipBrowserRedirect: true,
                                },
                              });

                            if (error || !data?.url) {
                              setAuthMsg(
                                error?.message ||
                                  "Could not start Discord sign-in."
                              );
                              return;
                            }

                            const popup = openCenteredPopup(
                              data.url,
                              "pawnsquare-oauth"
                            );
                            if (!popup) {
                              setAuthMsg(
                                "Popup blocked. Allow popups and try again."
                              );
                              return;
                            }
                            setAuthMsg("Complete sign-in in the popup...");
                          } catch {
                            setAuthMsg("Could not start Discord sign-in.");
                          } finally {
                            setAuthBusy(false);
                          }
                        }}
                        style={{
                          height: 34,
                          padding: "0 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "transparent",
                          color: "white",
                          fontWeight: 700,
                          cursor: authBusy ? "not-allowed" : "pointer",
                          fontSize: 13,
                          opacity: authBusy ? 0.6 : 1,
                        }}
                      >
                        Discord
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <button
                      onClick={async () => {
                        setAuthMsg(null);
                        try {
                          const supabase = getSupabaseBrowserClient();
                          const { error } = await supabase.auth.signOut();
                          if (error) {
                            setAuthMsg(error.message);
                          } else {
                            resetToDefaults();
                            setSupabaseUser(null);
                            setMenuOpen(false);
                          }
                        } catch (e) {
                          setAuthMsg(
                            e instanceof Error
                              ? e.message
                              : "Could not sign out."
                          );
                        }
                      }}
                      style={{
                        height: 36,
                        padding: "0 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.16)",
                        background: "transparent",
                        color: "white",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      Log out
                    </button>
                  </div>
                )}

                {authMsg ? (
                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                    {authMsg}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {boardControls ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 55,
            pointerEvents: "auto",
            padding: 16,
          }}
          onClick={() => setBoardControls(null)}
        >
          <div
            style={{
              width: 480,
              maxWidth: "min(94vw, 550px)",
              maxHeight: "90vh",
              borderRadius: 20,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.18)",
              background:
                boardControls.lobby === "scifi"
                  ? "linear-gradient(135deg, rgba(0,255,255,0.16), rgba(80,0,120,0.25))"
                  : "linear-gradient(135deg, rgba(255,255,255,0.88), rgba(230,245,250,0.92))",
              boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
              color: boardControls.lobby === "scifi" ? "#e6f7ff" : "#0f2c34",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const mode: BoardMode =
                (boardModes?.[boardControls.boardKey] as BoardMode) ?? "chess";
              const isChess4Way = boardControls.boardKey === "m";

              return (
                <>
                  {/* Header */}
                  <div
                    style={{
                      padding: "20px 24px",
                      borderBottom:
                        boardControls.lobby === "scifi"
                          ? "1px solid rgba(0,255,255,0.2)"
                          : "1px solid rgba(0,0,0,0.08)",
                      background:
                        boardControls.lobby === "scifi"
                          ? "rgba(0,0,0,0.25)"
                          : "rgba(255,255,255,0.45)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.65,
                            marginBottom: 4,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            fontWeight: 600,
                          }}
                        >
                          Board Controls
                        </div>
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 800,
                            letterSpacing: 0.5,
                          }}
                        >
                          {boardControls.boardKey.toUpperCase()}
                        </div>
                      </div>
                      <button
                        onClick={() => setBoardControls(null)}
                        style={{
                          border: "none",
                          background:
                            boardControls.lobby === "scifi"
                              ? "rgba(255,255,255,0.12)"
                              : "rgba(0,0,0,0.06)",
                          color: "inherit",
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          cursor: "pointer",
                          fontSize: 18,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="Close"
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div
                        style={{
                          padding: "8px 14px",
                          borderRadius: 12,
                          border:
                            boardControls.lobby === "scifi"
                              ? "1px solid rgba(0,255,255,0.35)"
                              : "1px solid rgba(0,0,0,0.12)",
                          background:
                            boardControls.lobby === "scifi"
                              ? "rgba(0,0,0,0.4)"
                              : "rgba(255,255,255,0.75)",
                          fontSize: 13,
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      >
                        {isChess4Way ? "Chess 4P" : mode}
                      </div>
                      <div
                        style={{
                          padding: "8px 14px",
                          borderRadius: 12,
                          border:
                            boardControls.lobby === "scifi"
                              ? "1px solid rgba(0,255,255,0.35)"
                              : "1px solid rgba(0,0,0,0.12)",
                          background:
                            boardControls.lobby === "scifi"
                              ? "rgba(0,0,0,0.4)"
                              : "rgba(255,255,255,0.75)",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        ⏱ {boardControls.timeMinutes}min
                        {boardControls.incrementSeconds > 0
                          ? ` + ${boardControls.incrementSeconds}s`
                          : ""}
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div
                    style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}
                  >
                    {/* Game Mode Section */}
                    <div style={{ marginBottom: 24 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          marginBottom: 12,
                          opacity: 0.75,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Game Mode
                      </div>

                      {isChess4Way ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(140px, 1fr))",
                            gap: 10,
                          }}
                        >
                          {(
                            [
                              { key: "2v2", label: "2v2" },
                              { key: "ffa", label: "FFA" },
                            ] as const
                          ).map((v) => {
                            const selected =
                              boardControls.chess4Variant === v.key;
                            const canClick =
                              !!boardControls.onSetChess4Variant &&
                              (boardControls.canSetChess4Variant ?? false);
                            const borderSelected =
                              boardControls.lobby === "scifi"
                                ? "2px solid rgba(0,255,255,0.6)"
                                : "2px solid rgba(100,100,255,0.5)";
                            const borderIdle =
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(0,255,255,0.25)"
                                : "1px solid rgba(0,0,0,0.12)";
                            const bgSelected =
                              boardControls.lobby === "scifi"
                                ? "rgba(0,255,255,0.15)"
                                : "rgba(100,100,255,0.12)";
                            const bgIdle =
                              boardControls.lobby === "scifi"
                                ? "rgba(0,0,0,0.25)"
                                : "rgba(255,255,255,0.65)";

                            return (
                              <button
                                key={v.key}
                                onClick={() => {
                                  if (!canClick) return;
                                  boardControls.onSetChess4Variant?.(v.key);
                                  setBoardControls(null);
                                }}
                                disabled={!canClick}
                                style={{
                                  padding: "14px",
                                  borderRadius: 12,
                                  border: selected
                                    ? borderSelected
                                    : borderIdle,
                                  background: selected ? bgSelected : bgIdle,
                                  color: "inherit",
                                  cursor: canClick ? "pointer" : "not-allowed",
                                  fontWeight: selected ? 800 : 600,
                                  fontSize: 14,
                                  transition: "all 0.2s",
                                  width: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 6,
                                  opacity: canClick ? 1 : 0.4,
                                }}
                              >
                                {v.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {isChess4Way ? (
                        boardControls.chess4CanClaimWin ? (
                          <div style={{ marginTop: 14 }}>
                            <button
                              onClick={() => {
                                boardControls.onChess4ClaimWin?.();
                                setBoardControls(null);
                              }}
                              style={{
                                width: "100%",
                                padding: "14px",
                                borderRadius: 12,
                                border:
                                  boardControls.lobby === "scifi"
                                    ? "2px solid rgba(0,255,255,0.45)"
                                    : "2px solid rgba(100,100,255,0.35)",
                                background:
                                  boardControls.lobby === "scifi"
                                    ? "linear-gradient(135deg, rgba(0,255,255,0.18), rgba(0,200,255,0.12))"
                                    : "linear-gradient(135deg, rgba(100,100,255,0.14), rgba(150,150,255,0.09))",
                                color: "inherit",
                                cursor: "pointer",
                                fontWeight: 800,
                                fontSize: 14,
                                letterSpacing: 0.4,
                              }}
                            >
                              Claim Win
                            </button>
                          </div>
                        ) : null
                      ) : (
                        <>
                          {/*
                            Unification note:
                            - This list is rendered from `BOARD_MODE_DEFS` (see `src/lib/boardModes.ts`).
                            - Adding a new mode should only require adding it to the registry.
                            - The “Open 2D Board” button is intentionally restricted to chess-engine modes
                              (`engineForMode(mode) === "chess"`).
                          */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(140px, 1fr))",
                              gap: 10,
                            }}
                          >
                            {BOARD_MODE_DEFS.map((def) => {
                              const selected = mode === def.key;
                              const isGoose = def.key === "goose";
                              const borderSelected = isGoose
                                ? boardControls.lobby === "scifi"
                                  ? "2px solid rgba(255,200,0,0.6)"
                                  : "2px solid rgba(255,180,0,0.5)"
                                : boardControls.lobby === "scifi"
                                ? "2px solid rgba(0,255,255,0.6)"
                                : "2px solid rgba(100,100,255,0.5)";
                              const borderIdle =
                                boardControls.lobby === "scifi"
                                  ? "1px solid rgba(0,255,255,0.25)"
                                  : "1px solid rgba(0,0,0,0.12)";
                              const bgSelected = isGoose
                                ? boardControls.lobby === "scifi"
                                  ? "rgba(255,200,0,0.15)"
                                  : "rgba(255,180,0,0.12)"
                                : boardControls.lobby === "scifi"
                                ? "rgba(0,255,255,0.15)"
                                : "rgba(100,100,255,0.12)";
                              const bgIdle =
                                boardControls.lobby === "scifi"
                                  ? "rgba(0,0,0,0.25)"
                                  : "rgba(255,255,255,0.65)";

                              const button = (
                                <button
                                  key={def.key}
                                  onClick={() => {
                                    setBoardMode(
                                      boardControls.boardKey,
                                      def.key
                                    );
                                    setJoinedBoardKey((prev) =>
                                      prev === boardControls.boardKey
                                        ? null
                                        : prev
                                    );
                                    setPendingJoinBoardKey(null);
                                    setBoardControls(null);
                                  }}
                                  style={{
                                    padding: "14px",
                                    borderRadius: 12,
                                    border: selected
                                      ? borderSelected
                                      : borderIdle,
                                    background: selected ? bgSelected : bgIdle,
                                    color: "inherit",
                                    cursor: "pointer",
                                    fontWeight: selected ? 800 : 600,
                                    fontSize: 14,
                                    transition: "all 0.2s",
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 6,
                                  }}
                                >
                                  {def.icon} {def.label}
                                </button>
                              );

                              if (def.key !== "goose") return button;

                              return (
                                <div
                                  key={def.key}
                                  style={{ position: "relative" }}
                                >
                                  {button}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowGooseInfo(true);
                                    }}
                                    style={{
                                      position: "absolute",
                                      top: 4,
                                      right: 4,
                                      border: "none",
                                      background: "rgba(0,0,0,0.2)",
                                      color: "inherit",
                                      width: 18,
                                      height: 18,
                                      borderRadius: "50%",
                                      cursor: "pointer",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                    title="Learn about Goose Chess"
                                  >
                                    ?
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}

                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          marginTop: 16,
                          marginBottom: 8,
                          opacity: 0.65,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Time
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          marginBottom: 10,
                          opacity: 0.75,
                        }}
                      >
                        Current: {boardControls.timeMinutes}min
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <button
                          onClick={boardControls.onDec}
                          disabled={!boardControls.canDec}
                          style={{
                            padding: "14px",
                            borderRadius: 12,
                            border:
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(0,255,255,0.35)"
                                : "1px solid rgba(0,0,0,0.12)",
                            background:
                              boardControls.lobby === "scifi"
                                ? "rgba(0,0,0,0.3)"
                                : "rgba(255,255,255,0.8)",
                            color: "inherit",
                            cursor: boardControls.canDec
                              ? "pointer"
                              : "not-allowed",
                            opacity: boardControls.canDec ? 1 : 0.4,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          ⏱ Decrease Time
                        </button>
                        <button
                          onClick={boardControls.onInc}
                          disabled={!boardControls.canInc}
                          style={{
                            padding: "14px",
                            borderRadius: 12,
                            border:
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(0,255,255,0.35)"
                                : "1px solid rgba(0,0,0,0.12)",
                            background:
                              boardControls.lobby === "scifi"
                                ? "rgba(0,0,0,0.3)"
                                : "rgba(255,255,255,0.8)",
                            color: "inherit",
                            cursor: boardControls.canInc
                              ? "pointer"
                              : "not-allowed",
                            opacity: boardControls.canInc ? 1 : 0.4,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          ⏱ Increase Time
                        </button>
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          marginTop: 16,
                          marginBottom: 8,
                          opacity: 0.65,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Increment
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          marginBottom: 10,
                          opacity: 0.75,
                        }}
                      >
                        Current: {boardControls.incrementSeconds}s
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <button
                          onClick={boardControls.onDecIncrement}
                          disabled={!boardControls.canDecIncrement}
                          style={{
                            padding: "14px",
                            borderRadius: 12,
                            border:
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(0,255,255,0.35)"
                                : "1px solid rgba(0,0,0,0.12)",
                            background:
                              boardControls.lobby === "scifi"
                                ? "rgba(0,0,0,0.3)"
                                : "rgba(255,255,255,0.8)",
                            color: "inherit",
                            cursor: boardControls.canDecIncrement
                              ? "pointer"
                              : "not-allowed",
                            opacity: boardControls.canDecIncrement ? 1 : 0.4,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          ➖ Decrease
                        </button>
                        <button
                          onClick={boardControls.onIncIncrement}
                          disabled={!boardControls.canIncIncrement}
                          style={{
                            padding: "14px",
                            borderRadius: 12,
                            border:
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(0,255,255,0.35)"
                                : "1px solid rgba(0,0,0,0.12)",
                            background:
                              boardControls.lobby === "scifi"
                                ? "rgba(0,0,0,0.3)"
                                : "rgba(255,255,255,0.8)",
                            color: "inherit",
                            cursor: boardControls.canIncIncrement
                              ? "pointer"
                              : "not-allowed",
                            opacity: boardControls.canIncIncrement ? 1 : 0.4,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          ➕ Increase
                        </button>
                      </div>
                    </div>

                    {/* Actions Section */}
                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          marginBottom: 12,
                          opacity: 0.75,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Actions
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <button
                          onClick={() => {
                            boardControls.onCenter();
                            setBoardControls(null);
                          }}
                          disabled={!boardControls.canCenter}
                          style={{
                            padding: "14px",
                            borderRadius: 12,
                            border:
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(0,255,180,0.35)"
                                : "1px solid rgba(0,120,90,0.35)",
                            background:
                              boardControls.lobby === "scifi"
                                ? "rgba(0,50,40,0.4)"
                                : "rgba(210,255,245,0.85)",
                            color:
                              boardControls.lobby === "scifi"
                                ? "#7cffd8"
                                : "#0d2a32",
                            cursor: boardControls.canCenter
                              ? "pointer"
                              : "not-allowed",
                            opacity: boardControls.canCenter ? 1 : 0.4,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          🎯 Center Camera
                        </button>
                        <button
                          onClick={boardControls.onReset}
                          disabled={!boardControls.canReset}
                          style={{
                            padding: "14px",
                            borderRadius: 12,
                            border:
                              boardControls.lobby === "scifi"
                                ? "1px solid rgba(255,90,90,0.5)"
                                : "1px solid rgba(200,40,40,0.35)",
                            background:
                              boardControls.lobby === "scifi"
                                ? "rgba(50,0,0,0.45)"
                                : "rgba(255,230,230,0.8)",
                            color:
                              boardControls.lobby === "scifi"
                                ? "#ffb3b3"
                                : "#5c0f0f",
                            cursor: boardControls.canReset
                              ? "pointer"
                              : "not-allowed",
                            opacity: boardControls.canReset ? 1 : 0.4,
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          ↺ Reset Game
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* Goose Info Modal */}
      {showGooseInfo ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 56,
            pointerEvents: "auto",
            padding: 16,
          }}
          onClick={() => setShowGooseInfo(false)}
        >
          <div
            style={{
              width: 520,
              maxWidth: "94vw",
              borderRadius: 20,
              overflow: "hidden",
              border: "2px solid rgba(255,200,0,0.3)",
              background:
                "linear-gradient(135deg, rgba(255,240,200,0.95), rgba(255,250,220,0.98))",
              boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
              color: "#2a1800",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "24px",
                borderBottom: "1px solid rgba(255,200,0,0.2)",
                background:
                  "linear-gradient(135deg, rgba(255,200,0,0.15), rgba(255,220,100,0.1))",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span>🪿</span>
                  <span>Goose Chess Rules</span>
                </div>
                <button
                  onClick={() => setShowGooseInfo(false)}
                  style={{
                    border: "none",
                    background: "rgba(0,0,0,0.08)",
                    color: "inherit",
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    cursor: "pointer",
                    fontSize: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            <div
              style={{ padding: "24px", maxHeight: "70vh", overflowY: "auto" }}
            >
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 12,
                    color: "#8b5a00",
                  }}
                >
                  How to Play
                </div>
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    padding: "12px 16px",
                    background: "rgba(255,255,255,0.5)",
                    borderRadius: 12,
                    border: "1px solid rgba(255,200,0,0.2)",
                  }}
                >
                  Each turn has two phases:
                  <br />
                  1. <strong>Move your piece</strong> (like normal chess)
                  <br />
                  2. <strong>Move the Goose</strong> to any empty square
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 12,
                    color: "#8b5a00",
                  }}
                >
                  Special Rules
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "rgba(255,255,255,0.5)",
                      borderRadius: 12,
                      border: "1px solid rgba(255,200,0,0.2)",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      🦆 Semi-Solid Goose
                    </div>
                    Pieces (except the King) can jump through the goose square
                    but cannot land on it.
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      background: "rgba(255,255,255,0.5)",
                      borderRadius: 12,
                      border: "1px solid rgba(255,200,0,0.2)",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      📢 Honk Effect
                    </div>
                    Pieces adjacent to the goose are "startled" and cannot
                    capture or give check.
                  </div>

                  <div
                    style={{
                      padding: "12px 16px",
                      background: "rgba(255,255,255,0.5)",
                      borderRadius: 12,
                      border: "1px solid rgba(255,200,0,0.2)",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      🎯 Center Restriction
                    </div>
                    After move 20, the goose cannot be placed in the center 4
                    squares (d4, e4, d5, e5).
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Quests Modal */}
      {questsOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: isMobile ? "stretch" : "center",
            justifyContent: isMobile ? "stretch" : "center",
            zIndex: 51,
          }}
          onClick={() => setQuestsOpen(false)}
        >
          <div
            style={{
              width: isMobile ? "100vw" : 680,
              maxWidth: isMobile ? "100vw" : "90vw",
              height: isMobile ? "100vh" : 520,
              maxHeight: isMobile ? "100vh" : "90vh",
              background: "#1a1a1a",
              borderRadius: isMobile ? 0 : 16,
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: isMobile ? "12px 14px" : "16px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>Quests</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Daily/weekly quests that award coins
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(255,255,255,0.1)",
                    padding: "6px 12px",
                    borderRadius: 20,
                    fontSize: 14,
                  }}
                >
                  <CoinsIcon size={16} />
                  {coins}
                </div>

                <button
                  onClick={() => setQuestsOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.6)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                  aria-label="Close quests"
                  title="Close"
                >
                  <CloseIcon size={24} />
                </button>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                padding: isMobile ? 14 : 18,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                overflowY: "auto",
              }}
            >
              {!supabaseUser ? (
                <button
                  onClick={openAuthModal}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.18)",
                    padding: "10px 12px",
                    borderRadius: 12,
                    color: "white",
                    cursor: "pointer",
                    width: "fit-content",
                  }}
                >
                  Sign in to earn rewards
                </button>
              ) : null}

              {quests.map((q) => (
                <div
                  key={q.id}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.06)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{q.title}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {q.period === "weekly" ? "Weekly" : "Daily"}
                      </div>
                    </div>

                    <div
                      style={{
                        height: 8,
                        background: "rgba(255,255,255,0.10)",
                        borderRadius: 999,
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${
                            q.target > 0
                              ? Math.min(100, (q.progress / q.target) * 100)
                              : q.completed
                              ? 100
                              : 0
                          }%`,
                          background: "#667eea",
                        }}
                      />
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {q.target > 0
                        ? `${Math.min(q.progress, q.target)}/${q.target}`
                        : q.completed
                        ? "Complete"
                        : ""}
                      {q.nextResetAt ? (
                        <span style={{ marginLeft: 10, opacity: 0.7 }}>
                          Resets{" "}
                          {new Date(q.nextResetAt).toUTCString().slice(0, 16)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <CoinsIcon size={14} />+{q.coins}
                    </div>

                    <button
                      disabled={
                        !supabaseUser || questsBusy || q.claimed || !q.completed
                      }
                      onClick={() => claimQuest(q.id)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        background:
                          q.claimed || !q.completed
                            ? "rgba(255,255,255,0.08)"
                            : "#667eea",
                        color: "white",
                        border: "1px solid rgba(255,255,255,0.12)",
                        cursor:
                          !supabaseUser ||
                          questsBusy ||
                          q.claimed ||
                          !q.completed
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          !supabaseUser ||
                          questsBusy ||
                          q.claimed ||
                          !q.completed
                            ? 0.65
                            : 1,
                        fontWeight: 800,
                        fontSize: 12,
                        minWidth: 96,
                      }}
                    >
                      {q.claimed
                        ? "Claimed"
                        : q.completed
                        ? "Claim"
                        : "In progress"}
                    </button>
                  </div>
                </div>
              ))}

              {questsMsg ? (
                <div style={{ color: "#ffd700", fontSize: 12 }}>
                  {questsMsg}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => void fetchQuests()}
                  disabled={questsBusy || !supabaseUser}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.16)",
                    padding: "10px 12px",
                    borderRadius: 12,
                    color: "white",
                    cursor:
                      questsBusy || !supabaseUser ? "not-allowed" : "pointer",
                    opacity: questsBusy || !supabaseUser ? 0.6 : 1,
                    width: "fit-content",
                  }}
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Shop Modal */}
      {shopOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: isMobile ? "stretch" : "center",
            justifyContent: isMobile ? "stretch" : "center",
            zIndex: 50,
          }}
          onClick={() => setShopOpen(false)}
        >
          <div
            style={{
              width: isMobile ? "100vw" : 800,
              maxWidth: isMobile ? "100vw" : "90vw",
              height: isMobile ? "100vh" : 600,
              maxHeight: isMobile ? "100vh" : "90vh",
              background: "#1a1a1a",
              borderRadius: isMobile ? 0 : 16,
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: isMobile ? "12px 14px" : "16px 24px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: isMobile ? 10 : 24,
                  alignItems: "center",
                  flexWrap: isMobile ? "wrap" : "nowrap",
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 600 }}>Shop</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(255,255,255,0.1)",
                    padding: "6px 12px",
                    borderRadius: 20,
                    fontSize: 14,
                  }}
                >
                  <CoinsIcon size={16} />
                  {coins}
                  <button
                    onClick={() => setShopTab("coins")}
                    style={{
                      background: "#667eea",
                      border: "none",
                      borderRadius: "50%",
                      width: 18,
                      height: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      cursor: "pointer",
                      marginLeft: 4,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                    title="Buy coins"
                    aria-label="Buy coins"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => setShopOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.6)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  <CloseIcon size={24} />
                </button>
              </div>
            </div>

            {/* Tabs Row */}
            <div
              style={{
                padding: isMobile ? "10px 14px" : "10px 24px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {(["avatar", "theme", "chess", "quests"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setShopTab(t);
                    setShopSelectedId(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    background:
                      shopTab === t
                        ? "rgba(255,255,255,0.18)"
                        : "rgba(255,255,255,0.06)",
                    color: shopTab === t ? "white" : "rgba(255,255,255,0.75)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    textTransform: "capitalize",
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {t === "avatar" ? (
                    <UserIcon size={16} />
                  ) : t === "theme" ? (
                    <PaletteIcon size={16} />
                  ) : t === "quests" ? (
                    <CoinsIcon size={16} />
                  ) : (
                    <ChessPieceIcon size={16} />
                  )}
                  {t === "chess"
                    ? "Chess"
                    : t === "quests"
                    ? "Quests"
                    : `${t.slice(0, 1).toUpperCase()}${t.slice(1)}s`}
                </button>
              ))}
            </div>

            {/* Content */}
            <div
              style={{
                flex: 1,
                display: "flex",
                overflow: "hidden",
                flexDirection: isMobile ? "column" : "row",
              }}
            >
              {shopTab === "coins" ? (
                <div
                  style={{
                    flex: 1,
                    padding: 32,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 24,
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 600 }}>
                    Get More Coins
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    {COIN_PACKS.map((p) => (
                      <button
                        key={p.id}
                        disabled={stripeBusy || !supabaseUser}
                        style={{
                          padding: "24px",
                          borderRadius: 16,
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 12,
                          cursor:
                            stripeBusy || !supabaseUser
                              ? "not-allowed"
                              : "pointer",
                          opacity: stripeBusy || !supabaseUser ? 0.6 : 1,
                          width: 160,
                        }}
                        onClick={async () => {
                          if (!self?.id) return;
                          if (!supabaseUser) {
                            setAuthMsg("Sign in required before purchases.");
                            return;
                          }
                          setStripeMsg(null);
                          try {
                            setStripeBusy(true);
                            const supabase = getSupabaseBrowserClient();
                            const { data: sessionData } =
                              await supabase.auth.getSession();
                            const token = sessionData.session?.access_token;
                            if (!token) {
                              setAuthMsg("Sign in required before purchases.");
                              return;
                            }
                            const res = await fetch(
                              "/api/stripe/create-checkout",
                              {
                                method: "POST",
                                headers: {
                                  "content-type": "application/json",
                                  authorization: `Bearer ${token}`,
                                },
                                body: JSON.stringify({
                                  packId: p.id,
                                  roomId,
                                  playerId: self.id,
                                }),
                              }
                            );
                            const data = (await res.json()) as {
                              url?: string;
                              error?: string;
                            };
                            if (!data.url) {
                              setStripeMsg(
                                data.error || "Could not start checkout."
                              );
                              return;
                            }
                            const popup = window.open(
                              data.url,
                              "pawnsquare-checkout",
                              "width=600,height=800"
                            );
                            setStripeMsg("Complete payment in the popup...");

                            // Poll to see if popup is closed
                            const timer = setInterval(() => {
                              if (popup && popup.closed) {
                                clearInterval(timer);
                                setStripeBusy(false);
                                setStripeMsg(null);
                              }
                            }, 500);
                          } catch {
                            setStripeMsg("Could not start checkout.");
                            setStripeBusy(false);
                          }
                        }}
                      >
                        <CoinsIcon size={32} />
                        <div style={{ fontSize: 20, fontWeight: 600 }}>
                          {p.coins}
                        </div>
                        <div
                          style={{
                            padding: "6px 12px",
                            background: "#667eea",
                            borderRadius: 8,
                            fontSize: 14,
                            fontWeight: 600,
                          }}
                        >
                          {p.priceLabel}
                        </div>
                      </button>
                    ))}
                  </div>
                  {stripeMsg && (
                    <div style={{ color: "#ffd700" }}>{stripeMsg}</div>
                  )}
                  {!supabaseUser && (
                    <button
                      onClick={openAuthModal}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: "#ff6b6b",
                        cursor: "pointer",
                        textDecoration: "underline",
                        font: "inherit",
                        textUnderlineOffset: 3,
                      }}
                    >
                      Sign in required to purchase coins.
                    </button>
                  )}
                </div>
              ) : shopTab === "quests" ? (
                <div
                  style={{
                    flex: 1,
                    padding: 24,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    overflowY: "auto",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 10 }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 800 }}>Quests</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Daily/weekly coin bonuses
                    </div>
                  </div>

                  {!supabaseUser ? (
                    <button
                      onClick={openAuthModal}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,0.18)",
                        padding: "10px 12px",
                        borderRadius: 12,
                        color: "white",
                        cursor: "pointer",
                        width: "fit-content",
                      }}
                    >
                      Sign in to claim rewards
                    </button>
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {quests.map((q) => (
                      <div
                        key={q.id}
                        style={{
                          display: "flex",
                          alignItems: "stretch",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "12px 14px",
                          borderRadius: 14,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.06)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            flex: 1,
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>{q.title}</div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            {q.period === "weekly" ? "Weekly" : "Daily"} •
                            Resets{" "}
                            {q.nextResetAt
                              ? new Date(q.nextResetAt)
                                  .toUTCString()
                                  .slice(0, 16)
                              : "soon"}
                          </div>

                          <div
                            style={{
                              marginTop: 6,
                              height: 8,
                              background: "rgba(255,255,255,0.10)",
                              borderRadius: 999,
                              overflow: "hidden",
                              border: "1px solid rgba(255,255,255,0.10)",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${
                                  q.target > 0
                                    ? Math.min(
                                        100,
                                        (q.progress / q.target) * 100
                                      )
                                    : q.completed
                                    ? 100
                                    : 0
                                }%`,
                                background: "#667eea",
                              }}
                            />
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {q.target > 0
                              ? `${Math.min(q.progress, q.target)}/${q.target}`
                              : q.completed
                              ? "Complete"
                              : ""}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 10px",
                              borderRadius: 999,
                              background: "rgba(255,255,255,0.08)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              fontSize: 12,
                            }}
                          >
                            <CoinsIcon size={14} />+{q.coins}
                          </div>

                          <button
                            disabled={
                              !supabaseUser ||
                              questsBusy ||
                              q.claimed ||
                              !q.completed
                            }
                            onClick={() => claimQuest(q.id)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              background: q.claimed
                                ? "rgba(255,255,255,0.08)"
                                : !q.completed
                                ? "rgba(255,255,255,0.08)"
                                : "#667eea",
                              color: "white",
                              border: "1px solid rgba(255,255,255,0.12)",
                              cursor:
                                !supabaseUser ||
                                questsBusy ||
                                q.claimed ||
                                !q.completed
                                  ? "not-allowed"
                                  : "pointer",
                              opacity:
                                !supabaseUser ||
                                questsBusy ||
                                q.claimed ||
                                !q.completed
                                  ? 0.65
                                  : 1,
                              fontWeight: 800,
                              fontSize: 12,
                              minWidth: 86,
                            }}
                          >
                            {q.claimed
                              ? "Claimed"
                              : q.completed
                              ? "Claim"
                              : "In progress"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {questsMsg ? (
                    <div style={{ color: "#ffd700", fontSize: 12 }}>
                      {questsMsg}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => void fetchQuests()}
                      disabled={questsBusy || !supabaseUser}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(255,255,255,0.16)",
                        padding: "10px 12px",
                        borderRadius: 12,
                        color: "white",
                        cursor:
                          questsBusy || !supabaseUser
                            ? "not-allowed"
                            : "pointer",
                        opacity: questsBusy || !supabaseUser ? 0.6 : 1,
                        width: "fit-content",
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Sidebar / List */}
                  <div
                    style={{
                      width: isMobile ? "100%" : 280,
                      borderRight: isMobile
                        ? "none"
                        : "1px solid rgba(255,255,255,0.1)",
                      borderBottom: isMobile
                        ? "1px solid rgba(255,255,255,0.1)"
                        : "none",
                      overflowY: "auto",
                      overflowX: "hidden",
                      padding: isMobile ? 12 : 16,
                      display: isMobile ? "grid" : "flex",
                      gridTemplateColumns: isMobile ? "1fr 1fr" : undefined,
                      alignContent: "start",
                      flexDirection: isMobile ? undefined : "column",
                      gap: 8,
                      flex: isMobile ? "0 0 45%" : undefined,
                      minHeight: 0,
                    }}
                  >
                    {SHOP_ITEMS.filter((i) => {
                      if (i.type !== shopTab) return false;
                      if (isShopItemLocked(i, ownedItemIds)) return false;
                      return true;
                    }).map((item) => {
                      const owned = isShopItemOwned(item, ownedItemIds);
                      const selected = shopSelectedId === item.id;
                      const equipped = isItemEquipped(item);
                      return (
                        <button
                          key={item.id}
                          onClick={() => setShopSelectedId(item.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: isMobile ? "10px" : "12px",
                            borderRadius: 8,
                            background: selected
                              ? "rgba(255,255,255,0.1)"
                              : "transparent",
                            border: "none",
                            color: "white",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background 0.2s",
                            minHeight: isMobile ? 54 : undefined,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            <div style={{ fontWeight: 500 }}>
                              {item.name}
                              {item.id === "theme_scifi" ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 12,
                                    opacity: 0.9,
                                    color: "#ffd700",
                                  }}
                                >
                                  BETA
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              opacity: owned ? 0.5 : 1,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {owned ? (
                              equipped ? (
                                "Equipped"
                              ) : (
                                "Owned"
                              )
                            ) : (
                              <>
                                <CoinsIcon size={12} />
                                {item.price}
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Preview Area */}
                  <div
                    style={{
                      flex: isMobile ? "1 1 55%" : 1,
                      padding: isMobile ? 14 : 24,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: isMobile ? "flex-start" : "center",
                      gap: 24,
                      minHeight: 0,
                      overflowY: isMobile ? "auto" : "visible",
                      background:
                        "radial-gradient(circle at center, rgba(255,255,255,0.05) 0%, transparent 70%)",
                    }}
                  >
                    {(() => {
                      const previewW = isMobile ? 240 : 300;
                      const previewH = isMobile ? 240 : 400;
                      const item = SHOP_ITEMS.find(
                        (i) => i.id === shopSelectedId
                      );
                      if (!item || isShopItemLocked(item, ownedItemIds))
                        return (
                          <div style={{ opacity: 0.5 }}>Select an item</div>
                        );
                      const owned = isShopItemOwned(item, ownedItemIds);
                      const canBuy = !owned && coins >= item.price;
                      const equipped = isItemEquipped(item);

                      return (
                        <>
                          <div
                            style={{
                              width: previewW,
                              height: previewH,
                              background: "rgba(0,0,0,0.2)",
                              borderRadius: 12,
                              overflow: "hidden",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1px solid rgba(255,255,255,0.1)",
                            }}
                          >
                            {item.type === "avatar" ? (
                              <VrmPreview
                                key={item.url}
                                url={item.url}
                                width={previewW}
                                height={previewH}
                              />
                            ) : item.type === "chess" ? (
                              <div style={{ width: "100%", height: "100%" }}>
                                {(item as any).chessKind === "board" ? (
                                  <ChessBoardPreview
                                    key={item.id}
                                    boardTheme={item.id}
                                  />
                                ) : (
                                  <ChessSetPreview
                                    key={item.id}
                                    chessTheme={item.id}
                                  />
                                )}
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 16,
                                  opacity: 0.7,
                                }}
                              >
                                {(item as any).previewImage ? (
                                  <div style={{ position: "relative" }}>
                                    <img
                                      src={(item as any).previewImage}
                                      alt={item.name}
                                      style={{
                                        width: isMobile ? 180 : 240,
                                        height: isMobile ? 180 : 240,
                                        objectFit: "cover",
                                        borderRadius: 12,
                                        border:
                                          "1px solid rgba(255,255,255,0.12)",
                                      }}
                                    />
                                    {item.id === "theme_scifi" ? (
                                      <div
                                        style={{
                                          position: "absolute",
                                          top: 10,
                                          left: 10,
                                          padding: "6px 10px",
                                          borderRadius: 8,
                                          background: "rgba(0,0,0,0.55)",
                                          border:
                                            "1px solid rgba(255,255,255,0.18)",
                                          color: "#ffd700",
                                          fontSize: 12,
                                          fontWeight: 700,
                                          letterSpacing: 0.6,
                                        }}
                                      >
                                        BETA / UNDER CONSTRUCTION
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <ThemeIcon size={64} />
                                )}
                                <div>
                                  {item.type === "theme"
                                    ? "World Theme"
                                    : "Chess Set"}
                                </div>
                              </div>
                            )}
                          </div>

                          {!isMobile ? (
                            <>
                              <div style={{ display: "flex", gap: 16 }}>
                                {!owned ? (
                                  <button
                                    disabled={!canBuy || !supabaseUser}
                                    onClick={() => {
                                      if (!supabaseUser) {
                                        setAuthMsg("Sign in to buy.");
                                        return;
                                      }
                                      if (!canBuy) return;

                                      const newCoins = Math.max(
                                        0,
                                        coins - item.price
                                      );
                                      const newOwnedItems =
                                        normalizeOwnedItemIds([
                                          ...ownedItemIds,
                                          item.id,
                                        ]);
                                      const newOwnedLegacy =
                                        toLegacyOwnedAvatarsValues(
                                          newOwnedItems
                                        );

                                      setCoins(newCoins);
                                      setOwnedItemIds(newOwnedItems);

                                      const supabase =
                                        getSupabaseBrowserClient();
                                      supabase
                                        .from("profiles")
                                        .update({
                                          coins: newCoins,
                                          owned_items: newOwnedItems,
                                          owned_avatars: newOwnedLegacy,
                                        })
                                        .eq("id", supabaseUser.id)
                                        .then(({ error }) => {
                                          if (error) {
                                            console.error(
                                              "Purchase error:",
                                              error
                                            );
                                            setAuthMsg(
                                              `Purchase failed: ${error.message}`
                                            );
                                            setCoins(coins);
                                            setOwnedItemIds(ownedItemIds);
                                          }
                                        });
                                    }}
                                    style={{
                                      padding: "12px 32px",
                                      borderRadius: 8,
                                      background: canBuy
                                        ? "#667eea"
                                        : "rgba(255,255,255,0.1)",
                                      color: "white",
                                      border: "none",
                                      fontSize: 16,
                                      fontWeight: 600,
                                      cursor: canBuy
                                        ? "pointer"
                                        : "not-allowed",
                                      opacity: canBuy ? 1 : 0.5,
                                    }}
                                  >
                                    Buy for {item.price}
                                  </button>
                                ) : (
                                  <button
                                    disabled={equipped}
                                    onClick={() => {
                                      if (equipped) return;
                                      if (item.type === "avatar") {
                                        setDebugAvatarUrl(item.url);
                                        setAvatarUrl(item.url);
                                        void persistEquipped({
                                          equipped_avatar_url: item.url,
                                        });
                                      } else if (
                                        item.type === "theme" &&
                                        onLobbyChange
                                      ) {
                                        if (item.id === "theme_scifi") {
                                          onLobbyChange("scifi");
                                        } else {
                                          onLobbyChange("park");
                                        }
                                        void persistEquipped({
                                          equipped_theme: item.id,
                                        });
                                      } else if (item.type === "chess") {
                                        if (
                                          (item as any).chessKind === "board"
                                        ) {
                                          setChessBoardTheme(item.id);
                                          void persistEquipped({
                                            equipped_chess_board: item.id,
                                          });
                                        } else {
                                          setChessTheme(item.id);
                                          void persistEquipped({
                                            equipped_chess_set: item.id,
                                          });
                                        }
                                      }
                                    }}
                                    style={{
                                      padding: "12px 32px",
                                      borderRadius: 8,
                                      background: equipped
                                        ? "rgba(255,255,255,0.2)"
                                        : "white",
                                      color: "black",
                                      border: "none",
                                      fontSize: 16,
                                      fontWeight: 600,
                                      cursor: equipped ? "default" : "pointer",
                                      opacity: equipped ? 0.8 : 1,
                                    }}
                                  >
                                    {equipped ? "Equipped" : "Equip"}
                                  </button>
                                )}
                              </div>

                              {!supabaseUser && !owned && item.price > 0 && (
                                <button
                                  onClick={openAuthModal}
                                  style={{
                                    fontSize: 12,
                                    background: "transparent",
                                    border: "none",
                                    padding: 0,
                                    color: "#ff6b6b",
                                    cursor: "pointer",
                                    textDecoration: "underline",
                                    font: "inherit",
                                    textUnderlineOffset: 3,
                                  }}
                                >
                                  Sign in required to purchase
                                </button>
                              )}
                            </>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>

            {/* Mobile Sticky Footer (prevents clipped actions) */}
            {isMobile && shopTab !== "coins" ? (
              <div
                style={{
                  position: "sticky",
                  bottom: 0,
                  zIndex: 2,
                  borderTop: "1px solid rgba(255,255,255,0.12)",
                  background: "#1a1a1a",
                  padding: "10px 14px",
                  paddingBottom:
                    "calc(10px + env(safe-area-inset-bottom, 0px))",
                }}
              >
                {(() => {
                  const item = SHOP_ITEMS.find((i) => i.id === shopSelectedId);
                  if (!item || isShopItemLocked(item, ownedItemIds))
                    return null;
                  const owned = isShopItemOwned(item, ownedItemIds);
                  const canBuy = !owned && coins >= item.price;
                  const equipped = isItemEquipped(item);

                  return (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", gap: 12, width: "100%" }}>
                        {!owned ? (
                          <button
                            disabled={!canBuy || !supabaseUser}
                            onClick={() => {
                              if (!supabaseUser) {
                                openAuthModal();
                                return;
                              }
                              if (!canBuy) return;

                              const newCoins = Math.max(0, coins - item.price);
                              const newOwnedItems = normalizeOwnedItemIds([
                                ...ownedItemIds,
                                item.id,
                              ]);
                              const newOwnedLegacy =
                                toLegacyOwnedAvatarsValues(newOwnedItems);

                              setCoins(newCoins);
                              setOwnedItemIds(newOwnedItems);

                              const supabase = getSupabaseBrowserClient();
                              supabase
                                .from("profiles")
                                .update({
                                  coins: newCoins,
                                  owned_items: newOwnedItems,
                                  owned_avatars: newOwnedLegacy,
                                })
                                .eq("id", supabaseUser.id)
                                .then(({ error }) => {
                                  if (error) {
                                    console.error("Purchase error:", error);
                                    setAuthMsg(
                                      `Purchase failed: ${error.message}`
                                    );
                                    setCoins(coins);
                                    setOwnedItemIds(ownedItemIds);
                                  }
                                });
                            }}
                            style={{
                              flex: 1,
                              height: 44,
                              borderRadius: 10,
                              background: canBuy
                                ? "#667eea"
                                : "rgba(255,255,255,0.1)",
                              color: "white",
                              border: "none",
                              fontSize: 16,
                              fontWeight: 700,
                              cursor: canBuy ? "pointer" : "not-allowed",
                              opacity: canBuy ? 1 : 0.6,
                            }}
                          >
                            Buy for {item.price}
                          </button>
                        ) : (
                          <button
                            disabled={equipped}
                            onClick={() => {
                              if (equipped) return;
                              if (item.type === "avatar") {
                                setDebugAvatarUrl(item.url);
                                setAvatarUrl(item.url);
                                void persistEquipped({
                                  equipped_avatar_url: item.url,
                                });
                              } else if (
                                item.type === "theme" &&
                                onLobbyChange
                              ) {
                                if (item.id === "theme_scifi") {
                                  onLobbyChange("scifi");
                                } else {
                                  onLobbyChange("park");
                                }
                                void persistEquipped({
                                  equipped_theme: item.id,
                                });
                              } else if (item.type === "chess") {
                                if ((item as any).chessKind === "board") {
                                  setChessBoardTheme(item.id);
                                  void persistEquipped({
                                    equipped_chess_board: item.id,
                                  });
                                } else {
                                  setChessTheme(item.id);
                                  void persistEquipped({
                                    equipped_chess_set: item.id,
                                  });
                                }
                              }
                            }}
                            style={{
                              flex: 1,
                              height: 44,
                              borderRadius: 10,
                              background: equipped
                                ? "rgba(255,255,255,0.2)"
                                : "white",
                              color: "black",
                              border: "none",
                              fontSize: 16,
                              fontWeight: 800,
                              cursor: equipped ? "default" : "pointer",
                              opacity: equipped ? 0.8 : 1,
                            }}
                          >
                            {equipped ? "Equipped" : "Equip"}
                          </button>
                        )}
                      </div>

                      {!supabaseUser && !owned && item.price > 0 ? (
                        <button
                          onClick={openAuthModal}
                          style={{
                            fontSize: 12,
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: "#ff6b6b",
                            cursor: "pointer",
                            textDecoration: "underline",
                            font: "inherit",
                            textUnderlineOffset: 3,
                          }}
                        >
                          Sign in required to purchase
                        </button>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Settings Modal */}
      {settingsOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            style={{
              width: 420,
              maxWidth: "92vw",
              background: "rgba(0,0,0,0.85)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              padding: 24,
              color: "white",
              boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700 }}>Settings</div>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "transparent",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Close"
                title="Close"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              style={{
                height: 1,
                background: "rgba(255,255,255,0.12)",
                marginBottom: 20,
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Chess Board Coordinates Toggle */}
              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 8,
                    opacity: 0.9,
                  }}
                >
                  Display Options
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: 16,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      Board Coordinates
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      Show a-h and 1-8 labels on chess boards
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !showCoordinates;
                      setShowCoordinates(newValue);
                      if (typeof window !== "undefined") {
                        localStorage.setItem(
                          "chess-show-coordinates",
                          String(newValue)
                        );
                        // Dispatch custom event for same-window updates
                        window.dispatchEvent(
                          new Event("chess-coordinates-changed")
                        );
                      }
                    }}
                    style={{
                      width: 52,
                      height: 30,
                      borderRadius: 15,
                      border: "none",
                      background: showCoordinates
                        ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                        : "rgba(255,255,255,0.2)",
                      position: "relative",
                      cursor: "pointer",
                      transition: "background 0.2s",
                      flexShrink: 0,
                    }}
                    aria-label={`Toggle coordinates ${
                      showCoordinates ? "off" : "on"
                    }`}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "white",
                        position: "absolute",
                        top: 3,
                        left: showCoordinates ? 25 : 3,
                        transition: "left 0.2s",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      }}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Username Modal */}
      {usernameModalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 56,
          }}
          onClick={() => {
            if (!mustChooseUsername) setUsernameModalOpen(false);
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: "92vw",
              background: "rgba(0,0,0,0.78)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              padding: 20,
              color: "white",
              boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>
                  Choose a username
                </div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  Must be unique
                </div>
              </div>
              {!mustChooseUsername ? (
                <button
                  onClick={() => setUsernameModalOpen(false)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "transparent",
                    color: "white",
                    cursor: "pointer",
                  }}
                  aria-label="Close"
                  title="Close"
                >
                  <CloseIcon size={18} />
                </button>
              ) : null}
            </div>

            <div
              style={{
                marginTop: 14,
                height: 1,
                background: "rgba(255,255,255,0.12)",
              }}
            />

            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <input
                value={usernameDraft}
                onChange={(e) => {
                  setUsernameMsg(null);
                  setUsernameDraft(e.target.value);
                }}
                placeholder="Username"
                autoComplete="username"
                style={{
                  flex: 1,
                  height: 42,
                  padding: "0 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  outline: "none",
                  fontSize: 14,
                }}
              />
              <button
                disabled={usernameBusy || !supabaseUser}
                onClick={async () => {
                  if (!supabaseUser) return;
                  setUsernameBusy(true);
                  setUsernameMsg(null);
                  try {
                    const cleaned = usernameDraft.trim().slice(0, 24);
                    if (cleaned.length < 3) {
                      setUsernameMsg("Username must be at least 3 characters.");
                      return;
                    }
                    if (usernameAvailable === false) {
                      setUsernameMsg("That username is taken.");
                      return;
                    }

                    const supabase = getSupabaseBrowserClient();
                    const { error } = await supabase.rpc("set_username", {
                      p_username: cleaned,
                    });
                    if (error) {
                      const msg =
                        error.code === "23505"
                          ? "That username is taken."
                          : error.message;
                      setUsernameMsg(msg);
                      return;
                    }

                    setSupabaseUsername(cleaned);
                    setName(cleaned);
                    try {
                      window.sessionStorage.setItem("pawnsquare:name", cleaned);
                    } catch {
                      // ignore
                    }
                    setUsernameModalOpen(false);
                  } catch (e) {
                    setUsernameMsg(
                      e instanceof Error ? e.message : "Could not set username."
                    );
                  } finally {
                    setUsernameBusy(false);
                  }
                }}
                style={{
                  height: 42,
                  padding: "0 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  fontWeight: 800,
                  cursor: usernameBusy ? "not-allowed" : "pointer",
                  fontSize: 14,
                  opacity: usernameBusy ? 0.6 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                Save
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
              {usernameDraft.trim().length >= 3 ? (
                usernameAvailable === true ? (
                  <span style={{ color: "rgba(120,255,170,0.95)" }}>
                    Available
                  </span>
                ) : usernameAvailable === false ? (
                  <span style={{ color: "rgba(255,140,140,0.95)" }}>Taken</span>
                ) : (
                  <span style={{ opacity: 0.7 }}>Checking…</span>
                )
              ) : (
                <span style={{ opacity: 0.7 }}>3–24 characters</span>
              )}
            </div>

            {usernameMsg ? (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "rgba(255,160,160,0.95)",
                }}
              >
                {usernameMsg}
              </div>
            ) : null}

            {supabaseUsername ? (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                Current: {supabaseUsername}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Login Modal */}
      {authModalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 55,
          }}
          onClick={() => setAuthModalOpen(false)}
        >
          <div
            style={{
              width: 520,
              maxWidth: "92vw",
              height: 460,
              maxHeight: "90vh",
              background: "rgba(0,0,0,0.78)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.14)",
              padding: 20,
              color: "white",
              boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <UserIcon size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>
                    Login
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                    Sync coins + purchases
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAuthModalOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "transparent",
                  color: "white",
                  cursor: "pointer",
                }}
                aria-label="Close"
                title="Close"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              style={{
                marginTop: 14,
                height: 1,
                background: "rgba(255,255,255,0.12)",
              }}
            />

            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="Email"
                  inputMode="email"
                  autoComplete="email"
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
                <button
                  disabled={authBusy}
                  onClick={async () => {
                    setAuthBusy(true);
                    setAuthMsg(null);
                    try {
                      const email = authEmail.trim();
                      if (!email) {
                        setAuthMsg("Enter your email.");
                        return;
                      }
                      const supabase = getSupabaseBrowserClient();
                      const redirectTo = `${window.location.origin}/auth/magic-link`;
                      const { error } = await supabase.auth.signInWithOtp({
                        email,
                        options: { emailRedirectTo: redirectTo },
                      });
                      if (error) {
                        setAuthMsg(error.message);
                      } else {
                        setAuthMsg("Check your email for the magic link.");
                      }
                    } catch (e) {
                      setAuthMsg(
                        e instanceof Error
                          ? e.message
                          : "Could not start sign-in."
                      );
                    } finally {
                      setAuthBusy(false);
                    }
                  }}
                  style={{
                    height: 42,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    fontWeight: 800,
                    cursor: authBusy ? "not-allowed" : "pointer",
                    fontSize: 14,
                    opacity: authBusy ? 0.6 : 1,
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <PaperPlaneIcon size={18} />
                  Send magic link
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 2,
                  opacity: 0.8,
                }}
              >
                <div
                  style={{
                    height: 1,
                    flex: 1,
                    background: "rgba(255,255,255,0.12)",
                  }}
                />
                <div style={{ fontSize: 12 }}>or</div>
                <div
                  style={{
                    height: 1,
                    flex: 1,
                    background: "rgba(255,255,255,0.12)",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={authBusy}
                  onClick={async () => {
                    setAuthBusy(true);
                    setAuthMsg(null);
                    try {
                      const supabase = getSupabaseBrowserClient();
                      const redirectTo = `${window.location.origin}/auth/popup`;
                      const { data, error } =
                        await supabase.auth.signInWithOAuth({
                          provider: "google",
                          options: {
                            redirectTo,
                            skipBrowserRedirect: true,
                          },
                        });

                      if (error || !data?.url) {
                        setAuthMsg(
                          error?.message || "Could not start Google sign-in."
                        );
                        return;
                      }

                      const popup = openCenteredPopup(
                        data.url,
                        "pawnsquare-oauth"
                      );
                      if (!popup) {
                        setAuthMsg(
                          "Popup blocked. Allow popups and try again."
                        );
                        return;
                      }
                      setAuthMsg("Complete sign-in in the popup...");
                    } catch {
                      setAuthMsg("Could not start Google sign-in.");
                    } finally {
                      setAuthBusy(false);
                    }
                  }}
                  style={{
                    height: 42,
                    padding: "0 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    fontWeight: 700,
                    cursor: authBusy ? "not-allowed" : "pointer",
                    fontSize: 14,
                    opacity: authBusy ? 0.6 : 1,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <GoogleIcon size={18} />
                  Google
                </button>

                <button
                  disabled={authBusy}
                  onClick={async () => {
                    setAuthBusy(true);
                    setAuthMsg(null);
                    try {
                      const supabase = getSupabaseBrowserClient();
                      const redirectTo = `${window.location.origin}/auth/popup`;
                      const { data, error } =
                        await supabase.auth.signInWithOAuth({
                          provider: "discord",
                          options: {
                            redirectTo,
                            skipBrowserRedirect: true,
                          },
                        });

                      if (error || !data?.url) {
                        setAuthMsg(
                          error?.message || "Could not start Discord sign-in."
                        );
                        return;
                      }

                      const popup = openCenteredPopup(
                        data.url,
                        "pawnsquare-oauth"
                      );
                      if (!popup) {
                        setAuthMsg(
                          "Popup blocked. Allow popups and try again."
                        );
                        return;
                      }
                      setAuthMsg("Complete sign-in in the popup...");
                    } catch {
                      setAuthMsg("Could not start Discord sign-in.");
                    } finally {
                      setAuthBusy(false);
                    }
                  }}
                  style={{
                    height: 42,
                    padding: "0 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    fontWeight: 700,
                    cursor: authBusy ? "not-allowed" : "pointer",
                    fontSize: 14,
                    opacity: authBusy ? 0.6 : 1,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <DiscordIcon size={18} />
                  Discord
                </button>
              </div>
            </div>

            {authMsg ? (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                {authMsg}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VoiceProximityUpdater({
  enabled,
  selfId,
  players,
  selfPosRef,
  setRemoteGainForPeerId,
  requestConnections,
  hangupPeer,
  onDesiredPeersChange,
}: {
  enabled: boolean;
  selfId?: string;
  players: Record<string, Player>;
  selfPosRef: React.RefObject<THREE.Vector3>;
  setRemoteGainForPeerId: (peerId: string, gain: number) => void;
  requestConnections?: (peers?: string[]) => void;
  hangupPeer?: (peerId: string, reason?: string) => void;
  onDesiredPeersChange?: (peers: string[]) => void;
}) {
  const lastTickRef = useRef(0);
  const lastConnTickRef = useRef(0);
  const desiredPeersRef = useRef<Set<string>>(new Set());
  const candidatesRef = useRef<Array<{ id: string; d: number }>>([]);
  const nextIdsRef = useRef<string[]>([]);

  useFrame(() => {
    if (!enabled) return;
    if (!selfId) return;
    const selfPos = selfPosRef.current;
    if (!selfPos) return;

    const now = performance.now();
    // 10Hz update is plenty for volume.
    if (now - lastTickRef.current < 100) return;
    lastTickRef.current = now;

    for (const peerId in players) {
      if (peerId === selfId) continue;

      const p = players[peerId];
      if (!p) continue;

      // If we don't yet have a valid remote position, don't stomp the gain.
      const pos = p.position;
      if (!pos || pos.length < 3) continue;
      const px = pos[0];
      const py = pos[1];
      const pz = pos[2];
      if (
        !Number.isFinite(px) ||
        !Number.isFinite(py) ||
        !Number.isFinite(pz)
      ) {
        continue;
      }

      const dx = px - selfPos.x;
      const dy = py - selfPos.y;
      const dz = pz - selfPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const gRaw = voiceGainFromDistanceMeters(d);
      const g = Number.isFinite(gRaw) ? clamp(gRaw, 0, 1) : 1;
      setRemoteGainForPeerId(peerId, g);
    }

    // Connection management: throttle to ~3Hz.
    // This keeps the voice mesh bounded to nearby peers only.
    if (requestConnections && hangupPeer) {
      const connNow = performance.now();
      if (connNow - lastConnTickRef.current >= 320) {
        lastConnTickRef.current = connNow;

        const START_RADIUS_M = 6;
        const STOP_RADIUS_M = 7.2;
        const MAX_PEERS = 8;

        const prev = desiredPeersRef.current;

        const candidates = candidatesRef.current;
        candidates.length = 0;

        for (const peerId in players) {
          if (peerId === selfId) continue;

          const p = players[peerId];
          if (!p) continue;
          const pos = p.position;
          if (!pos || pos.length < 3) continue;
          const px = pos[0];
          const py = pos[1];
          const pz = pos[2];
          if (
            !Number.isFinite(px) ||
            !Number.isFinite(py) ||
            !Number.isFinite(pz)
          ) {
            continue;
          }

          const dx = px - selfPos.x;
          const dy = py - selfPos.y;
          const dz = pz - selfPos.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // Hysteresis: stay connected a bit longer than the connect radius.
          if (d <= START_RADIUS_M || (prev.has(peerId) && d <= STOP_RADIUS_M)) {
            candidates.push({ id: peerId, d });
          }
        }

        candidates.sort((a, b) => a.d - b.d);

        const nextIds = nextIdsRef.current;
        nextIds.length = 0;
        for (let i = 0; i < candidates.length && i < MAX_PEERS; i++) {
          nextIds.push(candidates[i]!.id);
        }

        // Compare desired peer set without allocating a new Set every tick.
        let changed = nextIds.length !== prev.size;
        if (!changed) {
          for (let i = 0; i < nextIds.length; i++) {
            if (!prev.has(nextIds[i]!)) {
              changed = true;
              break;
            }
          }
        }

        if (changed) {
          const next = new Set(nextIds);
          // Disconnect peers that dropped out of range.
          for (const id of prev) {
            if (!next.has(id)) {
              hangupPeer(id, "out-of-range");
            }
          }

          desiredPeersRef.current = next;
          try {
            requestConnections(nextIds);
          } catch {
            // ignore
          }
          try {
            onDesiredPeersChange?.(nextIds);
          } catch {
            // ignore
          }
        }
      }
    }
  });

  return null;
}

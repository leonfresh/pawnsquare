"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Plane, Text, Line } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import {
  usePartyRoom as useP2PRoom,
  type ChatMessage,
  type Player,
  type Vec3,
} from "@/lib/partyRoom";
import { usePartyVoice } from "@/lib/partyVoice";
import { useWASDKeys } from "@/lib/keyboard";
import { PlayerAvatar } from "@/components/player-avatar";
import { getAvatarSystem } from "@/lib/avatarSystem";
import { OutdoorChess } from "@/components/outdoor-chess";
import { ScifiChess } from "@/components/scifi-chess";
import { VrmPreview } from "@/components/vrm-preview";
import { CoinIcon } from "@/components/coin-icon";
import { ChessSetPreview } from "@/components/chess-set-preview";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import type { User } from "@supabase/supabase-js";

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
          "\n" +
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

  useFrame(() => {
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

    setMovingSpeed(speed.current);

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

function SpeechBubble({ text }: { text: string }) {
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
        >
          {t}
        </Text>
      </group>
    </Billboard>
  );
}

function RemoteAvatar({
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

    setMovingSpeed(speedRef.current);
  });

  return (
    <group ref={groupRef}>
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
        >
          {name || id.slice(0, 4)}
        </Text>
      </Billboard>

      {bubbleText ? <SpeechBubble text={bubbleText} /> : null}

      <PlayerAvatar
        id={id}
        movingSpeed={movingSpeed}
        gender={gender}
        url={avatarUrl}
      />
    </group>
  );
}

function FollowCamera({
  target,
  lookAtOverride,
}: {
  target: React.RefObject<THREE.Vector3>;
  lookAtOverride?: React.RefObject<THREE.Vector3 | null>;
}) {
  const { gl } = useThree();
  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ dist: number; radius: number } | null>(null);
  const touchIdsRef = useRef<Set<number>>(new Set());

  // Camera orbit state (spherical)
  const thetaRef = useRef(0); // azimuth around Y
  const phiRef = useRef(1.06); // polar from +Y (matches ~[0,4.5,8])
  const radiusRef = useRef(9.2);

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
      if (e.pointerType !== "touch") {
        if (e.button !== 2) return;
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
        if (e.button !== 2) return;
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
      thetaRef.current -= dx * rotSpeed;
      phiRef.current = clamp(phiRef.current + dy * rotSpeed, 0.45, 1.45);
    };

    const wheelOptions: AddEventListenerOptions = { passive: false };
    const onWheel = (e: WheelEvent) => {
      // Keep the page from scrolling while zooming over the canvas.
      e.preventDefault();

      // Trackpads and wheels vary; an exponential scale feels consistent.
      const zoomSpeed = 0.0015;
      const factor = Math.exp(e.deltaY * zoomSpeed);
      radiusRef.current = clampRadius(radiusRef.current * factor);
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

    // Use lookAtOverride as orbit center when watching a board
    const orbitCenter = lookAtOverride?.current || t;

    const offset = new THREE.Vector3().setFromSphericalCoords(
      radiusRef.current,
      phiRef.current,
      thetaRef.current
    );
    const desired = new THREE.Vector3(
      orbitCenter.x,
      orbitCenter.y,
      orbitCenter.z
    ).add(offset);
    camera.position.lerp(desired, clamp(dt * 6, 0, 1));
    camera.lookAt(orbitCenter.x, orbitCenter.y + 1.0, orbitCenter.z);
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
  GoogleIcon,
  DiscordIcon,
  PaperPlaneIcon,
} from "@/components/icons";
import { ChessBoardPreview } from "@/components/chess-board-preview";

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
    sendSelfState,
    sendChat,
    setName,
    setAvatarUrl,
    socketRef,
  } = useP2PRoom(roomId, {
    initialName,
    initialGender,
    paused: isDuplicateSession,
  });

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
    "avatar" | "theme" | "chess" | "coins"
  >("avatar");
  const [shopSelectedId, setShopSelectedId] = useState<string | null>(null);
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
  const [authEmail, setAuthEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

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
      saved === "coins"
    ) {
      setShopTab(saved);
    }
  }, []);

  // Auto-close the login modal once we're signed in.
  useEffect(() => {
    if (!supabaseUser) return;
    setAuthModalOpen(false);
    setAuthBusy(false);
    setAuthMsg(null);
  }, [supabaseUser]);

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
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  const selfPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const selfRotRef = useRef<number>(0);
  const selfSpeedRef = useRef<number>(0);
  const lookAtTargetRef = useRef<THREE.Vector3 | null>(null);

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
  const joinLockedBoardKey = joinedBoardKey ?? pendingJoinBoardKey;

  useEffect(() => {
    if (!pendingJoinBoardKey) return;
    if (joinedBoardKey) {
      setPendingJoinBoardKey(null);
      return;
    }

    const t = window.setTimeout(() => {
      setPendingJoinBoardKey((cur) =>
        cur === pendingJoinBoardKey ? null : cur
      );
    }, 8000);
    return () => window.clearTimeout(t);
  }, [pendingJoinBoardKey, joinedBoardKey]);

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

  const lastSentRef = useRef<{ t: number; p: Vec3; r: number }>({
    t: 0,
    p: [0, 0, 0],
    r: 0,
  });

  const [copied, setCopied] = useState(false);
  const [nameInput, setNameInput] = useState("");

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

  const roomLink = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
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
    if (!copied) return;
    const to = window.setTimeout(() => setCopied(false), 900);
    return () => window.clearTimeout(to);
  }, [copied]);

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);

    el.addEventListener("webglcontextlost", onLost as EventListener, false);
    el.addEventListener(
      "webglcontextrestored",
      onRestored as EventListener,
      false
    );
    return () => {
      el.removeEventListener("webglcontextlost", onLost as EventListener);
      el.removeEventListener(
        "webglcontextrestored",
        onRestored as EventListener
      );
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

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
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
          canvasElRef.current = gl.domElement;
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
          {lobbyType === "scifi" ? <SciFiLobby /> : <ParkLobby />}

          {boards.map((b) => (
            <group key={b.key}>
              {lobbyType === "scifi" ? (
                <SciFiLamp
                  lampPos={[
                    b.origin[0] + (b.origin[0] < 0 ? -5.8 : 5.8),
                    0,
                    b.origin[2] + (b.origin[2] < 0 ? -4.8 : 4.8),
                  ]}
                />
              ) : (
                <BoardLamp
                  lampPos={[
                    b.origin[0] + (b.origin[0] < 0 ? -5.8 : 5.8),
                    0,
                    b.origin[2] + (b.origin[2] < 0 ? -4.8 : 4.8),
                  ]}
                  targetPos={[b.origin[0], 0.2, b.origin[2]]}
                />
              )}
              <Suspense fallback={null}>
                {lobbyType === "scifi" ? (
                  <ScifiChess
                    roomId={roomId}
                    boardKey={b.key}
                    origin={b.origin}
                    selfPositionRef={selfPosRef}
                    selfId={self?.id || ""}
                    selfName={self?.name || ""}
                    joinLockedBoardKey={joinLockedBoardKey}
                    chessTheme={chessTheme}
                    chessBoardTheme={chessBoardTheme}
                    onJoinIntent={(boardKey) => {
                      setPendingJoinBoardKey((prev) => prev ?? boardKey);
                    }}
                    onSelfSeatChange={(boardKey, side) => {
                      setJoinedBoardKey((prev) => {
                        if (side) return boardKey;
                        if (prev === boardKey) return null;
                        return prev;
                      });
                      setPendingJoinBoardKey((prev) =>
                        prev === boardKey ? null : prev
                      );
                    }}
                    onRequestMove={(dest, opts) => {
                      moveTargetRef.current = {
                        dest,
                        rotY: opts?.rotY,
                        sit: opts?.sit,
                        sitDest: opts?.sitDest,
                        lookAtTarget: opts?.lookAtTarget,
                      };
                      sittingRef.current = false;
                    }}
                  />
                ) : (
                  <OutdoorChess
                    roomId={roomId}
                    boardKey={b.key}
                    origin={b.origin}
                    selfPositionRef={selfPosRef}
                    selfId={self?.id || ""}
                    selfName={self?.name || ""}
                    joinLockedBoardKey={joinLockedBoardKey}
                    chessTheme={chessTheme}
                    chessBoardTheme={chessBoardTheme}
                    onJoinIntent={(boardKey) => {
                      // Lock immediately to prevent starting a second join elsewhere.
                      setPendingJoinBoardKey((prev) => prev ?? boardKey);
                    }}
                    onSelfSeatChange={(boardKey, side) => {
                      setJoinedBoardKey((prev) => {
                        if (side) return boardKey;
                        // Only clear if this board was the one we were locked to.
                        if (prev === boardKey) return null;
                        return prev;
                      });
                      // If we successfully joined (or cleared) this board, clear pending lock.
                      setPendingJoinBoardKey((prev) =>
                        prev === boardKey ? null : prev
                      );
                    }}
                    onRequestMove={(dest, opts) => {
                      moveTargetRef.current = {
                        dest,
                        rotY: opts?.rotY,
                        sit: opts?.sit,
                        sitDest: opts?.sitDest,
                        lookAtTarget: opts?.lookAtTarget,
                      };
                      sittingRef.current = false;
                    }}
                  />
                )}
              </Suspense>
            </group>
          ))}

          <FollowCamera target={selfPosRef} lookAtOverride={lookAtTargetRef} />

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
            Players
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {hudPlayers.slice(0, 10).map((p) => (
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
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(roomLink);
                setCopied(true);
              } catch {
                // ignore
              }
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
              transition: "background 0.2s",
            }}
          >
            {copied ? "Copied!" : "Share Link"}
          </button>

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
      </div>

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
              {(["avatar", "theme", "chess"] as const).map((t) => (
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
                  ) : (
                    <ChessPieceIcon size={16} />
                  )}
                  {t === "chess"
                    ? "Chess"
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
                            <div style={{ fontWeight: 500 }}>{item.name}</div>
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
                                url={item.url}
                                width={previewW}
                                height={previewH}
                              />
                            ) : item.type === "chess" ? (
                              <div style={{ width: "100%", height: "100%" }}>
                                {(item as any).chessKind === "board" ? (
                                  <ChessBoardPreview boardTheme={item.id} />
                                ) : (
                                  <ChessSetPreview chessTheme={item.id} />
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

  useFrame(() => {
    if (!enabled) return;
    if (!selfId) return;
    const selfPos = selfPosRef.current;
    if (!selfPos) return;

    const now = performance.now();
    // 10Hz update is plenty for volume.
    if (now - lastTickRef.current < 100) return;
    lastTickRef.current = now;

    for (const [peerId, p] of Object.entries(players)) {
      if (peerId === selfId) continue;

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

        const candidates: Array<{ id: string; d: number }> = [];
        for (const [peerId, p] of Object.entries(players)) {
          if (peerId === selfId) continue;
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
        const nextIds = candidates.slice(0, MAX_PEERS).map((c) => c.id);
        const next = new Set(nextIds);

        let changed = next.size !== prev.size;
        if (!changed) {
          for (const id of next) {
            if (!prev.has(id)) {
              changed = true;
              break;
            }
          }
        }

        if (changed) {
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

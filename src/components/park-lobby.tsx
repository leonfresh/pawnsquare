"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function hash2(x: number, y: number, seed: number) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return v - Math.floor(v);
}

function smoothstep01(t: number) {
  return t * t * (3 - 2 * t);
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

  // Path definitions (same as before, but now baked into the ground)
  const paths = [
    { points: [[-14, -10], [-8, -13], [0, -14], [8, -12], [14, -8]], width: 2.2 },
    { points: [[-14, 8], [-6, 12], [2, 13], [10, 10]], width: 2.0 },
    { points: [[14, -6], [15, 0], [14, 6]], width: 1.6 },
    { points: [[-15, -4], [-15, 0], [-14, 4]], width: 1.5 },
  ];

  // Helper to compute distance from a point to a path
  function distanceToPath(x: number, z: number, pathPoints: number[][], pathWidth: number): number {
    let minDist = Infinity;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const [x1, z1] = pathPoints[i]!;
      const [x2, z2] = pathPoints[i + 1]!;
      
      // Distance from point to line segment
      const dx = x2 - x1;
      const dz = z2 - z1;
      const lengthSq = dx * dx + dz * dz;
      
      if (lengthSq === 0) {
        const dist = Math.sqrt((x - x1) * (x - x1) + (z - z1) * (z - z1));
        minDist = Math.min(minDist, dist);
        continue;
      }
      
      let t = ((x - x1) * dx + (z - z1) * dz) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      
      const projX = x1 + t * dx;
      const projZ = z1 + t * dz;
      const dist = Math.sqrt((x - projX) * (x - projX) + (z - projZ) * (z - projZ));
      
      minDist = Math.min(minDist, dist);
    }
    
    // Soft falloff
    const halfWidth = pathWidth / 2;
    if (minDist > halfWidth + 1.0) return 1.0; // Far from path
    if (minDist < halfWidth) return 0.0; // On path
    return (minDist - halfWidth) / 1.0; // Blend zone
  }

  // Greener palette with small warm flecks so the park reads as grass instead of plastic dirt.
  const base = new THREE.Color("#2d3f2f");
  const moss = new THREE.Color("#3f6847");
  const sun = new THREE.Color("#5c7a52");
  const dry = new THREE.Color("#4a5a3a");
  const dirt = new THREE.Color("#8b7355");
  const dirtDark = new THREE.Color("#6f5a45");
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

    // Compute path influence
    let pathFactor = 1.0; // 1 = grass, 0 = full dirt
    for (const path of paths) {
      const dist = distanceToPath(x, z, path.points, path.width);
      pathFactor = Math.min(pathFactor, dist);
    }

    // Blend grass with dirt based on path proximity
    if (pathFactor < 1.0) {
      const pathNoise = fbm2(x * 0.4, z * 0.4, seed + 50, 3);
      const dirtColor = pathNoise > 0.5 ? dirt : dirtDark;
      tmp.lerp(dirtColor, 1.0 - pathFactor);
    }

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
      time: { value: 0 },
    }),
    []
  );

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = clock.getElapsedTime();
    }
  });

  return (
    <mesh scale={100}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial
        ref={materialRef}
        side={THREE.BackSide}
        uniforms={uniforms}
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

          // Noise functions
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

          const mat2 m2 = mat2(0.8,-0.6,0.6,0.8);
          float fbm(vec2 p) {
              float f = 0.0;
              f += 0.5000 * noise(p); p = m2 * p * 2.02;
              f += 0.2500 * noise(p); p = m2 * p * 2.03;
              f += 0.1250 * noise(p); p = m2 * p * 2.01;
              f += 0.0625 * noise(p);
              return f / 0.9375;
          }

          void main() {
              vec3 rd = normalize(vWorldPosition - cameraPosition);
              vec3 ro = cameraPosition;
              
              vec3 light = normalize(vec3(0.9, 0.1, 0.9));
              float sundot = clamp(dot(rd, light), 0.0, 1.0);
              
              vec3 col = vec3(0.0);
              
              // Sky background
              vec3 blueSky = vec3(0.3, .55, 0.8);
              vec3 redSky = vec3(0.8, 0.8, 0.6);
              vec3 sky = mix(blueSky, redSky, 1.5 * pow(sundot, 8.));
              col = sky * (1.0 - 0.8 * rd.y);
              
              // Sun
              col += 0.1 * vec3(0.9, 0.3, 0.9) * pow(sundot, 0.5);
              col += 0.2 * vec3(1., 0.7, 0.7) * pow(sundot, 1.);
              col += 0.95 * vec3(1.) * pow(sundot, 256.);
              
              // Clouds
              if (rd.y > 0.0) {
                  float cloudSpeed = 0.01;
                  float cloudFlux = 0.25;
                  
                  vec3 cloudColour = mix(vec3(1.0, 0.95, 1.0), 0.35 * redSky, pow(sundot, 2.));
                  
                  // Layer 1
                  float cloudHeight = 500.0;
                  float t = (cloudHeight - ro.y) / rd.y;
                  
                  if (t > 0.0) {
                      vec2 wind = vec2(time * 8.0, time * 4.0);
                      vec2 sc = (ro.xz + rd.xz * t) + wind;
                      
                      float n1 = fbm(0.0005 * sc + fbm(0.0005 * sc + time * cloudFlux));
                      col = mix(col, cloudColour, 0.5 * smoothstep(0.5, 0.8, n1));
                      
                      // Layer 2
                      float cloudHeight2 = 300.0;
                      float t2 = (cloudHeight2 - ro.y) / rd.y;
                       if (t2 > 0.0) {
                          vec2 wind2 = vec2(time * 5.0, time * 2.5);
                          vec2 sc2 = (ro.xz + rd.xz * t2) + wind2;
                          float n2 = fbm(0.0002 * sc2 + fbm(0.0005 * sc2 + time * cloudFlux));
                          col = mix(col, cloudColour, 0.5 * smoothstep(0.5, 0.8, n2));
                       }
                  }
              }
              
              // Horizon blend
              col = mix(col, 0.9 * vec3(0.9, 0.75, 0.8), pow(1. - max(rd.y + 0.1, 0.0), 8.0));
              
              // Contrast
              col = clamp(col, 0., 1.);
              col = col * col * (3.0 - 2.0 * col);
              
              // Saturation
              float sat = 0.2;
              col = col * (1. + sat) - sat * dot(col, vec3(0.33));
              
              gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function OrganicPath({
  points,
  y = 0.05,
  width = 2.7,
  color = "#855439", // Updated to match reference BROWN
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
    <mesh geometry={geom} receiveShadow renderOrder={-9}>
      <meshStandardMaterial
        vertexColors
        roughness={0.9}
        metalness={0.0}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
        depthWrite={false}
      />
    </mesh>
  );
}

function WallMaterial(props: any) {
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
      
      // Brick colors from reference
      #define COLOR_BRICKWALL mix(vec3(0.52,0.33,0.22),vec3(0.9,0.9,0.7),0.35)
      #define COLOR_MORTAR vec3(0.7, 0.7, 0.65)

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Simple procedural brick pattern
      vec2 brickSize = vec2(0.8, 0.4);
      vec2 st = vPos.xz / brickSize;
      if (abs(vPos.y) > abs(vPos.x) && abs(vPos.y) > abs(vPos.z)) {
         // Top/bottom face, use xz
         st = vPos.xz / brickSize;
      } else {
         // Side faces, use y and x or z
         st = vec2(vPos.x + vPos.z, vPos.y) / brickSize;
      }

      if (fract(st.y * 0.5) > 0.5) st.x += 0.5;
      
      vec2 f = fract(st);
      vec2 s = step(vec2(0.05), f) - step(vec2(0.95), f);
      float brick = s.x * s.y;
      
      vec3 brickColor = COLOR_BRICKWALL;
      // Add some noise to bricks
      float noise = fract(sin(dot(floor(st), vec2(12.9898, 78.233))) * 43758.5453);
      brickColor *= 0.9 + 0.2 * noise;

      diffuseColor.rgb = mix(COLOR_MORTAR, brickColor, brick);
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

function BushMaterial(props: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      
      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res);
      }

      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vNormal = normalize(normalMatrix * normal);
      `
    ).replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      
      // Vertex Displacement for Bushes
      float disp = voronoi(position * 3.5); 
      float strength = 0.25; 
      transformed += normal * (1.0 - disp) * strength;
      `
    );

    shader.fragmentShader = `
      varying vec3 vPos;
      
      // Bush colors from reference
      #define COLOR_BUSH1 (0.8*vec3(0.07,0.3,0.05))
      #define COLOR_BUSH2 (0.55*vec3(0.12,0.6,0.2))
      #define COLOR_BUSH3 (0.55*vec3(0.1,0.35,0.09))
      #define COLOR_BUSH4 (0.82*vec3(0.18,0.39,0.06))
      #define COLOR_BUSH5 vec3(0.1,0.3,0.01)

      // Voronoi / Cellular Noise for leaves
      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res); // Distance to center
      }

      float fbm(vec3 p) {
          float f = 0.0;
          f += 0.5000 * voronoi(p); p *= 2.02;
          f += 0.2500 * voronoi(p); p *= 2.03;
          return f;
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Leafy Voronoi Pattern
      // Scale up for small leaves
      float v = voronoi(vPos * 12.0);
      
      // Invert to get "bumps" (spheres)
      float leaf = 1.0 - smoothstep(0.0, 0.7, v);
      
      // Mix colors based on leaf center vs edge
      vec3 col = mix(COLOR_BUSH1, COLOR_BUSH2, leaf);
      
      // Add some larger variation
      float largeNoise = voronoi(vPos * 2.0);
      col = mix(col, COLOR_BUSH3, largeNoise);
      
      // Occasional rare color
      if (largeNoise > 0.8) {
         col = mix(col, COLOR_BUSH5, 0.5);
      }
      
      // Fake ambient occlusion / Shadow in crevices
      // The "edge" of the voronoi cell (high v) is the crevice
      float ao = smoothstep(0.0, 0.5, 1.0 - v);
      
      // Perturb normal (fake bump map)
      // We can't easily modify the real normal here without dFdx/dFdy or normal map logic
      // But we can fake lighting by darkening the "away" side of the bumps
      // Simple directional light approximation
      vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
      // Gradient of v approximates normal
      // This is expensive to compute analytically, so we just use the color darkening
      
      diffuseColor.rgb = col * (0.4 + 0.6 * ao);
      
      // Silhouette breakup (Alpha Cutout)
      // If we are near the edge of the sphere geometry, and in a "crevice" (high v), discard
      // vNormal is available in fragment shader
      float viewDot = dot(normalize(vNormal), vec3(0,0,1)); // View space normal z is roughly facing camera
      // Actually vNormal is view space.
      // Let's use a simpler approach: Fresnel-like term
      // But we want to eat away the actual mesh edge.
      
      // We don't have easy access to "distance to mesh edge" in a generic way without vNormal
      // vNormal is the interpolated normal.
      // If dot(viewDir, normal) is small, we are at the edge.
      // In ThreeJS, view vector is (0,0,1) in view space, and vNormal is in view space.
      float NdotV = vNormal.z; // Simplified
      
      // If we are at grazing angle AND in a gap between leaves, discard
      if (NdotV < 0.3 && v > 0.6) {
          discard;
      }
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      // Enable alpha test for discard to work properly with shadows if needed, 
      // though standard material might need customDepthMaterial for shadows to respect discard.
      // For now, let's just keep it simple.
      side={THREE.DoubleSide} // See inside of back leaves
      shadowSide={THREE.DoubleSide}
      {...props}
    />
  );
}

function TreeMaterial(props: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      
      // Voronoi for vertex displacement
      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res);
      }

      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vNormal = normalize(normalMatrix * normal);
      `
    ).replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      
      // Vertex Displacement
      // Displace vertices to make the sphere look lumpy (like a leaf clump)
      float disp = voronoi(position * 2.5); // Local position for consistent shape
      float strength = 0.4; // Displacement amount
      
      // Push out based on noise (inverted voronoi gives bumps)
      transformed += normal * (1.0 - disp) * strength;
      `
    );

    shader.fragmentShader = `
      varying vec3 vPos;
      
      // Tree colors from reference
      #define COLOR_TREE1 (vec3(0.1,0.35,0.09)*0.55)
      #define COLOR_TREE2 (vec3(0.1,0.45,0.08)*0.8)
      #define COLOR_TREE_SURF vec3(0.15,0.4,0.04)

      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res);
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Leafy Voronoi
      float v = voronoi(vPos * 15.0); // Smaller leaves for trees
      float leaf = 1.0 - smoothstep(0.0, 0.8, v);
      
      // Color mixing
      vec3 col = mix(COLOR_TREE1, COLOR_TREE2, leaf);
      
      // Large scale variation (clumps)
      float clump = voronoi(vPos * 3.0);
      col = mix(col, COLOR_TREE_SURF, clump * 0.6);
      
      // AO / Shadow
      float ao = smoothstep(0.1, 0.6, 1.0 - v);
      
      diffuseColor.rgb = col * (0.3 + 0.7 * ao);
      
      // Silhouette breakup
      // Use the passed vNormal
      float NdotV = vNormal.z;
      if (NdotV < 0.25 && v > 0.5) {
          discard;
      }
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      side={THREE.DoubleSide}
      shadowSide={THREE.DoubleSide}
      {...props}
    />
  );
}

function TallTreeMaterial(props: any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  const onBeforeCompile = (shader: any) => {
    shader.vertexShader = `
      varying vec3 vPos;
      
      // Voronoi for vertex displacement
      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res);
      }

      ${shader.vertexShader}
    `.replace(
      "#include <worldpos_vertex>",
      `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    ).replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      
      // Vertex Displacement
      float disp = voronoi(position * 2.5); 
      float strength = 0.4; 
      transformed += normal * (1.0 - disp) * strength;
      `
    );

    shader.fragmentShader = `
      varying vec3 vPos;
      
      // Brighter, yellow-green colors for tall trees (Poplar/Cypress)
      #define COLOR_TALL1 vec3(0.25, 0.45, 0.05)
      #define COLOR_TALL2 vec3(0.35, 0.55, 0.1)
      #define COLOR_TALL_SURF vec3(0.15, 0.35, 0.05)

      vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
      }

      float voronoi(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          float res = 100.0;
          for(int k=-1; k<=1; k++)
          for(int j=-1; j<=1; j++)
          for(int i=-1; i<=1; i++) {
              vec3 b = vec3(float(i), float(j), float(k));
              vec3 r = vec3(b) - f + hash33(p + b);
              float d = dot(r, r);
              res = min(res, d);
          }
          return sqrt(res);
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      float v = voronoi(vPos * 15.0);
      float leaf = 1.0 - smoothstep(0.0, 0.8, v);
      
      vec3 col = mix(COLOR_TALL1, COLOR_TALL2, leaf);
      
      float clump = voronoi(vPos * 3.0);
      col = mix(col, COLOR_TALL_SURF, clump * 0.6);
      
      float ao = smoothstep(0.1, 0.6, 1.0 - v);
      
      diffuseColor.rgb = col * (0.4 + 0.6 * ao);
      
      // Silhouette breakup
      // Use standard normal if vNormal is not available or just use view direction approximation
      // Since we removed vNormal to fix errors, we can't use it here easily without re-adding it properly.
      // But we can use gl_FrontFacing or just skip the discard for now to be safe.
      // Or re-add vNormal correctly (it is available in standard material if not flat shaded).
      // Actually, vNormal IS available in fragment shader of MeshStandardMaterial.
      // The error was re-declaring it. So we can use it!
      
      if (vNormal.z < 0.25 && v > 0.5) {
          discard;
      }
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      side={THREE.DoubleSide}
      shadowSide={THREE.DoubleSide}
      {...props}
    />
  );
}

function GrassMaterial(props: any) {
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

      // Grass colors from reference
      #define COLOR_GRASS vec3(0.1,0.35,0.09)
      #define COLOR_GRASS2 vec3(0.35,0.39,0.06)
      #define COLOR_MOWED vec3(0.17,0.37,0.05)
      
      // Dirt colors
      #define COLOR_DIRT vec3(0.55, 0.45, 0.33)
      #define COLOR_DIRT2 vec3(0.43, 0.35, 0.27)
      
      // Flower colors
      #define COLOR_FLOWER_WHITE vec3(0.95, 0.95, 0.9)
      #define COLOR_FLOWER_YELLOW vec3(1.0, 0.8, 0.2)
      #define COLOR_FLOWER_PURPLE vec3(0.6, 0.4, 0.8)

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
      
      float stripes(float x, float period) {
          return smoothstep(0.0, 0.1, sin(x * 3.14159 * 2.0 / period));
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>

      // Detect if we are on a path (Dirt) or Grass based on vertex color
      // Dirt is reddish/brown (R > G), Grass is green (G > R)
      float isDirt = smoothstep(-0.05, 0.05, diffuseColor.r - diffuseColor.g);

      // Grass Logic
      float n = fbm(vPos.xz * 2.0);
      float detail = fbm(vPos.xz * 15.0);
      
      // Mowed stripes pattern
      float stripePattern = stripes(vPos.x + vPos.z * 0.5 + fbm(vPos.xz * 0.5), 4.0);
      
      vec3 grassColor = mix(COLOR_GRASS, COLOR_GRASS2, n);
      
      // Mix in mowed grass color based on stripes and noise
      grassColor = mix(grassColor, COLOR_MOWED, stripePattern * 0.3 + n * 0.2);
      
      float intensity = 0.8 + 0.4 * detail;
      vec3 finalGrass = grassColor * intensity;
      
      // Flowers
      // High frequency noise for flower placement
      float flowerNoise = hash(floor(vPos.xz * 15.0)); // Grid based placement
      float flowerType = hash(floor(vPos.xz * 15.0) + 100.0);
      
      if (flowerNoise > 0.97) {
          vec3 flowerColor = COLOR_FLOWER_WHITE;
          if (flowerType > 0.6) flowerColor = COLOR_FLOWER_YELLOW;
          if (flowerType > 0.85) flowerColor = COLOR_FLOWER_PURPLE;
          
          // Simple circle shape within grid cell
          vec2 cellUV = fract(vPos.xz * 15.0) - 0.5;
          if (length(cellUV) < 0.3) {
             finalGrass = flowerColor;
          }
      }

      // Dirt Logic
      float d = fbm(vPos.xz * 4.0);
      vec3 dirtColor = mix(COLOR_DIRT, COLOR_DIRT2, d);
      float grain = fract(sin(dot(vPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
      dirtColor *= 0.9 + 0.2 * grain;

      // Mix based on isDirt
      diffuseColor.rgb = mix(finalGrass, dirtColor, isDirt);
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

function ProceduralTallTree({
  height = 8,
  scale = 1,
  seed = 0,
}: {
  height?: number;
  scale?: number;
  seed?: number;
}) {
  const rand = (offset: number) => {
    const s = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  const clusters = useMemo(() => {
    const items: { pos: [number, number, number]; size: number }[] = [];
    
    // Stack of spheres tapering to top
    // Use a step-based approach to ensure overlap regardless of height
    let y = height * 0.25;
    let i = 0;
    
    while (y < height) {
        // Normalized height progress (0 to 1)
        const t = Math.max(0, (y - height * 0.25) / (height * 0.75));
        
        // Radius tapers as we go up
        const r = 1.1 * (1.0 - t * 0.65) + rand(i) * 0.25;
        
        items.push({ pos: [0, y, 0], size: r });
        
        // Add side variation (branches)
        if (t > 0.1 && t < 0.9) {
            const count = 2 + Math.floor(rand(i * 50) * 2);
            for (let j = 0; j < count; j++) {
                const angle = (j / count) * Math.PI * 2 + rand(i * 10 + j);
                const dist = r * 0.5;
                const x = Math.cos(angle) * dist;
                const z = Math.sin(angle) * dist;
                items.push({ pos: [x, y - r * 0.2, z], size: r * 0.65 });
            }
        }
        
        // Move up by a fraction of the radius to ensure overlap
        y += r * 0.7;
        i++;
    }
    
    return items;
  }, [height, seed]);

  return (
    <group scale={[scale, scale, scale]}>
      {/* Trunk */}
      <mesh castShadow receiveShadow position={[0, height * 0.4, 0]}>
        <cylinderGeometry args={[0.3, 0.5, height * 0.8, 8]} />
        <meshStandardMaterial color="#3a2a1a" roughness={1} />
      </mesh>
      
      {/* Leaf Clusters */}
      {clusters.map((c, i) => (
        <mesh key={i} position={c.pos as any} castShadow>
          <sphereGeometry args={[c.size, 12, 10]} />
          <TallTreeMaterial roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function ProceduralTree({
  height = 3.5,
  scale = 1,
  seed = 0,
}: {
  height?: number;
  scale?: number;
  seed?: number;
}) {
  // Deterministic random based on seed
  const rand = (offset: number) => {
    const s = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  // Generate leaf clusters
  const clusters = useMemo(() => {
    const count = 12;
    const items: { pos: [number, number, number]; size: number }[] = [];
    
    // Main central mass
    items.push({ pos: [0, height * 0.85, 0], size: 1.6 });
    items.push({ pos: [0, height * 0.65, 0], size: 1.8 });

    // Surrounding clusters
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand(i) * 2.0;
      const r = 0.8 + rand(i + 10) * 0.8;
      const y = height * 0.5 + rand(i + 20) * (height * 0.4);
      
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const size = 0.8 + rand(i + 30) * 0.6;
      
      items.push({ pos: [x, y, z], size });
    }
    return items;
  }, [height, seed]);

  return (
    <group scale={[scale, scale, scale]}>
      {/* Trunk */}
      <mesh castShadow receiveShadow position={[0, height * 0.4, 0]}>
        <cylinderGeometry args={[0.2, 0.35, height * 0.8, 8]} />
        <meshStandardMaterial color="#3a2a1a" roughness={1} />
      </mesh>
      
      {/* Leaf Clusters */}
      {clusters.map((c, i) => (
        <mesh key={i} position={c.pos as any} castShadow>
          <sphereGeometry args={[c.size, 12, 10]} />
          <TreeMaterial roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function ProceduralBush({ scale = 1, seed = 0 }: { scale?: number; seed?: number }) {
  const rand = (offset: number) => {
    const s = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  const clusters = useMemo(() => {
    const count = 5;
    const items: { pos: [number, number, number]; size: number }[] = [];
    
    // Center
    items.push({ pos: [0, 0.4, 0], size: 0.7 });
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand(i) * 1.0;
      const r = 0.3 + rand(i + 5) * 0.3;
      const y = 0.2 + rand(i + 10) * 0.3;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const size = 0.4 + rand(i + 15) * 0.3;
      items.push({ pos: [x, y, z], size });
    }
    return items;
  }, [seed]);

  return (
    <group scale={[scale, scale, scale]}>
      {clusters.map((c, i) => (
        <mesh key={i} position={c.pos as any} castShadow>
          <sphereGeometry args={[c.size, 10, 8]} />
          <BushMaterial roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export function ParkLobby() {
  const groundGeom = useMemo(() => makeGroundGeometry({}), []);
  const plazaGeom = useMemo(
    () =>
      makeDirtDiskGeometry({
        baseColor: "#4a4038",
      }),
    []
  );
  const ringGeom = useMemo(
    () =>
      makeDirtRingGeometry({
        baseColor: "#3b332f",
      }),
    []
  );

  return (
    <>
      {/* Cozy garden plaza lighting (sunset) */}
      <ambientLight intensity={0.24} color="#ffe8c8" />
      <hemisphereLight
        intensity={0.42}
        groundColor="#2f4a35"
        color="#ffd7b3"
      />

      {/* Lightweight gradient sky (no textures/particles) */}
      <GradientSky top="#1e2a44" bottom="#d6a57d" />

      {/* Low-angle golden sun */}
      <directionalLight
        intensity={1.15}
        position={[10, 16, 6]}
        color="#ffd5ab"
      />

      {/* Cool fill to keep silhouettes readable */}
      <directionalLight
        intensity={0.3}
        position={[-18, 18, -12]}
        color="#b9d6ff"
      />

      {/* Gentle rim to separate avatars/boards from the background */}
      <directionalLight
        intensity={0.18}
        position={[0, 10, -24]}
        color="#fff0e3"
      />

      {/* Warm haze */}
      <fog attach="fog" args={["#d6a57d", 28, 105]} />

      {/* Ground: grass base */}
      <mesh geometry={groundGeom} receiveShadow>
        <GrassMaterial vertexColors roughness={1} metalness={0} />
      </mesh>

      {/* Lakes/ponds - much closer and visible */}
      {/* Lake 1 - East side */}
      <mesh position={[30, 0.02, -35]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[14, 48]} />
        <meshStandardMaterial
          color="#4a6f8d"
          roughness={0.15}
          metalness={0.3}
          emissive="#1a3a4a"
          emissiveIntensity={0.2}
        />
      </mesh>
      
      {/* Lake 2 - Southwest */}
      <mesh position={[-40, 0.02, 30]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[18, 48]} />
        <meshStandardMaterial
          color="#3f6580"
          roughness={0.15}
          metalness={0.3}
          emissive="#1a3545"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Lake 3 - Southeast (smaller pond) */}
      <mesh position={[38, 0.02, 42]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[10, 40]} />
        <meshStandardMaterial
          color="#5a7a95"
          roughness={0.15}
          metalness={0.3}
          emissive="#2a4555"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Fantasy Castle - Northwest (polar opposite to lakes) */}
      <group position={[-50, 0, -45]}>
        {/* Main castle keep (tall central tower) */}
        <mesh position={[0, 12, 0]} castShadow receiveShadow>
          <boxGeometry args={[8, 24, 8]} />
          <WallMaterial
            roughness={0.9}
            metalness={0.05}
          />
        </mesh>
        {/* Battlements on top */}
        {[-3, -1, 1, 3].map((x, i) => 
          [-3, -1, 1, 3].map((z, j) => (
            <mesh key={`b${i}-${j}`} position={[x, 24.5, z]} castShadow>
              <boxGeometry args={[1.2, 1, 1.2]} />
              <WallMaterial roughness={0.95} />
            </mesh>
          ))
        )}
        
        {/* Corner towers */}
        {[[-10, -10], [10, -10], [-10, 10], [10, 10]].map(([x, z], i) => (
          <group key={`tower${i}`} position={[x, 0, z]}>
            <mesh position={[0, 8, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[2.5, 3, 16, 12]} />
              <WallMaterial roughness={0.9} metalness={0.05} />
            </mesh>
            {/* Cone roof */}
            <mesh position={[0, 17, 0]} castShadow>
              <coneGeometry args={[3.2, 4, 12]} />
              <meshStandardMaterial color="#3a3530" roughness={0.85} />
            </mesh>
          </group>
        ))}

        {/* Walls connecting towers */}
        <mesh position={[0, 5, -10]} castShadow receiveShadow>
          <boxGeometry args={[16, 10, 1.5]} />
          <WallMaterial roughness={0.9} />
        </mesh>
        <mesh position={[0, 5, 10]} castShadow receiveShadow>
          <boxGeometry args={[16, 10, 1.5]} />
          <WallMaterial roughness={0.9} />
        </mesh>
        <mesh position={[-10, 5, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 10, 16]} />
          <WallMaterial roughness={0.9} />
        </mesh>
        <mesh position={[10, 5, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 10, 16]} />
          <WallMaterial roughness={0.9} />
        </mesh>

        {/* Windows with warm glow */}
        {Array.from({ length: 8 }).map((_, i) => {
          const y = 4 + i * 2.5;
          return (
            <mesh key={`win${i}`} position={[0, y, 4.1]}>
              <planeGeometry args={[0.8, 1.2]} />
              <meshBasicMaterial color="#ffaa44" opacity={0.6} transparent />
            </mesh>
          );
        })}
      </group>

      {/* Medieval village buildings near castle */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const radius = 35;
        const x = -50 + Math.cos(angle) * radius;
        const z = -45 + Math.sin(angle) * radius;
        const h = 3 + (i % 3) * 1.5;
        const w = 2.5 + (i % 2) * 0.8;
        const d = 2.5 + ((i * 2) % 3) * 0.5;
        return (
          <group key={`house${i}`} position={[x, 0, z]}>
            {/* Building */}
            <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial
                color={i % 3 === 0 ? "#8b7355" : i % 3 === 1 ? "#a08060" : "#6f5545"}
                roughness={0.95}
                metalness={0.02}
              />
            </mesh>
            {/* Roof */}
            <mesh position={[0, h + 0.4, 0]} castShadow rotation={[0, Math.PI / 4, 0]}>
              <coneGeometry args={[w * 0.8, 1.2, 4]} />
              <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
            </mesh>
            {/* Door glow */}
            <mesh position={[0, 0.8, d / 2 + 0.01]}>
              <planeGeometry args={[0.5, 0.9]} />
              <meshBasicMaterial color="#ff8833" opacity={0.4} transparent />
            </mesh>
          </group>
        );
      })}

      {/* Watchtower - Northeast */}
      <group position={[55, 0, -40]}>
        <mesh position={[0, 5, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[2, 2.5, 10, 10]} />
          <WallMaterial roughness={0.9} />
        </mesh>
        <mesh position={[0, 11, 0]} castShadow>
          <coneGeometry args={[2.8, 3, 10]} />
          <meshStandardMaterial color="#3a3530" roughness={0.85} />
        </mesh>
        {/* Torch */}
        <pointLight position={[0, 10, 0]} color="#ff8833" intensity={1} distance={15} />
      </group>

      {/* Stone bridge over eastern lake */}
      <group position={[30, 0.5, -35]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[3, 0.8, 16]} />
          <WallMaterial roughness={0.95} />
        </mesh>
        {/* Bridge railings */}
        <mesh position={[-1.3, 0.6, 0]} castShadow>
          <boxGeometry args={[0.2, 0.6, 16]} />
          <WallMaterial roughness={0.95} />
        </mesh>
        <mesh position={[1.3, 0.6, 0]} castShadow>
          <boxGeometry args={[0.2, 0.6, 16]} />
          <WallMaterial roughness={0.95} />
        </mesh>
      </group>

      {/* Windmill - Southwest near second lake */}
      <group position={[-45, 0, 35]}>
        {/* Base */}
        <mesh position={[0, 4, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[2.5, 3.5, 8, 8]} />
          <meshStandardMaterial color="#8b7355" roughness={0.95} />
        </mesh>
        {/* Roof */}
        <mesh position={[0, 9, 0]} castShadow>
          <coneGeometry args={[3, 2, 8]} />
          <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
        </mesh>
        {/* Blades (4 arms) */}
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, i) => (
          <mesh
            key={`blade${i}`}
            position={[Math.cos(angle) * 1.5, 6, Math.sin(angle) * 1.5]}
            rotation={[0, 0, angle]}
            castShadow
          >
            <boxGeometry args={[0.3, 5, 0.8]} />
            <meshStandardMaterial color="#4a3a2a" roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* Small chapel - East */}
      <group position={[48, 0, 8]}>
        <mesh position={[0, 2.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[4, 5, 6]} />
          <WallMaterial roughness={0.95} />
        </mesh>
        <mesh position={[0, 5.5, 0]} castShadow>
          <coneGeometry args={[3, 2.5, 4]} />
          <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
        </mesh>
        {/* Bell tower */}
        <mesh position={[0, 7.5, 0]} castShadow>
          <boxGeometry args={[1.5, 2, 1.5]} />
          <WallMaterial roughness={0.95} />
        </mesh>
        <mesh position={[0, 9, 0]} castShadow>
          <coneGeometry args={[1.2, 1.5, 4]} />
          <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
        </mesh>
      </group>

      {/* Market tents - South */}
      {Array.from({ length: 5 }).map((_, i) => {
        const x = -12 + i * 6;
        const z = 42;
        const tentColors = ["#8b2222", "#2a5a8b", "#8b6a2a", "#2a8b4a", "#6a2a8b"];
        return (
          <group key={`tent${i}`} position={[x, 0, z]}>
            {/* Center pole */}
            <mesh position={[0, 1.8, 0]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 3.6, 8]} />
              <meshStandardMaterial color="#4a3a2a" roughness={0.95} />
            </mesh>
            {/* Corner poles */}
            {[[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].map(([px, pz], j) => (
              <mesh key={`pole${j}`} position={[px, 0.9, pz]} castShadow>
                <cylinderGeometry args={[0.06, 0.06, 1.8, 6]} />
                <meshStandardMaterial color="#3a2a1a" roughness={0.95} />
              </mesh>
            ))}
            {/* Tent fabric (pyramid shape) */}
            <mesh position={[0, 2.2, 0]} castShadow receiveShadow>
              <coneGeometry args={[2.2, 2.6, 4]} />
              <meshStandardMaterial 
                color={tentColors[i % tentColors.length]}
                roughness={0.85}
                side={2}
              />
            </mesh>
            {/* Tent stripes for detail */}
            <mesh position={[0, 2.2, 0]} castShadow rotation={[0, Math.PI / 4, 0]}>
              <coneGeometry args={[2.25, 2.65, 4]} />
              <meshStandardMaterial 
                color={tentColors[(i + 1) % tentColors.length]}
                roughness={0.85}
                transparent
                opacity={0.3}
              />
            </mesh>
            {/* Ground cloth/rug */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <circleGeometry args={[1.8, 16]} />
              <meshStandardMaterial 
                color={i % 2 === 0 ? "#6a4a3a" : "#5a3a2a"}
                roughness={0.95}
              />
            </mesh>
            {/* Lantern hanging from center pole */}
            <mesh position={[0, 3.2, 0]}>
              <sphereGeometry args={[0.15, 8, 8]} />
              <meshBasicMaterial color="#ffaa44" />
            </mesh>
            <pointLight position={[0, 3.2, 0]} color="#ff8833" intensity={0.5} distance={6} />
          </group>
        );
      })}

      {/* Lighthouse - Far East by the sea */}
      <group position={[70, 0, 0]}>
        <mesh position={[0, 8, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.8, 2.2, 16, 12]} />
          <meshStandardMaterial color="#e8e8e0" roughness={0.7} />
        </mesh>
        {/* Red stripes */}
        {[3, 9, 15].map((y, i) => (
          <mesh key={`stripe${i}`} position={[0, y, 0]} receiveShadow>
            <cylinderGeometry args={[2.05, 2.15, 2, 12]} />
            <meshStandardMaterial color="#aa2222" roughness={0.8} />
          </mesh>
        ))}
        {/* Light chamber */}
        <mesh position={[0, 17, 0]} castShadow>
          <cylinderGeometry args={[2, 2, 2, 12]} />
          <meshStandardMaterial color="#333333" roughness={0.6} metalness={0.3} />
        </mesh>
        {/* Rotating light */}
        <pointLight position={[0, 17.5, 0]} color="#ffff88" intensity={3} distance={50} />
        <mesh position={[0, 17.5, 0]}>
          <sphereGeometry args={[0.8, 12, 12]} />
          <meshBasicMaterial color="#ffffaa" />
        </mesh>
      </group>

      {/* Ocean/Sea - Far East */}
      <mesh position={[85, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 100]} />
        <meshStandardMaterial
          color="#2a4a6a"
          roughness={0.12}
          metalness={0.35}
          emissive="#1a3050"
          emissiveIntensity={0.18}
        />
      </mesh>

      {/* Distant sailing ships on the horizon */}
      {[[-8, 35], [5, 40], [15, 32]].map(([ox, oz], i) => (
        <group key={`ship${i}`} position={[85 + ox, 0, oz]}>
          {/* Hull */}
          <mesh position={[0, 1, 0]} castShadow>
            <boxGeometry args={[1.5, 1.2, 4]} />
            <meshStandardMaterial color="#4a3a2a" roughness={0.9} />
          </mesh>
          {/* Mast */}
          <mesh position={[0, 3, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 4, 8]} />
            <meshStandardMaterial color="#5a4a3a" roughness={0.95} />
          </mesh>
          {/* Sail */}
          <mesh position={[0.6, 3, 0]} castShadow>
            <boxGeometry args={[1.2, 2, 0.05]} />
            <meshStandardMaterial color="#e8d8c8" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Small grass variation patches (removed, handled by shader) */}

      {/* Low planters / seating blocks (kept inside movement bounds) */}
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const radius = 16.5;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, -angle, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[4.6, 0.55, 1.3]} />
              <meshStandardMaterial
                color="#2b2a26"
                roughness={0.95}
                metalness={0.02}
              />
            </mesh>
            {/* Soil bed */}
            <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
              <boxGeometry args={[4.2, 0.32, 0.95]} />
              <meshStandardMaterial
                color="#1f2f22"
                roughness={1}
                metalness={0}
              />
            </mesh>

            {/* Bush clusters */}
            {[-1.55, -0.55, 0.55, 1.55].map((bx, bi) => (
              <group
                key={bi}
                position={[bx, 0.55, bi % 2 === 0 ? -0.18 : 0.16]}
              >
                 <ProceduralBush scale={0.45} seed={i * 10 + bi} />
              </group>
            ))}

            {/* Tiny flowers along the front edge */}
            {Array.from({ length: 7 }).map((__, fi) => (
              <mesh key={fi} position={[-1.8 + fi * 0.6, 0.61, 0.42]}>
                <sphereGeometry args={[0.04, 8, 8]} />
                <meshStandardMaterial
                  color={
                    i % 2 === 0
                      ? fi % 2 === 0
                        ? "#ffd6e7"
                        : "#fff1b8"
                      : fi % 2 === 0
                      ? "#cfe8ff"
                      : "#ffe1bf"
                  }
                  roughness={0.75}
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Lantern posts (subtle in daylight, still cozy)
        Rotated/expanded so they don't line up behind the chess join pads. */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = ((i + 0.5) / 8) * Math.PI * 2;
        const radius = 14.6;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const warm = i % 2 === 0;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[0.08, 0.1, 2.5, 10]} />
              <meshStandardMaterial
                color="#232323"
                roughness={0.7}
                metalness={0.2}
              />
            </mesh>
            <mesh position={[0, 1.35, 0]} castShadow>
              <boxGeometry args={[0.35, 0.35, 0.35]} />
              <meshStandardMaterial
                color={warm ? "#ffd9a6" : "#d4e4ff"}
                emissive={warm ? "#ffb45a" : "#7fb6ff"}
                emissiveIntensity={0.25}
                roughness={0.35}
                metalness={0}
              />
            </mesh>
            <pointLight
              position={[0, 1.35, 0]}
              intensity={warm ? 0.25 : 0.18}
              color={warm ? "#ffbd73" : "#98c4ff"}
              distance={7}
              decay={2}
            />
          </group>
        );
      })}

      {/* Background trees (outside bounds for atmosphere) */}
      {Array.from({ length: 32 }).map((_, i) => {
        const angle = (i / 32) * Math.PI * 2 + (i % 2) * 0.1;
        const radius = 28 + (i % 3) * 4;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const h = 3.2 + (i % 5) * 0.6;
        const scale = 0.8 + (i % 4) * 0.1;
        
        // Mix of regular trees and tall cypress/poplar trees
        const isTall = i % 3 === 0;
        
        return (
          <group key={i} position={[x, 0, z]}>
             {isTall ? (
                 <ProceduralTallTree height={h * 2.5} scale={scale * 1.2} seed={i} />
             ) : (
                 <ProceduralTree height={h} scale={scale} seed={i} />
             )}
          </group>
        );
      })}
      
      {/* Extra wild bushes scattered around */}
      {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i / 12) * Math.PI * 2 + 0.5;
          const r = 22 + (i % 4) * 2;
          const x = Math.cos(angle) * r;
          const z = Math.sin(angle) * r;
          return (
             <group key={`wildbush${i}`} position={[x, 0, z]}>
                <ProceduralBush scale={1.2 + (i%3)*0.3} seed={i + 100} />
             </group>
          )
      })}
    </>
  );
}

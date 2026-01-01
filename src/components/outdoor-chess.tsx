"use client";

import { Text, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Chess, type Square } from "chess.js";
import PartySocket from "partysocket";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Vec3 } from "@/lib/partyRoom";
import { useChessSounds } from "./chess-sounds";

type Side = "w" | "b";

type GameResult =
  | { type: "timeout"; winner: Side }
  | { type: "checkmate"; winner: Side }
  | {
      type: "draw";
      reason:
        | "stalemate"
        | "insufficient"
        | "threefold"
        | "fifty-move"
        | "draw";
    };

type ClockState = {
  baseMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

type ChessNetState = {
  seats: { w: SeatInfo | null; b: SeatInfo | null };
  fen: string;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
  lastMove: { from: Square; to: Square } | null;
};

type ChessMessage = { type: "state"; state: ChessNetState };

type ChessSendMessage =
  | { type: "join"; side: Side; playerId?: string; name?: string }
  | { type: "leave"; side: Side }
  | {
      type: "move";
      from: Square;
      to: Square;
      promotion?: "q" | "r" | "b" | "n";
    }
  | { type: "setTime"; baseSeconds: number }
  | { type: "reset" };

const TIME_OPTIONS_SECONDS = [60, 3 * 60, 5 * 60, 10 * 60, 15 * 60] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatClock(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

function winnerLabel(side: Side) {
  return side === "w" ? "White" : "Black";
}

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function squareCenter(
  square: Square,
  origin: THREE.Vector3,
  squareSize: number
): THREE.Vector3 {
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = Number(square[1]); // 1..8
  const x = (file - 3.5) * squareSize;
  const z = (4.5 - rank) * squareSize;
  return new THREE.Vector3(origin.x + x, origin.y, origin.z + z);
}

function isSquare(val: string): val is Square {
  if (val.length !== 2) return false;
  const f = val.charCodeAt(0);
  const r = val.charCodeAt(1);
  return f >= 97 && f <= 104 && r >= 49 && r <= 56;
}

function piecePath(type: string) {
  switch (type) {
    case "p":
      return "/models/pawn.glb";
    case "n":
      return "/models/knight.glb";
    case "b":
      return "/models/bishop.glb";
    case "r":
      return "/models/rook.glb";
    case "q":
      return "/models/queen.glb";
    case "k":
      return "/models/king.glb";
    default:
      return "/models/pawn.glb";
  }
}

function applyFresnelRim(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  rimColor: THREE.Color,
  rimPower = 2.25,
  rimIntensity = 0.65
) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimPower = { value: rimPower };
    shader.uniforms.uRimIntensity = { value: rimIntensity };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimIntensity;`
      )
      .replace(
        "#include <output_fragment>",
        `float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);\noutgoingLight += uRimColor * rim * uRimIntensity;\n#include <output_fragment>`
      );
  };
  material.needsUpdate = true;
}

function applyClearGlassShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: {
    scale?: number;
    absorbStrength?: number;
    bottomTint?: THREE.Color;
  }
) {
  const scale = opts?.scale ?? 1.0;
  const absorbStrength = opts?.absorbStrength ?? 0.35;
  const bottomTint = opts?.bottomTint ?? new THREE.Color("#e9f2ff");

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }

    shader.uniforms.uGlassScale = { value: scale };
    shader.uniforms.uGlassAbsorb = { value: absorbStrength };
    shader.uniforms.uGlassBottomTint = { value: bottomTint };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vGlassWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPosG = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPosG = instanceMatrix * wsPosG;\n#endif\nwsPosG = modelMatrix * wsPosG;\nvGlassWorldPos = wsPosG.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vGlassWorldPos;\nuniform float uGlassScale;\nuniform float uGlassAbsorb;\nuniform vec3 uGlassBottomTint;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat gy = clamp(vGlassWorldPos.y * uGlassScale, 0.0, 1.0);\n// Slight base tint, clearer towards the top\ndiffuseColor.rgb = mix(uGlassBottomTint, diffuseColor.rgb, smoothstep(0.0, 1.0, gy));`
      )
      .replace(
        "#include <output_fragment>",
        `// Gentle absorption at grazing angles\nfloat ndv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);\nfloat fres = pow(1.0 - ndv, 2.0);\noutgoingLight *= (1.0 - fres * uGlassAbsorb);\n#include <output_fragment>`
      );
  };

  material.needsUpdate = true;
}

function applyMilkGlassShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: {
    milkiness?: number;
    bottomTint?: THREE.Color;
  }
) {
  const milkiness = opts?.milkiness ?? 0.75;
  const bottomTint = opts?.bottomTint ?? new THREE.Color("#ffffff");

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }

    shader.uniforms.uMilkiness = { value: milkiness };
    shader.uniforms.uMilkBottomTint = { value: bottomTint };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vMilkWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPosM = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPosM = instanceMatrix * wsPosM;\n#endif\nwsPosM = modelMatrix * wsPosM;\nvMilkWorldPos = wsPosM.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vMilkWorldPos;\nuniform float uMilkiness;\nuniform vec3 uMilkBottomTint;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n// Smooth frosted roughness (no dotty noise)\nroughnessFactor = clamp(max(roughnessFactor, 0.75) + uMilkiness * 0.15, 0.0, 1.0);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n// Subtle vertical density: slightly denser near base\nfloat g = clamp(vMilkWorldPos.y, 0.0, 1.0);\ndiffuseColor.rgb = mix(uMilkBottomTint, diffuseColor.rgb, smoothstep(0.0, 1.0, g));`
      )
      .replace(
        "#include <output_fragment>",
        `float ndv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);\n// More scattering at grazing angles\nfloat scatter = clamp(uMilkiness * 0.75 + (1.0 - ndv) * 0.35, 0.0, 1.0);\noutgoingLight = mix(outgoingLight, vec3(1.0), scatter);\n#include <output_fragment>`
      );
  };

  material.needsUpdate = true;
}

function applyWoodGrainShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { scale?: number; intensity?: number }
) {
  const scale = opts?.scale ?? 6.0;
  const intensity = opts?.intensity ?? 0.4;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }
    shader.uniforms.uWoodScale = { value: scale };
    shader.uniforms.uWoodIntensity = { value: intensity };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPos = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPos = instanceMatrix * wsPos;\n#endif\nwsPos = modelMatrix * wsPos;\nvWorldPos = wsPos.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos;
uniform float uWoodScale;
uniform float uWoodIntensity;

float woodHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float woodNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(woodHash(i + vec2(0.0,0.0)), woodHash(i + vec2(1.0,0.0)), f.x),
               mix(woodHash(i + vec2(0.0,1.0)), woodHash(i + vec2(1.0,1.0)), f.x), f.y);
}

float fbmWood(vec2 p) {
    float v = 0.0;
    v += 0.5 * woodNoise(p); p *= 2.0;
    v += 0.25 * woodNoise(p); p *= 2.0;
    return v;
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 wp = vWorldPos.xz * uWoodScale;
// Distort domain for organic look
float n = fbmWood(wp);
wp += n * 0.5;

// Wood rings
float ring = sin(wp.x * 10.0 + wp.y * 2.0);
ring = smoothstep(-0.4, 0.4, ring);

// Fibers
float fiber = fbmWood(wp * vec2(20.0, 1.0));

float grain = mix(ring, fiber, 0.3);
float shade = mix(0.7, 1.1, grain);

diffuseColor.rgb *= mix(1.0, shade, uWoodIntensity);
`
      );
  };

  material.needsUpdate = true;
}

function applyHammeredMetalShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { strength?: number; scale?: number }
) {
  const strength = opts?.strength ?? 0.15;
  const scale = opts?.scale ?? 12.0;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }
    shader.uniforms.uMetalVarStrength = { value: strength };
    shader.uniforms.uMetalVarScale = { value: scale };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vWorldPos2;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPos2 = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPos2 = instanceMatrix * wsPos2;\n#endif\nwsPos2 = modelMatrix * wsPos2;\nvWorldPos2 = wsPos2.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWorldPos2;
uniform float uMetalVarStrength;
uniform float uMetalVarScale;

float metalHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float hammeredNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float md = 1.0;
    for(int y=-1; y<=1; y++)
    for(int x=-1; x<=1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(metalHash(i + g), metalHash(i + g + 57.0));
        vec2 r = g + o - f;
        float d = length(r);
        if(d < md) md = d;
    }
    return md;
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float dents = hammeredNoise(vWorldPos2.xz * uMetalVarScale);
float dentFactor = smoothstep(0.2, 0.8, dents);
roughnessFactor = clamp(roughnessFactor + (dentFactor - 0.5) * uMetalVarStrength, 0.05, 0.9);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float cDents = hammeredNoise(vWorldPos2.xz * uMetalVarScale);
float cFactor = smoothstep(0.25, 0.75, cDents);
// High contrast for hammered look
diffuseColor.rgb *= mix(0.7, 1.3, cFactor);`
      );
  };

  material.needsUpdate = true;
}

function PieceModel({
  path,
  tint,
  chessTheme,
  side,
}: {
  path: string;
  tint: THREE.Color;
  chessTheme?: string;
  side?: "w" | "b";
}) {
  const gltf = useGLTF(path) as any;

  const cloned = useMemo(() => {
    const root: THREE.Object3D = gltf.scene.clone(true);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const srcMat = mesh.material as any;
      if (!srcMat || !srcMat.isMaterial) return;
      mesh.material = srcMat.clone();
      const clonedMat = mesh.material as any;
      if (clonedMat.color && clonedMat.color.isColor) {
        clonedMat.color = clonedMat.color.clone();
      }

      if (chessTheme === "chess_glass") {
        const isWhite = side === "w";
        // Match ref: white = frosted/milky, black = clear glass.
        const base = isWhite
          ? new THREE.Color("#f7fbff")
          : new THREE.Color("#0f141b");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#e9f2ff");

        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(base);
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.0;
        if (typeof clonedMat.roughness === "number")
          clonedMat.roughness = isWhite ? 0.92 : 0.03;
        clonedMat.transparent = true;
        clonedMat.opacity = isWhite ? 0.86 : 0.42;
        // Clear glass blends better without writing depth.
        clonedMat.depthWrite = isWhite;
        (clonedMat as any).premultipliedAlpha = true;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(rim);
          clonedMat.emissiveIntensity = isWhite ? 0.02 : 0.04;
        }
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = isWhite ? 0.8 : 1.6;

        if (isWhite) {
          applyMilkGlassShader(clonedMat, {
            milkiness: 0.85,
            bottomTint: new THREE.Color("#eef4ff"),
          });
          applyFresnelRim(clonedMat, rim, 2.2, 0.25);
        } else {
          applyClearGlassShader(clonedMat, {
            scale: 1.0,
            absorbStrength: 0.7,
            bottomTint: new THREE.Color("#050607"),
          });
          applyFresnelRim(clonedMat, rim, 2.8, 0.22);
        }
      } else if (chessTheme === "chess_gold") {
        const isWhite = side === "w";
        // Shader-based metals: white side = silver, black side = gold.
        const base = isWhite
          ? new THREE.Color("#d8dee6")
          : new THREE.Color("#ffd15a");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#fff0c2");

        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(base);
        if (typeof clonedMat.metalness === "number")
          clonedMat.metalness = isWhite ? 0.72 : 0.9;
        if (typeof clonedMat.roughness === "number")
          clonedMat.roughness = isWhite ? 0.34 : 0.2;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(rim);
          clonedMat.emissiveIntensity = isWhite ? 0.04 : 0.08;
        }
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = isWhite ? 1.1 : 1.25;
        applyHammeredMetalShader(clonedMat, {
          strength: isWhite ? 0.15 : 0.2,
          scale: 14.0,
        });
        applyFresnelRim(clonedMat, rim, 2.8, isWhite ? 0.24 : 0.28);
      } else if (chessTheme === "chess_wood") {
        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(tint);
        // Wood: low metalness, higher roughness, with procedural grain shader
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.05;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.85;
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = 0.35;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(tint.clone().multiplyScalar(0.02));
          clonedMat.emissiveIntensity = 0.25;
        }
        applyWoodGrainShader(clonedMat, { scale: 11.5, intensity: 0.55 });
      } else if (chessTheme === "chess_marble") {
        const isWhite = side === "w";
        // Marble shader using the same technique as the marble board
        const darkBase = isWhite
          ? new THREE.Color("#e8e8e8")
          : new THREE.Color("#5e5e5e");
        const lightBase = isWhite
          ? new THREE.Color("#6a6560")
          : new THREE.Color("#c0c0c0");

        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(darkBase);
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.12;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.25;
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = 0.85;

        // Apply marble shader
        const prev = clonedMat.onBeforeCompile;
        clonedMat.onBeforeCompile = (shader: any, renderer: any) => {
          try {
            (prev as any).call(clonedMat as any, shader, renderer);
          } catch {
            // ignore
          }

          shader.uniforms.uDarkBase = { value: darkBase };
          shader.uniforms.uLightBase = { value: lightBase };
          shader.uniforms.uIsWhite = { value: isWhite ? 1.0 : 0.0 };

          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              `#include <common>\nvarying vec3 vWorldPos;`
            )
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>\nvec4 wsPos = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPos = instanceMatrix * wsPos;\n#endif\nwsPos = modelMatrix * wsPos;\nvWorldPos = wsPos.xyz;`
            );

          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>
varying vec3 vWorldPos;
uniform vec3 uDarkBase;
uniform vec3 uLightBase;
uniform float uIsWhite;

vec2 hash2(vec2 p) {
    p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453);
}

float voronoiCracks(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 8.0;
    vec2 mg, mr;
    
    for(int j=-1; j<=1; j++)
    for(int i=-1; i<=1; i++) {
        vec2 g = vec2(float(i),float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        float d = dot(r,r);
        if(d < md) {
            md = d;
            mr = r;
            mg = g;
        }
    }
    
    md = 8.0;
    for(int j=-1; j<=1; j++)
    for(int i=-1; i<=1; i++) {
        vec2 g = vec2(float(i),float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        if(dot(mr-r,mr-r) > 0.00001) {
            md = min(md, dot(0.5*(mr+r), normalize(r-mr)));
        }
    }
    return md;
}`
            )
            .replace(
              "#include <color_fragment>",
              `#include <color_fragment>
vec3 p = vWorldPos * 4.0;
float cracks = voronoiCracks(p.xz + p.y * 0.5);
float crackLine = 1.0 - smoothstep(0.0, 0.04, cracks);

float noise = 0.0;
vec2 np = p.xz * 0.5;
noise += (sin(np.x * 3.0 + sin(np.y * 2.0)) + 1.0) * 0.5;

vec3 baseColor = uDarkBase * (0.85 + noise * 0.3); // Subtle variance
vec3 crackColor = uIsWhite > 0.5 ? vec3(0.2, 0.2, 0.25) : vec3(0.9, 0.9, 0.95);

diffuseColor.rgb = mix(baseColor, crackColor, crackLine * 0.65);
`
            );
        };
        clonedMat.needsUpdate = true;
      } else {
        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(tint);
        // Metallic material for pieces
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.7;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.3;
      }
    });

    // Orient upright and center the model on its base.
    root.rotation.set(Math.PI / 2, 0, 0);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.min.y) &&
      Number.isFinite(box.min.z)
    ) {
      const center = box.getCenter(new THREE.Vector3());
      // Center X/Z, but rest on the bottom Y
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
      root.updateWorldMatrix(true, true);
    }

    return root;
  }, [gltf, tint, chessTheme, side]);

  return <primitive object={cloned} />;
}

const BOARD_TOP_Y = 0.08;
const SQUARE_TOP_Y = 0.04;

function easeInOut(t: number) {
  // smoothstep
  return t * t * (3 - 2 * t);
}

function AnimatedPiece({
  square,
  type,
  color,
  originVec,
  squareSize,
  animateFrom,
  animSeq,
  canMove,
  mySide,
  onPickPiece,
  whiteTint,
  blackTint,
  chessTheme,
}: {
  square: Square;
  type: string;
  color: Side;
  originVec: THREE.Vector3;
  squareSize: number;
  animateFrom: Square | null;
  animSeq: number;
  canMove: boolean;
  mySide: Side | null;
  onPickPiece: (sq: Square) => void;
  whiteTint: THREE.Color;
  blackTint: THREE.Color;
  chessTheme?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const animRef = useRef<{
    seq: number;
    startMs: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
  } | null>(null);

  const finalPos = useMemo(
    () => squareCenter(square, originVec, squareSize),
    [square, originVec, squareSize]
  );

  useEffect(() => {
    if (!animateFrom) {
      animRef.current = null;
      const g = groupRef.current;
      if (g) g.position.set(finalPos.x, BOARD_TOP_Y, finalPos.z);
      return;
    }

    const fromPos = squareCenter(animateFrom, originVec, squareSize);
    animRef.current = {
      seq: animSeq,
      startMs: performance.now(),
      from: fromPos,
      to: finalPos,
    };
    const g = groupRef.current;
    if (g) g.position.set(fromPos.x, BOARD_TOP_Y, fromPos.z);
  }, [animateFrom, animSeq, originVec, squareSize, finalPos]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const a = animRef.current;
    if (!a) {
      g.position.set(finalPos.x, BOARD_TOP_Y, finalPos.z);
      return;
    }
    if (a.seq !== animSeq) {
      animRef.current = null;
      g.position.set(finalPos.x, BOARD_TOP_Y, finalPos.z);
      return;
    }

    const dur = 240;
    const t = (performance.now() - a.startMs) / dur;
    const k = easeInOut(clamp(t, 0, 1));
    const x = THREE.MathUtils.lerp(a.from.x, a.to.x, k);
    const z = THREE.MathUtils.lerp(a.from.z, a.to.z, k);
    g.position.set(x, BOARD_TOP_Y, z);

    if (t >= 1) {
      animRef.current = null;
    }
  });

  const tint = color === "w" ? whiteTint : blackTint;
  const scale = 11.25;

  return (
    <group
      ref={groupRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPickPiece(square);
      }}
      onPointerEnter={() => {
        if (canMove) document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      <group scale={[scale, scale, scale]}>
        <PieceModel
          path={piecePath(type)}
          tint={tint}
          chessTheme={chessTheme}
          side={color}
        />
      </group>
    </group>
  );
}

function JoinPad({
  label,
  center,
  size,
  active,
  disabled,
  onClick,
}: {
  label: string;
  center: THREE.Vector3;
  size: [number, number];
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const [w, d] = size;
  const handleClick = (e: any) => {
    e.stopPropagation();
    if (disabled) return;
    onClick();
  };
  return (
    <group
      position={[center.x, center.y, center.z]}
      onPointerDown={handleClick}
      onPointerEnter={() => {
        if (!disabled) document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      {/* Stone pillar base */}
      <mesh receiveShadow castShadow onPointerDown={handleClick}>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial
          color={disabled ? "#4a4a4a" : active ? "#d4af37" : "#8b7355"}
          roughness={0.6}
          metalness={active ? 0.3 : 0.1}
        />
      </mesh>
      {/* Decorative top cap */}
      <mesh
        receiveShadow
        castShadow
        position={[0, 0.18, 0]}
        onPointerDown={handleClick}
      >
        <boxGeometry args={[w * 1.1, 0.06, d * 1.1]} />
        <meshStandardMaterial
          color={disabled ? "#3a3a3a" : active ? "#ffd700" : "#a0826d"}
          roughness={0.5}
          metalness={active ? 0.4 : 0.15}
        />
      </mesh>
      {/* Text on top */}
      <Text
        position={[0, 0.235, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.2}
        lineHeight={0.9}
        maxWidth={w * 0.98}
        textAlign="center"
        color={disabled ? "#888" : active ? "#fff" : "#1a1a1a"}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor={active ? "#000" : "transparent"}
        fontWeight="bold"
        depthOffset={-1}
        onPointerDown={handleClick}
      >
        {label}
      </Text>
      {/* Glowing effect when active */}
      {active && (
        <pointLight
          position={[0, 0.5, 0]}
          color="#ffd700"
          intensity={2}
          distance={3}
        />
      )}
    </group>
  );
}

function PlantMaterial(props: any) {
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
    `
      .replace(
        "#include <worldpos_vertex>",
        `
      #include <worldpos_vertex>
      vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
      )
      .replace(
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

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Leafy Voronoi Pattern
      float v = voronoi(vPos * 12.0);
      float leaf = 1.0 - smoothstep(0.0, 0.7, v);
      vec3 col = mix(COLOR_BUSH1, COLOR_BUSH2, leaf);
      float largeNoise = voronoi(vPos * 2.0);
      col = mix(col, COLOR_BUSH3, largeNoise);
      if (largeNoise > 0.8) {
         col = mix(col, COLOR_BUSH5, 0.5);
      }
      float ao = smoothstep(0.0, 0.5, 1.0 - v);
      diffuseColor.rgb = col * (0.4 + 0.6 * ao);
      
      // Silhouette breakup
      // Use gl_FrontFacing or similar if needed, but for now just discard based on noise
      // to avoid vNormal issues
      if (v > 0.65) {
          // discard; // Optional: can look messy on small plants without proper depth sorting
      }
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      side={THREE.DoubleSide}
      {...props}
    />
  );
}

function WoodMaterial({ color, ...props }: any) {
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

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      
      // Wood grain logic
      // Stretch noise along one axis to simulate grain
      // Use world position for continuity across squares if desired, or local if we want them distinct.
      // vPos is world position.
      
      float grain = fbm(vPos.xz * vec2(1.0, 12.0)); // Stretched z-axis grain
      
      // Add some ring-like patterns (turbulence)
      float rings = noise(vPos.xz * 1.5 + grain * 0.3);
      
      // Mix base color with darker/lighter variations
      vec3 baseColor = diffuseColor.rgb;
      vec3 darkGrain = baseColor * 0.75;
      vec3 lightGrain = baseColor * 1.15;
      
      // Combine
      float pattern = smoothstep(0.2, 0.8, grain * 0.7 + rings * 0.3);
      diffuseColor.rgb = mix(darkGrain, lightGrain, pattern);
      `
    );
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      color={color}
      onBeforeCompile={onBeforeCompile}
      {...props}
    />
  );
}

function MarbleTileMaterial({ color, ...props }: { color: string } & any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const vein = useMemo(() => new THREE.Color("#ffffff"), []);

  const onBeforeCompile = (shader: any) => {
    shader.uniforms.uBase = { value: base };
    shader.uniforms.uVein = { value: vein };
    shader.uniforms.uSquareSize = { value: 0.6 };

    shader.vertexShader = `
      varying vec3 vPos;
      varying vec2 vMarbleUv;
      ${shader.vertexShader}
    `
      .replace(
        "#include <uv_vertex>",
        `
      #include <uv_vertex>
      vMarbleUv = uv;
      `
      )
      .replace(
        "#include <worldpos_vertex>",
        `
        #include <worldpos_vertex>
        vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

    shader.fragmentShader = `
      varying vec3 vPos;
      varying vec2 vMarbleUv;
      uniform vec3 uBase;
      uniform vec3 uVein;
      uniform float uSquareSize;

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

      // Granite: layered abs noise (from reference shader)
      float granite(vec2 p) {
        float o = 0.0;
        for (int i = 0; i < 4; i++) {
          o = o * 2.0 + abs(noise2(p) * 2.0 - 1.0);
          p *= 2.0;
        }
        return o / 15.0; // normalize (2^4 - 1)
      }

      mat2 rot(float a) {
        float s = sin(a);
        float c = cos(a);
        return mat2(c, -s, s, c);
      }

      ${shader.fragmentShader}
    `.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>

      // Per-square variation so tiles don't all look identical.
      // Index in world space (board is centered near origin, squareSize=0.6).
      vec2 idx = floor((vPos.xz / uSquareSize) + vec2(4.0));
      float r0 = hash21(idx + vec2(1.7, 9.2));
      float r1 = hash21(idx + vec2(7.3, 2.1));
      float r2 = hash21(idx + vec2(3.1, 5.9));

      float ang = r0 * 6.2831853;
      vec2 uv = vMarbleUv - 0.5;
      uv = rot(ang) * uv;
      uv += 0.5;

      vec2 tileOffset = vec2(r1, r2) * 3.5;
      vec2 p = (uv + tileOffset) * vec2(2.0, 2.0);

      // Reference shader approach: squash vector + granite pattern
      float tileFlip = r0 > 0.5 ? 1.0 : -1.0;
      vec2 v = normalize(vec2(tileFlip, 1.0));
      float squash = dot(v, p) * (2.5 + 0.5 * tileFlip);
      float pattern = 1.0 - granite((p + v * squash) * 2.2);
      
      // Sharp color transition using power curve (like reference)
      float veinThreshold = 0.12;
      vec3 darkBase = uBase * 0.45;
      vec3 lightBase = mix(uBase, uVein, 0.35);
      float t = pow(clamp(pattern / (1.0 - veinThreshold * 0.7), 0.0, 1.0), 18.0);
      vec3 col = mix(darkBase, lightBase, t);
      
      // Subtle per-tile brightness variation
      col *= 1.0 + (r1 - 0.5) * 0.08;

      diffuseColor.rgb = col;
      `
    );

    (materialRef.current as any).userData.shader = shader;
  };

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      roughness={0.22}
      metalness={0.0}
      {...props}
    />
  );
}

function NeonTileMaterial({ color, ...props }: { color: string } & any) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const neon = useMemo(() => new THREE.Color("#4be7ff"), []);
  const neonAlt = useMemo(() => new THREE.Color("#ff4bd8"), []);

  const onBeforeCompile = (shader: any) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uBase = { value: base };
    shader.uniforms.uNeon = { value: neon };
    shader.uniforms.uNeonAlt = { value: neonAlt };
    shader.uniforms.uSquareSize = { value: 0.6 };

    shader.vertexShader = `
      varying vec3 vPos;
      varying vec2 vTronUv;
      ${shader.vertexShader}
    `
      .replace(
        "#include <uv_vertex>",
        `
        #include <uv_vertex>
        vTronUv = uv;
        `
      )
      .replace(
        "#include <worldpos_vertex>",
        `
        #include <worldpos_vertex>
        vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );

    shader.fragmentShader = `
      varying vec3 vPos;
      varying vec2 vTronUv;
      uniform float uTime;
      uniform vec3 uBase;
      uniform vec3 uNeon;
      uniform vec3 uNeonAlt;
      uniform float uSquareSize;

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
      ${shader.fragmentShader}
    `
      .replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>

        vec2 uv = vTronUv;
        vec2 pW = vPos.xz;
        float grime = fbm2(pW * 0.30);
        float pulse = 0.82 + 0.18 * sin(uTime * 1.10 + (vPos.x + vPos.z) * 0.65);

        float s0 = panelSeams(pW, vec2(1.8, 1.8));
        float s1 = panelSeams(pW + vec2(0.55, 0.8), vec2(4.6, 4.6));
        float seams = clamp(s0 * 0.9 + s1 * 0.35, 0.0, 1.0);

        float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        float borderLine = 1.0 - smoothstep(0.045, 0.070, edge);

        vec2 p = uv * 10.0;
        vec2 cell = abs(fract(p) - 0.5);
        float grid = 1.0 - smoothstep(0.492, 0.5, min(cell.x, cell.y));

        float n = fbm2(uv * 14.0 + vec2(2.3, -1.7));
        float traces = smoothstep(0.70, 0.86, n) * 0.55;

        vec2 idx = floor((pW / uSquareSize) + vec2(4.0));
        float parity = mod(idx.x + idx.y, 2.0);
        vec3 neonCol = mix(uNeon, uNeonAlt, parity);

        float baseLum = dot(uBase, vec3(0.299, 0.587, 0.114));
        float baseMul = mix(0.28, 0.52, smoothstep(0.08, 0.34, baseLum));

        diffuseColor.rgb = uBase * baseMul;
        diffuseColor.rgb *= mix(0.92, 1.03, grime);
        float dataPulse = smoothstep(0.92, 1.0, abs(sin((uv.x + uv.y) * 18.0 + uTime * 1.6 + n * 4.0)));
        diffuseColor.rgb += neonCol * (borderLine * 0.045 + grid * 0.016 + traces * 0.015) * pulse;
        diffuseColor.rgb += neonCol * (seams * 0.012) * (0.85 + 0.15 * grime);
        diffuseColor.rgb += neonCol * (dataPulse * 0.008) * (0.8 + 0.2 * pulse);
        `
      )
      .replace(
        "#include <emissivemap_fragment>",
        `
        #include <emissivemap_fragment>
        vec2 uv2 = vTronUv;
        float edge2 = min(min(uv2.x, 1.0 - uv2.x), min(uv2.y, 1.0 - uv2.y));
        float borderLine2 = 1.0 - smoothstep(0.045, 0.070, edge2);

        vec2 p2 = uv2 * 10.0;
        vec2 cell2 = abs(fract(p2) - 0.5);
        float grid2 = 1.0 - smoothstep(0.492, 0.5, min(cell2.x, cell2.y));

        float n2 = fbm2(uv2 * 14.0 + vec2(2.3, -1.7));
        float traces2 = smoothstep(0.70, 0.86, n2) * 0.55;

        vec2 pW2 = vPos.xz;
        float s02 = panelSeams(pW2, vec2(1.8, 1.8));
        float s12 = panelSeams(pW2 + vec2(0.55, 0.8), vec2(4.6, 4.6));
        float seams2 = clamp(s02 * 0.9 + s12 * 0.35, 0.0, 1.0);

        vec2 idx2 = floor((pW2 / uSquareSize) + vec2(4.0));
        float parity2 = mod(idx2.x + idx2.y, 2.0);
        vec3 neonCol2 = mix(uNeon, uNeonAlt, parity2);

        float pulse2 = 0.82 + 0.18 * sin(uTime * 1.10 + (vPos.x + vPos.z) * 0.65);
        float flicker2 = 0.92 + 0.08 * noise2(vPos.xz * 0.70 + vec2(uTime * 0.10, uTime * 0.07));

        totalEmissiveRadiance += neonCol2 * (borderLine2 * 0.10 + grid2 * 0.032 + traces2 * 0.040) * pulse2 * flicker2;
        totalEmissiveRadiance += neonCol2 * (seams2 * 0.030) * (0.85 + 0.15 * flicker2);
        `
      );

    (materialRef.current as any).userData.shader = shader;
  };

  useFrame(({ clock }) => {
    const shader = (materialRef.current as any)?.userData?.shader;
    if (shader?.uniforms?.uTime)
      shader.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <meshStandardMaterial
      ref={materialRef}
      onBeforeCompile={onBeforeCompile}
      roughness={0.25}
      metalness={0.45}
      emissive={neon}
      emissiveIntensity={0.05}
      {...props}
    />
  );
}

function Bench({
  position,
  rotation,
  onClick,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  onClick?: (e: any) => void;
}) {
  const legColor = "#222222";
  const woodColor = "#8b5a2b";

  return (
    <group
      position={position}
      rotation={rotation}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick && onClick(e);
      }}
      onPointerEnter={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "default";
      }}
    >
      {/* Cast Iron Legs (Ornate style simplified) */}
      <group position={[-0.9, 0, 0]}>
        {/* Front Leg */}
        <mesh castShadow position={[0, 0.2, 0.25]}>
          <boxGeometry args={[0.1, 0.4, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Back Leg + Backrest Support */}
        <mesh castShadow position={[0, 0.45, -0.25]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[0.1, 0.9, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Base Connector */}
        <mesh castShadow position={[0, 0.1, 0]}>
          <boxGeometry args={[0.08, 0.1, 0.6]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
      </group>

      <group position={[0.9, 0, 0]}>
        {/* Front Leg */}
        <mesh castShadow position={[0, 0.2, 0.25]}>
          <boxGeometry args={[0.1, 0.4, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Back Leg + Backrest Support */}
        <mesh castShadow position={[0, 0.45, -0.25]} rotation={[-0.2, 0, 0]}>
          <boxGeometry args={[0.1, 0.9, 0.1]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
        {/* Base Connector */}
        <mesh castShadow position={[0, 0.1, 0]}>
          <boxGeometry args={[0.08, 0.1, 0.6]} />
          <meshStandardMaterial
            color={legColor}
            roughness={0.8}
            metalness={0.6}
          />
        </mesh>
      </group>

      {/* Seat Slats */}
      {[0.2, 0.0, -0.2].map((z, i) => (
        <mesh
          key={`seat-${i}`}
          castShadow
          receiveShadow
          position={[0, 0.42, z]}
        >
          <boxGeometry args={[2.0, 0.05, 0.15]} />
          <WoodMaterial color={woodColor} roughness={0.8} />
        </mesh>
      ))}

      {/* Backrest Slats */}
      {[0.6, 0.8].map((y, i) => (
        <mesh
          key={`back-${i}`}
          castShadow
          receiveShadow
          position={[0, y, -0.32 + i * 0.05]}
          rotation={[-0.2, 0, 0]}
        >
          <boxGeometry args={[2.0, 0.15, 0.05]} />
          <WoodMaterial color={woodColor} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function OutdoorChess({
  roomId,
  boardKey,
  origin,
  selfPositionRef,
  selfId,
  selfName,
  joinLockedBoardKey,
  onJoinIntent,
  onSelfSeatChange,
  onRequestMove,
  chessTheme,
  chessBoardTheme,
}: {
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  joinLockedBoardKey?: string | null;
  onJoinIntent?: (boardKey: string) => void;
  onSelfSeatChange?: (boardKey: string, side: Side | null) => void;
  onRequestMove?: (
    dest: Vec3,
    opts?: { rotY?: number; sit?: boolean; sitDest?: Vec3; lookAtTarget?: Vec3 }
  ) => void;
  chessTheme?: string;
  chessBoardTheme?: string;
}) {
  const originVec = useMemo(
    () => new THREE.Vector3(origin[0], origin[1], origin[2]),
    [origin]
  );
  const squareSize = 0.6;
  const boardSize = squareSize * 8;

  const whiteTint = useMemo(() => {
    if (chessTheme === "chess_wood") return new THREE.Color("#e1c28b");
    return new THREE.Color("#e8e8e8");
  }, [chessTheme]);
  const blackTint = useMemo(() => {
    // For the wood set, the dark side should read warm/golden (not near-black).
    if (chessTheme === "chess_wood") return new THREE.Color("#8a6a1b");
    // Classic default should actually be dark.
    return new THREE.Color("#1c1c1c");
  }, [chessTheme]);

  const boardStyle = useMemo(() => {
    switch (chessBoardTheme) {
      case "board_walnut":
        return { kind: "wood" as const, light: "#c7a07a", dark: "#5a2d13" };
      case "board_marble":
        return { kind: "marble" as const, light: "#d9d9df", dark: "#3a3a44" };
      case "board_neon":
        // Darker, closer to preview.
        return { kind: "neon" as const, light: "#1f5561", dark: "#070a10" };
      default:
        return { kind: "wood" as const, light: "#deb887", dark: "#8b4513" };
    }
  }, [chessBoardTheme]);

  const socketRef = useRef<PartySocket | null>(null);
  const [chessSelfId, setChessSelfId] = useState<string>("");
  const [chessConnected, setChessConnected] = useState(false);
  const chessConnectedRef = useRef(false);
  const pendingJoinRef = useRef<Side | null>(null);
  const [pendingJoinSide, setPendingJoinSide] = useState<Side | null>(null);

  useEffect(() => {
    chessConnectedRef.current = chessConnected;
  }, [chessConnected]);

  const initialFen = useMemo(() => new Chess().fen(), []);
  const defaultClock = useMemo<ClockState>(() => {
    const baseMs = 5 * 60 * 1000;
    return {
      baseMs,
      remainingMs: { w: baseMs, b: baseMs },
      running: false,
      active: "w",
      lastTickMs: null,
    };
  }, []);
  const [netState, setNetState] = useState<ChessNetState>({
    seats: { w: null, b: null },
    fen: initialFen,
    seq: 0,
    clock: defaultClock,
    result: null,
    lastMove: null,
  });

  const mySide: Side | null = useMemo(() => {
    if (netState.seats.w?.connId === chessSelfId) return "w";
    if (netState.seats.b?.connId === chessSelfId) return "b";
    return null;
  }, [netState.seats.w, netState.seats.b, chessSelfId]);

  const chess = useMemo(() => new Chess(netState.fen), [netState.fen]);

  const turn = chess.turn();

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const lastMove = netState.lastMove;

  const { playMove, playCapture, playSelect, playWarning, playClick } =
    useChessSounds();
  const prevFenForSound = useRef(initialFen);
  const lastSoundSeq = useRef(0);
  const hasWarnedRef = useRef(false);

  // Sound effects for moves (only for players who are seated)
  useEffect(() => {
    if (!mySide) return; // Only play sounds if we're a player
    if (netState.seq <= lastSoundSeq.current) return;
    lastSoundSeq.current = netState.seq;

    if (netState.lastMove) {
      try {
        const tempChess = new Chess(prevFenForSound.current);
        // Try to make the move to see if it was a capture
        // We guess promotion to 'q' if needed, just to check capture flag
        const moveResult = tempChess.move({
          from: netState.lastMove.from,
          to: netState.lastMove.to,
          promotion: "q",
        });

        if (moveResult && moveResult.captured) {
          playCapture();
        } else {
          playMove();
        }
      } catch (e) {
        // Fallback if move validation fails (shouldn't happen with valid server state)
        playMove();
      }
    }

    prevFenForSound.current = netState.fen;
    // Reset warning flag on new move
    hasWarnedRef.current = false;
  }, [
    mySide,
    netState.seq,
    netState.fen,
    netState.lastMove,
    playMove,
    playCapture,
  ]);

  // Drive clock rendering while it's running.
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!netState.clock.running) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [netState.clock.running]);

  // Clock warning sound (only for the player whose clock is running low)
  useEffect(() => {
    if (!mySide) return; // Only play warning if we're a player
    if (!netState.clock.running) return;
    const c = netState.clock;

    // Only warn if it's OUR clock running low
    if (c.active !== mySide) return;

    const now = clockNow;
    const remaining = c.remainingMs[c.active];
    const elapsed = c.lastTickMs ? Math.max(0, now - c.lastTickMs) : 0;
    const currentRemaining = Math.max(0, remaining - elapsed);

    // Warn at 30 seconds remaining
    if (
      currentRemaining < 30000 &&
      currentRemaining > 0 &&
      !hasWarnedRef.current
    ) {
      playWarning();
      hasWarnedRef.current = true;
    }
  }, [mySide, clockNow, netState.clock, playWarning]);

  const send = (msg: ChessSendMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    onSelfSeatChange?.(boardKey, mySide);
    if (mySide) setPendingJoinSide(null);
  }, [boardKey, mySide, onSelfSeatChange]);

  useEffect(() => {
    if (!chessConnected) return;

    console.log(`[Chess] Connecting to room ${roomId}-chess-${boardKey}`);
    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      party: "chess",
      room: `${roomId}-chess-${boardKey}`,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      console.log("[Chess] Connected");

      // IMPORTANT: PartyKit ids are per-connection. Use the chess socket id
      // for seat ownership checks and move permissions.
      setChessSelfId(socket.id);

      // Request any pending join
      const pendingSide = pendingJoinRef.current;
      if (pendingSide) {
        pendingJoinRef.current = null;
        send({ type: "join", side: pendingSide });
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as ChessMessage;

        if (msg.type === "state") {
          setNetState((prev) => {
            if (msg.state.seq < prev.seq) return prev;
            if (msg.state.seq === prev.seq && msg.state.fen === prev.fen)
              return prev;
            return msg.state;
          });
        }
      } catch (err) {
        console.error("[Chess] Error parsing message:", err);
      }
    });

    socket.addEventListener("close", () => {
      console.log("[Chess] Disconnected");
    });

    return () => {
      socket.close();
    };
  }, [chessConnected, roomId, boardKey]);

  const lastSeenSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (netState.seq === lastSeenSeqRef.current) return;
    lastSeenSeqRef.current = netState.seq;
    setSelected(null);
    setLegalTargets([]);
  }, [netState.seq]);

  const requestJoin = (side: Side) => {
    const seat = netState.seats[side];
    if (seat && seat.connId !== chessSelfId) return; // Taken by someone else
    send({ type: "join", side, playerId: selfId, name: selfName });
  };

  const requestLeave = (side: Side) => {
    send({ type: "leave", side });
  };

  const submitMove = (
    from: Square,
    to: Square,
    promotion?: "q" | "r" | "b" | "n"
  ) => {
    if (!mySide) return;
    if (netState.result) return;
    if (turn !== mySide) return;

    send({ type: "move", from, to, promotion });
  };

  const onPickSquare = (square: Square) => {
    if (netState.result) return;
    // If we have a selection and click a legal target, move there
    if (selected && legalTargets.includes(square)) {
      const piece = chess.get(selected);
      const isPawn = piece?.type === "p";
      const toRank = Number(square[1]);
      const promotion =
        isPawn &&
        ((piece?.color === "w" && toRank === 8) ||
          (piece?.color === "b" && toRank === 1))
          ? "q"
          : undefined;

      submitMove(selected, square, promotion);
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    // Check if there's a piece on this square we can select
    const piece = chess.get(square);

    // If clicking our own piece, select it
    if (piece && mySide && turn === mySide && piece.color === mySide) {
      if (mySide) playSelect(); // Only play if we're a player
      setSelected(square);
      const moves = chess.moves({ square, verbose: true }) as any[];
      const targets = moves.map((m) => m.to).filter(isSquare);
      setLegalTargets(targets);
      return;
    }

    // Otherwise deselect
    setSelected(null);
    setLegalTargets([]);
  };

  const onPickPiece = (square: Square) => {
    // Clicking a piece is the same as clicking its square
    onPickSquare(square);
  };

  useFrame(({ clock }) => {
    const pos = selfPositionRef.current;
    if (!pos) return;

    // Only connect to the chess room when the player is near the board.
    // This avoids doubling WebRTC room overhead for everyone.
    if (!chessConnectedRef.current) {
      const dx = pos.x - originVec.x;
      const dz = pos.z - originVec.z;
      const near = dx * dx + dz * dz < 12 * 12;
      if (near) {
        chessConnectedRef.current = true;
        setChessConnected(true);
      }
      return;
    }

    void clock; // keep signature stable; no per-frame join behavior anymore
  });

  const pieces = useMemo(() => {
    const out: Array<{ square: Square; type: string; color: Side }> = [];
    const board = chess.board(); // ranks 8..1

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r]?.[f];
        if (!p) continue;
        const file = FILES[f]!;
        const rank = 8 - r;
        const sq = `${file}${rank}`;
        if (!isSquare(sq)) continue;
        out.push({ square: sq, type: p.type, color: p.color });
      }
    }

    return out;
  }, [chess]);

  const animatedFromByTo = useMemo(() => {
    const map = new Map<Square, Square>();
    if (!lastMove) return map;

    map.set(lastMove.to, lastMove.from);

    // Castling rook animation: infer rook move from king move.
    if (lastMove.from === "e1" && lastMove.to === "g1") map.set("f1", "h1");
    if (lastMove.from === "e1" && lastMove.to === "c1") map.set("d1", "a1");
    if (lastMove.from === "e8" && lastMove.to === "g8") map.set("f8", "h8");
    if (lastMove.from === "e8" && lastMove.to === "c8") map.set("d8", "a8");

    return map;
  }, [lastMove]);

  const padOffset = boardSize / 2 + 1.1;
  const padSize: [number, number] = [2.1, 0.7];
  const whitePadCenter = useMemo(
    () => new THREE.Vector3(originVec.x, 0.06, originVec.z + padOffset),
    [originVec, padOffset]
  );
  const blackPadCenter = useMemo(
    () => new THREE.Vector3(originVec.x, 0.06, originVec.z - padOffset),
    [originVec, padOffset]
  );

  const joinScheduleRef = useRef<number | null>(null);

  const clickJoin = (side: Side) => {
    if (joinLockedBoardKey && joinLockedBoardKey !== boardKey) return;

    // Lock the user's intent globally so they can't start joining another board.
    // Do this synchronously so the UI can immediately show "Joining…" and lock other boards.
    onJoinIntent?.(boardKey);
    setPendingJoinSide(side);

    // Avoid doing heavy work inside the click handler (audio decode / socket connect can hitch).
    if (joinScheduleRef.current) {
      window.clearTimeout(joinScheduleRef.current);
      joinScheduleRef.current = null;
    }

    joinScheduleRef.current = window.setTimeout(() => {
      joinScheduleRef.current = null;

      // Play click after the event returns to reduce interaction hitch.
      try {
        playClick();
      } catch {
        // ignore
      }

      // Ensure we are connected, then join.
      if (!chessConnectedRef.current) {
        pendingJoinRef.current = side;
        chessConnectedRef.current = true;
        setChessConnected(true);
        return;
      }

      // If socket isn't open yet, queue the join.
      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        pendingJoinRef.current = side;
        return;
      }

      // Toggle behavior:
      // - Clicking your current side leaves (frees seat)
      // - Clicking the other side switches
      if (mySide === side) {
        requestLeave(side);
        setPendingJoinSide(null);
        return;
      }

      if (mySide) requestLeave(mySide);
      requestJoin(side);
    }, 0);
  };

  const requestSitAt = (seatX: number, seatZ: number) => {
    if (!onRequestMove) return;
    const dx = originVec.x - seatX;
    const dz = originVec.z - seatZ;
    const face = Math.atan2(dx, dz);

    // Calculate approach point (0.5m in front of the seat, towards the table)
    const len = Math.sqrt(dx * dx + dz * dz);
    const ux = dx / len;
    const uz = dz / len;
    const approachDist = 0.5;
    const approachX = seatX + ux * approachDist;
    const approachZ = seatZ + uz * approachDist;

    onRequestMove([approachX, 0, approachZ], {
      rotY: face,
      sit: true,
      sitDest: [seatX, 0.36, seatZ],
      lookAtTarget: [originVec.x, originVec.y, originVec.z],
    });
  };

  const clocks = useMemo(() => {
    const c = netState.clock;
    const now = netState.clock.running ? clockNow : Date.now();
    const remaining = { ...c.remainingMs };
    if (c.running && c.lastTickMs !== null) {
      const elapsed = Math.max(0, now - c.lastTickMs);
      remaining[c.active] = Math.max(0, remaining[c.active] - elapsed);
    }
    return {
      remaining,
      active: c.running ? c.active : null,
      baseMs: c.baseMs,
      running: c.running,
    };
  }, [netState.clock, clockNow]);

  const timeIndex = useMemo(() => {
    const baseSeconds = Math.round(clocks.baseMs / 1000);
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    TIME_OPTIONS_SECONDS.forEach((s, idx) => {
      const d = Math.abs(s - baseSeconds);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }, [clocks.baseMs]);

  const canConfigure =
    !!mySide &&
    !netState.clock.running &&
    !netState.result &&
    netState.fen === initialFen;

  const setTimeControlByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
    playClick();
    const idx = clamp(nextIdx, 0, TIME_OPTIONS_SECONDS.length - 1);
    const secs = TIME_OPTIONS_SECONDS[idx]!;
    send({ type: "setTime", baseSeconds: secs });
  };

  const clickReset = () => {
    if (!mySide) return;
    playClick();
    send({ type: "reset" });
  };

  const resultLabel = useMemo(() => {
    const r = netState.result;
    if (!r) return null;
    if (r.type === "timeout") return `${winnerLabel(r.winner)} wins (time)`;
    if (r.type === "checkmate") return `${winnerLabel(r.winner)} wins (mate)`;
    return `Draw (${r.reason})`;
  }, [netState.result]);

  return (
    <group>
      {/* Result banner */}
      {resultLabel ? (
        <Text
          position={[originVec.x, originVec.y + 1.5, originVec.z]}
          fontSize={0.32}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000"
          fontWeight="bold"
        >
          {resultLabel}
        </Text>
      ) : null}

      {/* Decorative benches */}
      {/* White side benches (facing board -> -Z) */}
      <Bench
        position={[originVec.x - 3.5, 0, originVec.z + padOffset + 1.5]}
        rotation={[0, Math.PI, 0]}
        onClick={() =>
          requestSitAt(originVec.x - 3.5, originVec.z + padOffset + 1.35)
        }
      />
      <Bench
        position={[originVec.x + 3.5, 0, originVec.z + padOffset + 1.5]}
        rotation={[0, Math.PI, 0]}
        onClick={() =>
          requestSitAt(originVec.x + 3.5, originVec.z + padOffset + 1.35)
        }
      />

      {/* Black side benches (facing board -> +Z) */}
      <Bench
        position={[originVec.x - 3.5, 0, originVec.z - padOffset - 1.5]}
        rotation={[0, 0, 0]}
        onClick={() =>
          requestSitAt(originVec.x - 3.5, originVec.z - padOffset - 1.35)
        }
      />
      <Bench
        position={[originVec.x + 3.5, 0, originVec.z - padOffset - 1.5]}
        rotation={[0, 0, 0]}
        onClick={() =>
          requestSitAt(originVec.x + 3.5, originVec.z - padOffset - 1.35)
        }
      />

      {/* Decorative potted plants */}
      {[-1, 1].map((side) => (
        <group
          key={`plant-${side}`}
          position={[originVec.x + side * 5, 0, originVec.z]}
        >
          {/* Pot (rim + body + soil) */}
          <mesh castShadow receiveShadow position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.34, 0.38, 0.26, 14]} />
            <meshStandardMaterial
              color="#6f3b22"
              roughness={0.85}
              metalness={0.02}
            />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 0.26, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.06, 14]} />
            <meshStandardMaterial color="#4c2414" roughness={0.9} />
          </mesh>
          <mesh receiveShadow position={[0, 0.285, 0]}>
            <cylinderGeometry args={[0.33, 0.33, 0.02, 14]} />
            <meshStandardMaterial color="#2a1b12" roughness={1} />
          </mesh>

          {/* Plant: leafy shrub (more organic than stacked cones) */}
          <group
            position={[0, 0.32, 0]}
            rotation={[0, side > 0 ? 0.35 : -0.25, 0]}
          >
            {/* Stem */}
            <mesh castShadow position={[0, 0.12, 0]}>
              <cylinderGeometry args={[0.03, 0.045, 0.26, 8]} />
              <meshStandardMaterial
                color="#2a1f17"
                roughness={1}
                metalness={0}
              />
            </mesh>

            {/* Leaf clumps - Procedural */}
            <group position={[0, 0.22, 0]}>
              <mesh castShadow scale={[1.25, 0.92, 1.2]}>
                <sphereGeometry args={[0.22, 12, 10]} />
                <PlantMaterial roughness={1} />
              </mesh>
              <mesh
                castShadow
                position={[0.16, -0.02, 0.1]}
                rotation={[0, 0.6, 0]}
                scale={[1.05, 0.8, 1.0]}
              >
                <sphereGeometry args={[0.18, 12, 10]} />
                <PlantMaterial roughness={1} />
              </mesh>
              <mesh
                castShadow
                position={[-0.15, -0.03, -0.12]}
                rotation={[0, -0.35, 0]}
                scale={[1.0, 0.78, 1.05]}
              >
                <sphereGeometry args={[0.17, 12, 10]} />
                <PlantMaterial roughness={1} />
              </mesh>
            </group>

            {/* Small flowers (subtle) */}
            {[-0.12, 0.0, 0.12].map((fx, i) => (
              <mesh key={i} position={[fx, 0.32, (i - 1) * 0.08]}>
                <sphereGeometry args={[0.03, 8, 8]} />
                <meshStandardMaterial
                  color={side > 0 ? "#ffd6e7" : "#fff1b8"}
                  roughness={0.7}
                />
              </mesh>
            ))}
          </group>
        </group>
      ))}

      {/* Board */}
      <group position={[originVec.x, originVec.y, originVec.z]}>
        {Array.from({ length: 64 }).map((_, idx) => {
          const file = idx % 8;
          const rankFromTop = Math.floor(idx / 8);
          const rank = 8 - rankFromTop;
          const square = `${FILES[file]!}${rank}` as const;

          const x = (file - 3.5) * squareSize;
          const z = (rankFromTop - 3.5) * squareSize;
          const isDark = (file + rankFromTop) % 2 === 1;

          const isTarget = legalTargets.includes(square as any);
          const isSel = selected === (square as any);
          const isLastMoveFrom = lastMove?.from === square;
          const isLastMoveTo = lastMove?.to === square;
          const pieceOnSquare = chess.get(square as Square);
          const canInteract =
            isTarget ||
            (pieceOnSquare &&
              mySide === pieceOnSquare.color &&
              turn === mySide);

          return (
            <group
              key={square}
              position={[x, 0, z]}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPickSquare(square as any);
              }}
              onPointerEnter={() => {
                if (canInteract) document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
                document.body.style.cursor = "default";
              }}
            >
              <mesh receiveShadow>
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                {boardStyle.kind === "wood" ? (
                  <WoodMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                    roughness={0.7}
                    metalness={0.1}
                  />
                ) : boardStyle.kind === "marble" ? (
                  <MarbleTileMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                  />
                ) : (
                  <NeonTileMaterial
                    color={isDark ? boardStyle.dark : boardStyle.light}
                  />
                )}
              </mesh>

              {/* Glow indicators (flush to board) */}
              {isSel && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={3}
                >
                  <planeGeometry
                    args={[squareSize * 0.92, squareSize * 0.92]}
                  />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.14}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isTarget && !isSel && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={2}
                >
                  <planeGeometry args={[squareSize * 0.9, squareSize * 0.9]} />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.09}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isLastMoveFrom && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <planeGeometry
                    args={[squareSize * 0.96, squareSize * 0.96]}
                  />
                  <meshBasicMaterial
                    color="#4a9eff"
                    transparent
                    opacity={0.18}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {isLastMoveTo && (
                <mesh
                  position={[0, SQUARE_TOP_Y + 0.001, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1}
                >
                  <planeGeometry
                    args={[squareSize * 0.96, squareSize * 0.96]}
                  />
                  <meshBasicMaterial
                    color="#ffa04a"
                    transparent
                    opacity={0.2}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      {/* Join pads */}
      <JoinPad
        label={`${formatClock(clocks.remaining.w)}\n${
          netState.seats.w
            ? netState.seats.w.name || "White"
            : pendingJoinSide === "w"
            ? "Joining…"
            : "Join White"
        }`}
        center={whitePadCenter}
        size={padSize}
        active={mySide === "w"}
        disabled={
          (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
          pendingJoinSide === "b" ||
          (!!netState.seats.w && netState.seats.w.connId !== chessSelfId)
        }
        onClick={() => clickJoin("w")}
      />
      <JoinPad
        label={`${formatClock(clocks.remaining.b)}\n${
          netState.seats.b
            ? netState.seats.b.name || "Black"
            : pendingJoinSide === "b"
            ? "Joining…"
            : "Join Black"
        }`}
        center={blackPadCenter}
        size={padSize}
        active={mySide === "b"}
        disabled={
          (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
          pendingJoinSide === "w" ||
          (!!netState.seats.b && netState.seats.b.connId !== chessSelfId)
        }
        onClick={() => clickJoin("b")}
      />

      {/* Time control + reset (right side of board) */}
      {(() => {
        const controlX = originVec.x + boardSize / 2 + 2.6;
        const controlZ = originVec.z;
        const smallSize: [number, number] = [0.9, 0.6];
        const leftCenter = new THREE.Vector3(
          controlX - 1.15,
          0.06,
          controlZ + 1.2
        );
        const rightCenter = new THREE.Vector3(
          controlX + 1.15,
          0.06,
          controlZ + 1.2
        );
        const resetCenter = new THREE.Vector3(controlX, 0.06, controlZ - 1.0);
        return (
          <group>
            <JoinPad
              label="-"
              center={leftCenter}
              size={smallSize}
              active={false}
              disabled={!canConfigure || timeIndex === 0}
              onClick={() => setTimeControlByIndex(timeIndex - 1)}
            />
            <JoinPad
              label="+"
              center={rightCenter}
              size={smallSize}
              active={false}
              disabled={
                !canConfigure || timeIndex === TIME_OPTIONS_SECONDS.length - 1
              }
              onClick={() => setTimeControlByIndex(timeIndex + 1)}
            />
            <Text
              position={[controlX, 0.48, controlZ + 1.2]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.18}
              color="#111"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.008}
              outlineColor="transparent"
              fontWeight="bold"
            >
              {`Time ${Math.round(clocks.baseMs / 60000)}m`}
            </Text>
            <JoinPad
              label="Reset"
              center={resetCenter}
              size={[2.0, 0.7]}
              active={false}
              disabled={!mySide}
              onClick={clickReset}
            />
          </group>
        );
      })()}

      {/* Pieces */}
      {pieces.map((p) => {
        const isMyPiece = mySide === p.color;
        const canMove = turn === p.color && isMyPiece;
        const animateFrom = animatedFromByTo.get(p.square) ?? null;

        // Keep key stable for the duration of a move animation.
        const animKey = animateFrom
          ? `anim:${netState.seq}:${p.color}:${p.type}:${animateFrom}->${p.square}`
          : `static:${p.color}:${p.type}:${p.square}`;

        return (
          <AnimatedPiece
            key={animKey}
            square={p.square}
            type={p.type}
            color={p.color}
            originVec={originVec}
            squareSize={squareSize}
            animateFrom={animateFrom}
            animSeq={netState.seq}
            canMove={canMove}
            mySide={mySide}
            onPickPiece={onPickPiece}
            whiteTint={whiteTint}
            blackTint={blackTint}
            chessTheme={chessTheme}
          />
        );
      })}
    </group>
  );
}

useGLTF.preload("/models/pawn.glb");
useGLTF.preload("/models/knight.glb");
useGLTF.preload("/models/bishop.glb");
useGLTF.preload("/models/rook.glb");
useGLTF.preload("/models/queen.glb");
useGLTF.preload("/models/king.glb");

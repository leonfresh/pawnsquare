"use client";

import { useFrame } from "@react-three/fiber";
import { Chess, type Square } from "chess.js";
import PartySocket from "partysocket";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import type { Vec3 } from "@/lib/partyRoom";
import {
  adjacentSquares,
  gooseLegalMovesForSquare,
  isCenter4,
  parseFenMoveNumber,
} from "@/lib/gooseChess";

export type Side = "w" | "b";
export type { Square } from "chess.js";

export type GameResult =
  | { type: "timeout"; winner: Side }
  | { type: "checkmate"; winner: Side }
  | { type: "resign"; winner: Side }
  | {
      type: "draw";
      reason:
        | "stalemate"
        | "insufficient"
        | "threefold"
        | "fifty-move"
        | "draw";
    };

export type ClockState = {
  baseMs: number;
  incrementMs: number;
  remainingMs: { w: number; b: number };
  running: boolean;
  active: Side;
  lastTickMs: number | null;
};

function safeJson(value: any) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function readRuntimeDevModeFlag() {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return window.localStorage.getItem("pawnsquare.devMode") === "1";
  } catch {
    return false;
  }
}

export type SeatInfo = {
  connId: string;
  playerId: string;
  name: string;
};

export type ChessNetState = {
  seats: { w: SeatInfo | null; b: SeatInfo | null };
  fen: string;
  seq: number;
  clock: ClockState;
  result: GameResult | null;
  lastMove: { from: Square; to: Square } | null;

  // Session UX (standard + goose)
  drawOfferFrom?: Side | null;
  rematch?: { w: boolean; b: boolean };

  // Goose Chess (only present in the goose PartyKit room)
  gooseSquare?: Square;
  phase?: "piece" | "goose";
  activeSide?: Side;
};

export type ChessMessage =
  | { type: "state"; state: ChessNetState }
  | { type: "seats"; seats: ChessNetState["seats"]; seq: number };

export type ChessSendMessage =
  | { type: "join"; side: Side; playerId?: string; name?: string }
  | { type: "leave"; side: Side }
  | {
      type: "move";
      from: Square;
      to: Square;
      promotion?: "q" | "r" | "b" | "n";
    }
  | { type: "goose"; square: Square }
  | { type: "resign" }
  | { type: "draw:offer" }
  | { type: "draw:accept" }
  | { type: "draw:decline" }
  | { type: "draw:cancel" }
  | { type: "rematch:request" }
  | { type: "rematch:decline" }
  | { type: "rematch:cancel" }
  | { type: "setTime"; baseSeconds: number; incrementSeconds?: number }
  | { type: "reset" };

export type LobbyKind = "park" | "scifi";

export type BoardControlsEvent =
  | {
      type: "open";
      boardKey: string;
      lobby: LobbyKind;
      timeMinutes: number;
      incrementSeconds: number;
      fen: string;
      mySide: Side | null;
      turn: Side;
      boardOrientation: "white" | "black";
      canMove2d: boolean;
      clockRemainingMs?: { w: number; b: number };
      clockRunning?: boolean;
      clockActive?: Side | null;
      clockSnapshotAtMs?: number;

      // Match UX (chess/goose only)
      resultLabel?: string | null;
      drawOfferFrom?: Side | null;
      rematch?: { w: boolean; b: boolean };
      canResign?: boolean;
      canOfferDraw?: boolean;
      canAcceptDraw?: boolean;
      canDeclineDraw?: boolean;
      canCancelDraw?: boolean;
      canRequestRematch?: boolean;
      canDeclineRematch?: boolean;
      canCancelRematch?: boolean;
      onResign?: () => void;
      onOfferDraw?: () => void;
      onAcceptDraw?: () => void;
      onDeclineDraw?: () => void;
      onCancelDraw?: () => void;
      onRequestRematch?: () => void;
      onDeclineRematch?: () => void;
      onCancelRematch?: () => void;
      gooseSquare?: string;
      goosePhase?: "piece" | "goose";
      canPlaceGoose?: boolean;
      startledSquares?: string[];
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
      onPlaceGoose?: (square: string) => boolean;
      onInc: () => void;
      onDec: () => void;
      onIncIncrement: () => void;
      onDecIncrement: () => void;
      onReset: () => void;
      onCenter: () => void;
    }
  | {
      type: "sync2d";
      boardKey: string;
      lobby: LobbyKind;
      fen: string;
      mySide: Side | null;
      turn: Side;
      boardOrientation: "white" | "black";
      canMove2d: boolean;
      clockRemainingMs?: { w: number; b: number };
      clockRunning?: boolean;
      clockActive?: Side | null;
      clockSnapshotAtMs?: number;

      // Match UX (chess/goose only)
      resultLabel?: string | null;
      drawOfferFrom?: Side | null;
      rematch?: { w: boolean; b: boolean };
      gooseSquare?: string;
      goosePhase?: "piece" | "goose";
      canPlaceGoose?: boolean;
      startledSquares?: string[];
      onMove2d: (
        from: string,
        to: string,
        promotion?: "q" | "r" | "b" | "n"
      ) => boolean;
      onPlaceGoose?: (square: string) => boolean;
    }
  | { type: "close"; boardKey?: string };

export const TIME_OPTIONS_SECONDS = [
  60,
  3 * 60,
  5 * 60,
  10 * 60,
  15 * 60,
] as const;

export const INCREMENT_OPTIONS_SECONDS = [0, 1, 2, 3, 5, 10] as const;

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function formatClock(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function winnerLabel(side: Side) {
  return side === "w" ? "White" : "Black";
}

export const PARTYKIT_HOST =
  process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export function squareCenter(
  square: Square,
  origin: THREE.Vector3,
  squareSize: number
): THREE.Vector3 {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const x = (file - 3.5) * squareSize;
  const z = (4.5 - rank) * squareSize;
  return new THREE.Vector3(origin.x + x, origin.y, origin.z + z);
}

export function isSquare(val: string): val is Square {
  if (val.length !== 2) return false;
  const f = val.charCodeAt(0);
  const r = val.charCodeAt(1);
  return f >= 97 && f <= 104 && r >= 49 && r <= 56;
}

export function piecePath(type: string) {
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
  float n = fbmWood(wp);
  wp += n * 0.5;

  float ring = sin(wp.x * 10.0 + wp.y * 2.0);
  ring = smoothstep(-0.4, 0.4, ring);

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
  diffuseColor.rgb *= mix(0.7, 1.3, cFactor);`
      );
  };

  material.needsUpdate = true;
}

function stripMaterialTextures(material: any) {
  const keys = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "aoMap",
    "emissiveMap",
    "alphaMap",
    "bumpMap",
    "displacementMap",
    "lightMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "sheenColorMap",
    "specularColorMap",
  ];
  for (const k of keys) {
    if (k in material) material[k] = null;
  }
}

export function applyChessThemeToMaterial(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts: {
    chessTheme?: string;
    tint: THREE.Color;
    side?: Side;
  }
) {
  const chessTheme = opts.chessTheme;
  const tint = opts.tint;
  const side = opts.side;

  // Ensure we don't inherit baked textures from GLBs.
  stripMaterialTextures(material as any);

  // Keep behavior in sync with PieceModel().
  if (chessTheme === "chess_glass") {
    const isWhite = side === "w";
    const base = isWhite
      ? new THREE.Color("#f7fbff")
      : new THREE.Color("#0f141b");
    const rim = isWhite
      ? new THREE.Color("#ffffff")
      : new THREE.Color("#e9f2ff");

    material.color.copy(base);
    (material as any).metalness = 0.0;
    (material as any).roughness = isWhite ? 0.92 : 0.03;
    material.transparent = true;
    material.opacity = isWhite ? 0.86 : 0.42;
    material.depthWrite = isWhite;
    (material as any).premultipliedAlpha = true;
    material.emissive = rim.clone();
    material.emissiveIntensity = isWhite ? 0.02 : 0.04;
    (material as any).envMapIntensity = isWhite ? 0.8 : 1.6;

    if (isWhite) {
      applyMilkGlassShader(material, {
        milkiness: 0.85,
        bottomTint: new THREE.Color("#eef4ff"),
      });
      applyFresnelRim(material, rim, 2.2, 0.25);
    } else {
      applyClearGlassShader(material, {
        scale: 1.0,
        absorbStrength: 0.7,
        bottomTint: new THREE.Color("#050607"),
      });
      applyFresnelRim(material, rim, 2.8, 0.22);
    }
  } else if (chessTheme === "chess_gold") {
    const isWhite = side === "w";
    const base = isWhite
      ? new THREE.Color("#d8dee6")
      : new THREE.Color("#ffd15a");
    const rim = isWhite
      ? new THREE.Color("#ffffff")
      : new THREE.Color("#fff0c2");

    material.color.copy(base);
    (material as any).metalness = isWhite ? 0.72 : 0.9;
    (material as any).roughness = isWhite ? 0.34 : 0.2;
    material.emissive = rim.clone();
    material.emissiveIntensity = isWhite ? 0.05 : 0.09;
    (material as any).envMapIntensity = isWhite ? 1.1 : 1.25;
    applyHammeredMetalShader(material, {
      strength: isWhite ? 0.15 : 0.2,
      scale: 14.0,
    });
    applyFresnelRim(material, rim, 2.8, isWhite ? 0.24 : 0.28);
  } else if (chessTheme === "chess_wood") {
    material.color.copy(tint);
    (material as any).metalness = 0.05;
    (material as any).roughness = 0.85;
    (material as any).envMapIntensity = 0.35;
    material.emissive = tint.clone().multiplyScalar(0.02);
    material.emissiveIntensity = 0.25;
    setTimeout(() => {
      applyWoodGrainShader(material, { scale: 11.5, intensity: 0.55 });
    }, 100);
  } else if (chessTheme === "chess_marble") {
    const isWhite = side === "w";
    const darkBase = isWhite
      ? new THREE.Color("#e8e8e8")
      : new THREE.Color("#5e5e5e");
    const lightBase = isWhite
      ? new THREE.Color("#6a6560")
      : new THREE.Color("#c0c0c0");

    material.color.copy(darkBase);
    (material as any).metalness = 0.12;
    (material as any).roughness = 0.25;
    (material as any).envMapIntensity = 0.85;

    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader: any, renderer: any) => {
      try {
        (prev as any).call(material as any, shader, renderer);
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

  vec3 baseColor = uDarkBase * (0.85 + noise * 0.3);
  vec3 crackColor = uIsWhite > 0.5 ? vec3(0.2, 0.2, 0.25) : vec3(0.9, 0.9, 0.95);

  diffuseColor.rgb = mix(baseColor, crackColor, crackLine * 0.65);
  `
        );
    };
    setTimeout(() => {
      material.needsUpdate = true;
    }, 150);
  } else {
    material.color.copy(tint);
    (material as any).metalness = 0.6;
    (material as any).roughness = 0.4;
    material.emissive = tint.clone().multiplyScalar(0.05);
    material.emissiveIntensity = 0.5;
  }

  material.needsUpdate = true;
}

export function PieceModel({
  path,
  tint,
  chessTheme,
  side,
}: {
  path: string;
  tint: THREE.Color;
  chessTheme?: string;
  side?: Side;
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

      // Defer shader-heavy themes to avoid WebGL context loss on initial load
      if (chessTheme === "chess_glass") {
        const isWhite = side === "w";
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
          clonedMat.emissiveIntensity = isWhite ? 0.05 : 0.09;
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
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.05;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.85;
        if (typeof clonedMat.envMapIntensity === "number")
          clonedMat.envMapIntensity = 0.35;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(tint.clone().multiplyScalar(0.02));
          clonedMat.emissiveIntensity = 0.25;
        }
        // Defer heavy wood grain shader to avoid context loss
        setTimeout(() => {
          applyWoodGrainShader(clonedMat, { scale: 11.5, intensity: 0.55 });
        }, 100);
      } else if (chessTheme === "chess_marble") {
        const isWhite = side === "w";
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

  vec3 baseColor = uDarkBase * (0.85 + noise * 0.3);
  vec3 crackColor = uIsWhite > 0.5 ? vec3(0.2, 0.2, 0.25) : vec3(0.9, 0.9, 0.95);

  diffuseColor.rgb = mix(baseColor, crackColor, crackLine * 0.65);
  `
            );
        };
        // Defer heavy marble shader compilation
        setTimeout(() => {
          clonedMat.needsUpdate = true;
        }, 150);
      } else {
        if (clonedMat.color && clonedMat.color.isColor)
          clonedMat.color.copy(tint);
        if (typeof clonedMat.metalness === "number") clonedMat.metalness = 0.6;
        if (typeof clonedMat.roughness === "number") clonedMat.roughness = 0.4;
        if (clonedMat.emissive && clonedMat.emissive.isColor) {
          clonedMat.emissive = clonedMat.emissive.clone();
          clonedMat.emissive.copy(tint.clone().multiplyScalar(0.05));
          clonedMat.emissiveIntensity = 0.5;
        }
      }
    });

    root.rotation.set(Math.PI / 2, 0, 0);
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.min.y) &&
      Number.isFinite(box.min.z)
    ) {
      const center = box.getCenter(new THREE.Vector3());
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
  return t * t * (3 - 2 * t);
}

export function AnimatedPiece({
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
  isStartled,
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
  isStartled?: boolean;
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
        if (e.button !== 0) return; // Left click only
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

export type ChessSounds = {
  move: () => void;
  capture: () => void;
  select: () => void;
  warning: () => void;
  click: () => void;
  honk: () => void;
};

export type UseChessGameOptions = {
  enabled?: boolean;
  variant?: "standard" | "goose";
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  onActivityMove?: () => void;
  joinLockedBoardKey?: string | null;
  leaveAllNonce?: number;
  leaveAllExceptBoardKey?: string | null;
  onJoinIntent?: (boardKey: string) => void;
  onSelfSeatChange?: (boardKey: string, isSeated: boolean) => void;
  onRequestMove?: (
    dest: Vec3,
    opts?: { rotY?: number; sit?: boolean; sitDest?: Vec3; lookAtTarget?: Vec3 }
  ) => void;
  onCenterCamera?: (target: Vec3) => void;
  onBoardControls?: (event: BoardControlsEvent) => void;
  controlsOpen?: boolean;
  board2dOpen?: boolean;
  chessTheme?: string;
  lobby?: LobbyKind;
  sounds?: Partial<ChessSounds>;
  connectRadius?: number;
};

export type UseChessGameResult = {
  originVec: THREE.Vector3;
  squareSize: number;
  boardSize: number;
  netState: ChessNetState;
  chessSelfId: string;
  turn: Side;
  gooseSquare: Square | null;
  goosePhase: "piece" | "goose" | null;
  startledSquares: Square[];
  mySides: Set<Side>;
  myPrimarySide: Side | null;
  isSeated: boolean;
  drawOfferFrom: Side | null;
  rematch: { w: boolean; b: boolean };
  selected: Square | null;
  legalTargets: Square[];
  hoveredSquare: Square | null;
  setHoveredSquare: (square: Square | null) => void;
  pulseGoosePlacementUntilMs: number;
  lastMove: ChessNetState["lastMove"];
  pieces: Array<{ square: Square; type: string; color: Side }>;
  animatedFromByTo: Map<Square, Square>;
  pendingJoinSide: Side | null;
  clocks: {
    remaining: ClockState["remainingMs"];
    active: Side | null;
    baseMs: number;
    running: boolean;
  };
  timeIndex: number;
  canConfigure: boolean;
  boardOrientation: "white" | "black";
  canMove2d: boolean;
  onPickSquare: (square: Square) => void;
  onPickPiece: (square: Square) => void;
  clickJoin: (side: Side) => void;
  devModeEnabled: boolean;
  devJoinLog: string[];
  setTimeControlByIndex: (idx: number) => void;
  clickReset: () => void;
  requestSitAt: (seatX: number, seatZ: number) => void;
  centerCamera: () => void;
  emitControlsOpen: () => void;
  resultLabel: string | null;
  gooseBlocked: { gooseSquare: Square; pieceSquare: Square; at: number } | null;
};

export function useChessGame({
  enabled = true,
  variant = "standard",
  roomId,
  boardKey,
  origin,
  selfPositionRef,
  selfId,
  selfName,
  onActivityMove,
  joinLockedBoardKey,
  leaveAllNonce,
  leaveAllExceptBoardKey,
  onJoinIntent,
  onSelfSeatChange,
  onRequestMove,
  onCenterCamera,
  onBoardControls,
  controlsOpen,
  board2dOpen,
  chessTheme,
  lobby = "park",
  sounds,
  connectRadius = 12,
}: UseChessGameOptions): UseChessGameResult {
  const originVec = useMemo(
    () => new THREE.Vector3(origin[0], origin[1], origin[2]),
    [origin]
  );
  const squareSize = 0.6;
  const boardSize = squareSize * 8;

  const socketRef = useRef<PartySocket | null>(null);
  const [chessSelfId, setChessSelfId] = useState<string>("");
  // Start the PartyKit connection flow as early as possible when enabled.
  // (Avoid a one-frame window where a user can click Join before we've even
  // scheduled the initial websocket handshake.)
  const [chessConnected, setChessConnected] = useState<boolean>(() => enabled);
  const chessConnectedRef = useRef<boolean>(enabled);
  const pendingJoinRef = useRef<Side | null>(null);
  const [pendingJoinSide, setPendingJoinSide] = useState<Side | null>(null);

  const [devModeEnabled, setDevModeEnabled] = useState(false);
  const [devJoinLog, setDevJoinLog] = useState<string[]>([]);

  useEffect(() => {
    const handle = () => setDevModeEnabled(readRuntimeDevModeFlag());
    handle();

    window.addEventListener("pawnsquare-dev-mode-changed", handle);
    window.addEventListener("storage", handle);
    return () => {
      window.removeEventListener("pawnsquare-dev-mode-changed", handle);
      window.removeEventListener("storage", handle);
    };
  }, []);

  const pushDevJoinLog = useCallback(
    (message: string, data?: any) => {
      if (!devModeEnabled) return;
      const time = new Date().toLocaleTimeString();
      const line =
        data === undefined
          ? `${time} ${message}`
          : `${time} ${message} ${safeJson(data)}`;
      setDevJoinLog((prev) => {
        const next = [...prev, line];
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });
      try {
        if (data !== undefined) console.log("[DevJoin]", message, data);
        else console.log("[DevJoin]", message);
      } catch {
        // ignore
      }
    },
    [devModeEnabled]
  );

  const sleepMs = useCallback((ms: number) => {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }, []);

  const joinOpTokenRef = useRef(0);

  const activeModeRef = useRef(true);
  useEffect(() => {
    activeModeRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    chessConnectedRef.current = chessConnected;
  }, [chessConnected]);

  // Ensure we connect promptly whenever enabled flips on.
  useEffect(() => {
    if (!enabled) return;
    if (!chessConnectedRef.current) {
      chessConnectedRef.current = true;
      setChessConnected(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const initialFen = useMemo(() => new Chess().fen(), []);
  const defaultClock = useMemo<ClockState>(() => {
    const baseMs = 5 * 60 * 1000;
    return {
      baseMs,
      incrementMs: 0,
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
    drawOfferFrom: null,
    rematch: { w: false, b: false },
    gooseSquare: variant === "goose" ? ("d5" as Square) : undefined,
    phase: variant === "goose" ? "piece" : undefined,
    activeSide: variant === "goose" ? "w" : undefined,
  });

  useEffect(() => {
    setNetState({
      seats: { w: null, b: null },
      fen: initialFen,
      seq: 0,
      clock: defaultClock,
      result: null,
      lastMove: null,
      drawOfferFrom: null,
      rematch: { w: false, b: false },
      gooseSquare: variant === "goose" ? ("d5" as Square) : undefined,
      phase: variant === "goose" ? "piece" : undefined,
      activeSide: variant === "goose" ? "w" : undefined,
    });
  }, [variant, initialFen, defaultClock]);

  const mySides = useMemo(() => {
    const sides = new Set<Side>();
    if (netState.seats.w?.connId === chessSelfId) sides.add("w");
    if (netState.seats.b?.connId === chessSelfId) sides.add("b");
    return sides;
  }, [netState.seats.w, netState.seats.b, chessSelfId]);

  const isSeated = mySides.size > 0;
  const seatOccupied = (seat: SeatInfo | null | undefined) =>
    !!seat?.connId && !!seat?.playerId;
  const bothSeatsOccupied =
    seatOccupied(netState.seats.w) && seatOccupied(netState.seats.b);
  const canUseControlTV = isSeated || !bothSeatsOccupied;
  const myPrimarySide: Side | null = mySides.has("w")
    ? "w"
    : mySides.has("b")
    ? "b"
    : null;

  useEffect(() => {
    if (enabled) return;

    // Ensure we fully disconnect from the PartyKit room when switching modes.
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }

    pendingJoinRef.current = null;
    setPendingJoinSide(null);
    setSelected(null);
    setLegalTargets([]);
    setChessConnected(false);
    chessConnectedRef.current = false;
    setChessSelfId("");
  }, [enabled]);

  const chess = useMemo(() => new Chess(netState.fen), [netState.fen]);

  const gooseSquare: Square | null =
    variant === "goose" ? netState.gooseSquare ?? ("d5" as Square) : null;
  const goosePhase: "piece" | "goose" | null =
    variant === "goose" ? netState.phase ?? "piece" : null;
  const activeSide: Side =
    variant === "goose"
      ? netState.activeSide ?? (chess.turn() as Side)
      : (chess.turn() as Side);

  const lastMove = netState.lastMove;

  const startledSquares: Square[] = useMemo(() => {
    if (variant !== "goose") return [];
    // Avoid showing startled indicators before any move is played.
    if (!lastMove) return [];
    // Avoid showing startled indicators during goose placement.
    if (goosePhase === "goose") return [];
    if (!gooseSquare) return [];
    return adjacentSquares(gooseSquare);
  }, [variant, gooseSquare, lastMove, goosePhase]);

  const turn = activeSide;

  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [hoveredSquare, setHoveredSquare] = useState<Square | null>(null);
  const [pulseGoosePlacementUntilMs, setPulseGoosePlacementUntilMs] =
    useState(0);
  const [gooseBlocked, setGooseBlocked] = useState<{
    gooseSquare: Square;
    pieceSquare: Square;
    at: number;
  } | null>(null);

  const { move, capture, select, warning, click, honk } = sounds ?? {};

  const prevFenForSound = useRef(initialFen);
  const lastSoundSeq = useRef(0);
  const hasWarnedRef = useRef(false);
  const prevGoosePhaseRef = useRef<"piece" | "goose" | null>(null);

  // Pulse placement squares when entering goose phase
  useEffect(() => {
    if (variant !== "goose") return;
    if (goosePhase === "goose" && prevGoosePhaseRef.current !== "goose") {
      setPulseGoosePlacementUntilMs(Date.now() + 1400);
    }
    prevGoosePhaseRef.current = goosePhase;
  }, [variant, goosePhase]);

  useEffect(() => {
    if (!enabled) return;
    if (!isSeated) return;
    if (netState.seq <= lastSoundSeq.current) return;
    lastSoundSeq.current = netState.seq;

    if (netState.lastMove) {
      try {
        const tempChess = new Chess(prevFenForSound.current);
        const moveResult = tempChess.move({
          from: netState.lastMove.from,
          to: netState.lastMove.to,
          promotion: "q",
        });
        if (moveResult && moveResult.captured) {
          capture?.();
        } else {
          move?.();
        }
      } catch {
        move?.();
      }
    }

    prevFenForSound.current = netState.fen;
    hasWarnedRef.current = false;
  }, [
    enabled,
    isSeated,
    netState.seq,
    netState.fen,
    netState.lastMove,
    move,
    capture,
  ]);

  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    if (!netState.clock.running) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [enabled, netState.clock.running]);

  useEffect(() => {
    if (!enabled) return;
    if (!isSeated) return;
    if (!netState.clock.running) return;
    const c = netState.clock;
    if (!mySides.has(c.active)) return;

    const now = clockNow;
    const remaining = c.remainingMs[c.active];
    const elapsed = c.lastTickMs ? Math.max(0, now - c.lastTickMs) : 0;
    const currentRemaining = Math.max(0, remaining - elapsed);

    if (
      currentRemaining < 30000 &&
      currentRemaining > 0 &&
      !hasWarnedRef.current
    ) {
      warning?.();
      hasWarnedRef.current = true;
    }
  }, [enabled, isSeated, mySides, clockNow, netState.clock, warning]);

  const send = (msg: ChessSendMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    if (!enabled) {
      onSelfSeatChange?.(boardKey, false);
      setPendingJoinSide(null);
      return;
    }
    onSelfSeatChange?.(boardKey, isSeated);
    if (isSeated) setPendingJoinSide(null);
  }, [enabled, boardKey, isSeated, onSelfSeatChange]);

  useEffect(() => {
    if (!enabled) return;
    if (!leaveAllNonce) return;
    if (leaveAllExceptBoardKey && leaveAllExceptBoardKey === boardKey) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN)
      return;

    if (netState.seats.w?.connId === chessSelfId)
      send({ type: "leave", side: "w" });
    if (netState.seats.b?.connId === chessSelfId)
      send({ type: "leave", side: "b" });
  }, [
    enabled,
    leaveAllNonce,
    leaveAllExceptBoardKey,
    boardKey,
    chessSelfId,
    netState.seats.w,
    netState.seats.b,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!chessConnected) return;

    const party = variant === "goose" ? "goose" : "chess";
    const roomSuffix = variant === "goose" ? "goose" : "chess";

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      party,
      room: `${roomId}-${roomSuffix}-${boardKey}`,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (!activeModeRef.current) return;
      setChessSelfId(socket.id);
      const pendingSide = pendingJoinRef.current;
      if (pendingSide) {
        pendingJoinRef.current = null;
        send({ type: "join", side: pendingSide });
      }
    });

    socket.addEventListener("message", (event) => {
      if (!activeModeRef.current) return;
      try {
        const msg = JSON.parse(event.data) as ChessMessage;

        if (msg.type === "seats") {
          setNetState((prev) => {
            if (msg.seq <= prev.seq) return prev;

            const prevW = prev.seats.w;
            const prevB = prev.seats.b;
            const nextW = msg.seats.w;
            const nextB = msg.seats.b;
            const sameW =
              (prevW === null && nextW === null) ||
              (prevW !== null &&
                nextW !== null &&
                prevW.connId === nextW.connId &&
                prevW.playerId === nextW.playerId &&
                prevW.name === nextW.name);
            const sameB =
              (prevB === null && nextB === null) ||
              (prevB !== null &&
                nextB !== null &&
                prevB.connId === nextB.connId &&
                prevB.playerId === nextB.playerId &&
                prevB.name === nextB.name);
            if (sameW && sameB) return prev;

            return { ...prev, seats: msg.seats, seq: msg.seq };
          });
          return;
        }

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
      // no-op
    });

    return () => {
      socket.close();
    };
  }, [enabled, chessConnected, variant, roomId, boardKey]);

  const lastSeenSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (netState.seq === lastSeenSeqRef.current) return;
    lastSeenSeqRef.current = netState.seq;
    setSelected(null);
    setLegalTargets([]);
  }, [netState.seq]);

  const pendingMoveRef = useRef(false);
  const pendingMoveSentSeqRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pendingMoveRef.current) return;
    const sentSeq = pendingMoveSentSeqRef.current;
    if (sentSeq === null) return;
    if (netState.seq <= sentSeq) return;

    pendingMoveRef.current = false;
    pendingMoveSentSeqRef.current = null;
    onActivityMove?.();
  }, [netState.seq, onActivityMove]);

  const requestJoin = (side: Side) => {
    const seat = netState.seats[side];
    if (seat && seat.connId !== chessSelfId) {
      if (devModeEnabled)
        pushDevJoinLog("requestJoin blocked: seat already taken", {
          side,
          seat,
          chessSelfId,
        });
      return;
    }
    if (devModeEnabled)
      pushDevJoinLog("send join", {
        side,
        playerId: selfId,
        name: selfName,
      });
    send({ type: "join", side, playerId: selfId, name: selfName });
  };

  const requestLeave = (side: Side) => {
    if (devModeEnabled) pushDevJoinLog("send leave", { side });
    send({ type: "leave", side });
  };

  const submitMove = (
    from: Square,
    to: Square,
    promotion?: "q" | "r" | "b" | "n"
  ) => {
    if (!isSeated) return;
    if (netState.result) return;
    if (!mySides.has(turn)) return;
    if (variant === "goose" && goosePhase !== "piece") return;

    pendingMoveRef.current = true;
    pendingMoveSentSeqRef.current = netState.seq;
    send({ type: "move", from, to, promotion });
  };

  const submitGoose = (square: Square) => {
    if (variant !== "goose") return;
    if (!isSeated) return;
    if (netState.result) return;
    if (goosePhase !== "goose") return;
    if (!mySides.has(turn)) return;

    const tmp = new Chess(netState.fen);
    if (tmp.get(square)) return;

    const moveNumber = parseFenMoveNumber(netState.fen);
    if (moveNumber > 20 && isCenter4(square)) return;

    click?.();
    send({ type: "goose", square });
    setSelected(null);
    setLegalTargets([]);
  };

  const onPickSquare = (square: Square) => {
    if (!enabled) return;
    if (netState.result) return;

    setGooseBlocked(null);

    if (variant === "goose" && goosePhase === "goose") {
      submitGoose(square);
      return;
    }

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

    if (variant === "goose" && selected && !legalTargets.includes(square)) {
      const piece = chess.get(selected);
      if (piece && piece.color === turn) {
        const standardMoves = (
          chess.moves({ square: selected, verbose: true }) as any[]
        )
          .map((m) => m.to)
          .filter(isSquare);

        if (standardMoves.includes(square)) {
          honk?.();
          if (gooseSquare) {
            setGooseBlocked({
              gooseSquare,
              pieceSquare: selected,
              at: Date.now(),
            });
          }
          return;
        }
      }
    }

    const piece = chess.get(square);

    if (piece && mySides.has(turn) && piece.color === turn) {
      select?.();
      setSelected(square);
      const targets =
        variant === "goose"
          ? gooseLegalMovesForSquare(chess, square, gooseSquare).map(
              (m) => m.to
            )
          : (chess.moves({ square, verbose: true }) as any[])
              .map((m) => m.to)
              .filter(isSquare);
      setLegalTargets(targets);
      return;
    }

    setSelected(null);
    setLegalTargets([]);
  };

  const onPickPiece = (square: Square) => {
    onPickSquare(square);
  };

  useFrame(() => {
    if (!enabled) return;
    const pos = selfPositionRef.current;
    if (!pos) return;

    if (!chessConnectedRef.current) {
      const dx = pos.x - originVec.x;
      const dz = pos.z - originVec.z;
      const near = dx * dx + dz * dz < connectRadius * connectRadius;
      if (near) {
        chessConnectedRef.current = true;
        setChessConnected(true);
      }
      return;
    }
  });

  const pieces = useMemo(() => {
    const out: Array<{ square: Square; type: string; color: Side }> = [];
    const board = chess.board();

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
    // Don't animate during goose placement phase
    if (!lastMove || (variant === "goose" && goosePhase === "goose"))
      return map;

    map.set(lastMove.to, lastMove.from);

    if (lastMove.from === "e1" && lastMove.to === "g1") map.set("f1", "h1");
    if (lastMove.from === "e1" && lastMove.to === "c1") map.set("d1", "a1");
    if (lastMove.from === "e8" && lastMove.to === "g8") map.set("f8", "h8");
    if (lastMove.from === "e8" && lastMove.to === "c8") map.set("d8", "a8");

    return map;
  }, [lastMove, variant, goosePhase]);

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

    onJoinIntent?.(boardKey);
    setPendingJoinSide(side);

    joinOpTokenRef.current += 1;
    const token = joinOpTokenRef.current;

    if (devModeEnabled) {
      setDevJoinLog([]);
      pushDevJoinLog("clickJoin", { boardKey, side, lobby, variant });
    }

    if (joinScheduleRef.current) {
      window.clearTimeout(joinScheduleRef.current);
      joinScheduleRef.current = null;
    }

    const DEV_DELAY_BEFORE_ACTION_MS = 120;
    const DEV_DELAY_BETWEEN_STEPS_MS = 160;
    const delayBefore = devModeEnabled ? DEV_DELAY_BEFORE_ACTION_MS : 0;

    joinScheduleRef.current = window.setTimeout(() => {
      joinScheduleRef.current = null;

      const run = async () => {
        if (token !== joinOpTokenRef.current) return;

        click?.();
        if (devModeEnabled) pushDevJoinLog("played click sound");

        if (devModeEnabled) {
          await sleepMs(DEV_DELAY_BETWEEN_STEPS_MS);
          if (token !== joinOpTokenRef.current) return;
        }

        if (!chessConnectedRef.current) {
          if (devModeEnabled)
            pushDevJoinLog("not connected: queue join and force-connect");
          pendingJoinRef.current = side;
          chessConnectedRef.current = true;
          setChessConnected(true);
          return;
        }

        if (devModeEnabled) {
          await sleepMs(DEV_DELAY_BETWEEN_STEPS_MS);
          if (token !== joinOpTokenRef.current) return;
        }

        if (
          !socketRef.current ||
          socketRef.current.readyState !== WebSocket.OPEN
        ) {
          if (devModeEnabled)
            pushDevJoinLog("socket not open: queue join until WS opens", {
              readyState: socketRef.current?.readyState ?? null,
            });
          pendingJoinRef.current = side;
          return;
        }

        if (devModeEnabled) {
          await sleepMs(DEV_DELAY_BETWEEN_STEPS_MS);
          if (token !== joinOpTokenRef.current) return;
        }

        if (mySides.has(side)) {
          if (devModeEnabled)
            pushDevJoinLog("already seated on side: leaving", { side });
          requestLeave(side);
          setPendingJoinSide(null);
          return;
        }

        if (devModeEnabled)
          pushDevJoinLog("request join", {
            side,
            seats: netState.seats,
            chessSelfId,
          });
        requestJoin(side);
      };

      void run();
    }, delayBefore);
  };

  const requestSitAt = (seatX: number, seatZ: number) => {
    if (!onRequestMove) return;
    const dx = originVec.x - seatX;
    const dz = originVec.z - seatZ;
    const face = Math.atan2(dx, dz);

    const len = Math.sqrt(dx * dx + dz * dz) || 1;
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

  const centerCamera = () => {
    onCenterCamera?.([originVec.x, originVec.y, originVec.z]);
  };

  const prevIsSeatedRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      prevIsSeatedRef.current = false;
      return;
    }

    const wasSeated = prevIsSeatedRef.current;
    prevIsSeatedRef.current = isSeated;

    // When a player "starts" (first becomes seated), auto-center on the board.
    if (isSeated && !wasSeated) {
      onCenterCamera?.([originVec.x, originVec.y, originVec.z]);
    }
  }, [enabled, isSeated, onCenterCamera, originVec]);

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
      incrementMs: c.incrementMs,
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

  const incrementIndex = useMemo(() => {
    const incrementSeconds = Math.round(clocks.incrementMs / 1000);
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    INCREMENT_OPTIONS_SECONDS.forEach((s, idx) => {
      const d = Math.abs(s - incrementSeconds);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }, [clocks.incrementMs]);

  const canConfigure =
    !netState.clock.running &&
    !netState.result &&
    netState.fen === initialFen &&
    (isSeated || !bothSeatsOccupied);

  const boardOrientation: "white" | "black" =
    myPrimarySide === "b" ? "black" : "white";
  const canMove2d =
    isSeated &&
    !netState.result &&
    mySides.has(turn) &&
    (variant !== "goose" || goosePhase === "piece");

  const drawOfferFrom: Side | null =
    (netState.drawOfferFrom as Side | null | undefined) ?? null;
  const rematch = netState.rematch ?? { w: false, b: false };

  const canResign = isSeated && !netState.result;
  const canOfferDraw = isSeated && !netState.result && !drawOfferFrom;
  const canCancelDraw =
    isSeated &&
    !netState.result &&
    !!drawOfferFrom &&
    !!myPrimarySide &&
    drawOfferFrom === myPrimarySide;
  const canAcceptDraw =
    isSeated &&
    !netState.result &&
    !!drawOfferFrom &&
    !!myPrimarySide &&
    drawOfferFrom !== myPrimarySide;
  const canDeclineDraw = canAcceptDraw;

  const canRequestRematch =
    isSeated &&
    !!netState.result &&
    bothSeatsOccupied &&
    !!myPrimarySide &&
    rematch[myPrimarySide] !== true;

  const otherPrimarySide: Side | null = myPrimarySide
    ? myPrimarySide === "w"
      ? "b"
      : "w"
    : null;
  const canDeclineRematch =
    isSeated &&
    !!netState.result &&
    bothSeatsOccupied &&
    !!myPrimarySide &&
    !!otherPrimarySide &&
    rematch[otherPrimarySide] === true &&
    rematch[myPrimarySide] !== true;
  const canCancelRematch =
    isSeated &&
    !!netState.result &&
    bothSeatsOccupied &&
    !!myPrimarySide &&
    rematch[myPrimarySide] === true;

  const canPlaceGoose =
    variant === "goose" &&
    isSeated &&
    !netState.result &&
    mySides.has(turn) &&
    goosePhase === "goose";

  const tryMove2d = (
    from: string,
    to: string,
    promotion?: "q" | "r" | "b" | "n"
  ) => {
    if (!isSeated) return false;
    if (netState.result) return false;
    if (!mySides.has(turn)) return false;
    if (variant === "goose" && goosePhase !== "piece") return false;

    const source = from as Square;
    const target = to as Square;
    const tmp = new Chess(netState.fen);
    const piece = tmp.get(source);
    if (!piece) return false;
    if (piece.color !== turn) return false;

    let promo = promotion;
    if (piece.type === "p") {
      const rank = String(target[1] ?? "");
      if ((rank === "1" || rank === "8") && !promo) promo = "q";
    }

    if (variant === "goose") {
      const legal = gooseLegalMovesForSquare(tmp, source, gooseSquare);
      const match = legal.find(
        (m) => m.to === target && (m.promotion ?? undefined) === (promo as any)
      );
      if (!match) return false;
    } else {
      const mv = tmp.move({ from: source, to: target, promotion: promo });
      if (!mv) return false;
    }

    click?.();
    send({ type: "move", from: source, to: target, promotion: promo });
    setSelected(null);
    setLegalTargets([]);
    return true;
  };

  const tryPlaceGoose2d = (square: string) => {
    if (!canPlaceGoose) return false;
    const sq = square as Square;

    const tmp = new Chess(netState.fen);
    if (tmp.get(sq)) return false;

    const moveNumber = parseFenMoveNumber(netState.fen);
    if (moveNumber > 20 && isCenter4(sq)) return false;

    click?.();
    send({ type: "goose", square: sq });
    setSelected(null);
    setLegalTargets([]);
    return true;
  };

  const emitControlsOpen = () => {
    if (!enabled) {
      console.log("[Chess emitControlsOpen] BLOCKED: enabled is false");
      return;
    }
    if (!canUseControlTV) {
      console.log(
        "[Chess emitControlsOpen] BLOCKED: canUseControlTV is false",
        {
          canUseControlTV,
          isSeated,
          bothSeatsOccupied,
          seats: { w: netState.seats.w, b: netState.seats.b },
        }
      );
      return;
    }
    console.log("[Chess emitControlsOpen] ALLOWED: calling onBoardControls", {
      enabled,
      canUseControlTV,
      isSeated,
      bothSeatsOccupied,
      hasCallback: !!onBoardControls,
    });
    onBoardControls?.({
      type: "open",
      boardKey,
      lobby,
      timeMinutes: Math.round(clocks.baseMs / 60000),
      incrementSeconds: Math.round(clocks.incrementMs / 1000),
      fen: netState.fen,
      mySide: myPrimarySide,
      turn,
      boardOrientation,
      canMove2d,
      clockRemainingMs: clocks.remaining,
      clockRunning: clocks.running,
      clockActive: clocks.active,
      clockSnapshotAtMs: Date.now(),
      resultLabel,
      drawOfferFrom,
      rematch,
      canResign,
      canOfferDraw,
      canAcceptDraw,
      canDeclineDraw,
      canCancelDraw,
      canRequestRematch,
      canDeclineRematch,
      canCancelRematch,
      onResign: resign,
      onOfferDraw: offerDraw,
      onAcceptDraw: acceptDraw,
      onDeclineDraw: declineDraw,
      onCancelDraw: cancelDraw,
      onRequestRematch: requestRematch,
      onDeclineRematch: declineRematch,
      onCancelRematch: cancelRematch,
      gooseSquare: gooseSquare ?? undefined,
      goosePhase: goosePhase ?? undefined,
      canPlaceGoose: canPlaceGoose || undefined,
      startledSquares: variant === "goose" ? startledSquares : undefined,
      canInc: canConfigure && timeIndex < TIME_OPTIONS_SECONDS.length - 1,
      canDec: canConfigure && timeIndex > 0,
      canIncIncrement:
        canConfigure && incrementIndex < INCREMENT_OPTIONS_SECONDS.length - 1,
      canDecIncrement: canConfigure && incrementIndex > 0,
      canReset: isSeated || !bothSeatsOccupied,
      canCenter: !!onCenterCamera,
      onMove2d: tryMove2d,
      onPlaceGoose: variant === "goose" ? tryPlaceGoose2d : undefined,
      onInc: () => setTimeControlByIndex(timeIndex + 1),
      onDec: () => setTimeControlByIndex(timeIndex - 1),
      onIncIncrement: () => setIncrementByIndex(incrementIndex + 1),
      onDecIncrement: () => setIncrementByIndex(incrementIndex - 1),
      onReset: clickReset,
      onCenter: centerCamera,
    });
  };

  const emit2dSync = () => {
    if (!enabled) return;
    onBoardControls?.({
      type: "sync2d",
      boardKey,
      lobby,
      fen: netState.fen,
      mySide: myPrimarySide,
      turn,
      boardOrientation,
      canMove2d,
      clockRemainingMs: clocks.remaining,
      clockRunning: clocks.running,
      clockActive: clocks.active,
      clockSnapshotAtMs: Date.now(),
      resultLabel,
      drawOfferFrom,
      rematch,
      gooseSquare: gooseSquare ?? undefined,
      goosePhase: goosePhase ?? undefined,
      canPlaceGoose: canPlaceGoose || undefined,
      startledSquares: variant === "goose" ? startledSquares : undefined,
      onMove2d: tryMove2d,
      onPlaceGoose: variant === "goose" ? tryPlaceGoose2d : undefined,
    });
  };

  const setTimeControlByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
    click?.();
    const idx = clamp(nextIdx, 0, TIME_OPTIONS_SECONDS.length - 1);
    const secs = TIME_OPTIONS_SECONDS[idx]!;
    const currentIncrementSecs = Math.round(clocks.incrementMs / 1000);
    send({
      type: "setTime",
      baseSeconds: secs,
      incrementSeconds: currentIncrementSecs,
    });
  };

  const setIncrementByIndex = (nextIdx: number) => {
    if (!canConfigure) return;
    click?.();
    const idx = clamp(nextIdx, 0, INCREMENT_OPTIONS_SECONDS.length - 1);
    const incSecs = INCREMENT_OPTIONS_SECONDS[idx]!;
    const currentBaseSecs = Math.round(clocks.baseMs / 1000);
    send({
      type: "setTime",
      baseSeconds: currentBaseSecs,
      incrementSeconds: incSecs,
    });
  };

  const clickReset = () => {
    // Allow reset if seated, OR as a spectator when at least one seat is empty.
    if (!isSeated && bothSeatsOccupied) return;
    click?.();
    send({ type: "reset" });
  };

  const resign = () => {
    if (!canResign) return;
    click?.();
    send({ type: "resign" });
  };

  const offerDraw = () => {
    if (!canOfferDraw) return;
    click?.();
    send({ type: "draw:offer" });
  };
  const acceptDraw = () => {
    if (!canAcceptDraw) return;
    click?.();
    send({ type: "draw:accept" });
  };
  const declineDraw = () => {
    if (!canDeclineDraw) return;
    click?.();
    send({ type: "draw:decline" });
  };
  const cancelDraw = () => {
    if (!canCancelDraw) return;
    click?.();
    send({ type: "draw:cancel" });
  };

  const requestRematch = () => {
    if (!canRequestRematch) return;
    click?.();
    send({ type: "rematch:request" });
  };
  const declineRematch = () => {
    if (!canDeclineRematch) return;
    click?.();
    send({ type: "rematch:decline" });
  };
  const cancelRematch = () => {
    if (!canCancelRematch) return;
    click?.();
    send({ type: "rematch:cancel" });
  };

  const resultLabel = useMemo(() => {
    const r = netState.result;
    if (!r) return null;
    if (r.type === "timeout") return `${winnerLabel(r.winner)} wins (time)`;
    if (r.type === "checkmate") return `${winnerLabel(r.winner)} wins (mate)`;
    if (r.type === "resign") return `${winnerLabel(r.winner)} wins (resign)`;
    return `Draw (${r.reason})`;
  }, [netState.result]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      onBoardControls?.({ type: "close", boardKey });
    };
  }, [enabled, onBoardControls, boardKey]);

  useEffect(() => {
    if (!enabled) return;
    if (!controlsOpen) return;
    if (!canUseControlTV) {
      onBoardControls?.({ type: "close", boardKey });
      return;
    }
    emitControlsOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    controlsOpen,
    canUseControlTV,
    canConfigure,
    timeIndex,
    incrementIndex,
    clocks.baseMs,
    clocks.incrementMs,
    myPrimarySide,
    netState.result,
    drawOfferFrom,
    rematch,
    onCenterCamera,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!board2dOpen) return;
    emit2dSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    board2dOpen,
    netState.fen,
    myPrimarySide,
    turn,
    netState.result,
    drawOfferFrom,
    rematch,
    canMove2d,
    isSeated,
  ]);

  return {
    originVec,
    squareSize,
    boardSize,
    netState,
    chessSelfId,
    turn,
    gooseSquare,
    goosePhase,
    startledSquares,
    mySides,
    myPrimarySide,
    isSeated,
    drawOfferFrom,
    rematch,
    selected,
    legalTargets,
    hoveredSquare,
    gooseBlocked,
    setHoveredSquare,
    pulseGoosePlacementUntilMs,
    lastMove,
    pieces,
    animatedFromByTo,
    pendingJoinSide,
    clocks,
    timeIndex,
    canConfigure,
    boardOrientation,
    canMove2d,
    onPickSquare,
    onPickPiece,
    clickJoin,
    devModeEnabled,
    devJoinLog,
    setTimeControlByIndex,
    clickReset,
    requestSitAt,
    centerCamera,
    emitControlsOpen,
    resultLabel,
  };
}

useGLTF.preload("/models/pawn.glb");
useGLTF.preload("/models/knight.glb");
useGLTF.preload("/models/bishop.glb");
useGLTF.preload("/models/rook.glb");
useGLTF.preload("/models/queen.glb");
useGLTF.preload("/models/king.glb");

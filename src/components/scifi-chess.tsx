"use client";

import { RoundedBox, Text, useGLTF, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { BoardMode, Vec3 } from "@/lib/partyRoom";
import { chessVariantForMode, engineForMode } from "@/lib/boardModes";
import {
  AnimatedPiece,
  FILES,
  formatClock,
  useChessGame,
  type Side,
  type Square,
  type BoardControlsEvent,
  applyChessThemeToMaterial,
} from "./chess-core";
import { useCheckersGame } from "./checkers-core";
import { useChessSounds } from "./chess-sounds";
import { parseFenMoveNumber } from "@/lib/gooseChess";

/**
 * Sci-Fi board implementation notes (unified game logic)
 *
 * This file should stay mostly a "skin" (materials/models/visuals).
 * Gameplay/networking should be selected via the shared mode registry:
 * - `engineForMode(mode)` decides which shared hook powers the board.
 * - `chessVariantForMode(mode)` selects the chess variant (standard/goose).
 *
 * Adding a new mode should generally NOT require touching this file unless:
 * - the mode introduces a brand new engine/hook, or
 * - you want sci-fi-specific visuals for that mode.
 */

const SQUARE_TOP_Y = 0.04;

function CoordinateLabels({
  originVec,
  squareSize,
  boardSize,
  showCoordinates,
  boardTheme,
}: {
  originVec: THREE.Vector3;
  squareSize: number;
  boardSize: number;
  showCoordinates: boolean;
  boardTheme?: string;
}) {
  if (!showCoordinates) return null;

  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const borderWidth = 0.35;
  const borderHeight = 0.12;
  const borderExtend = boardSize / 2 + borderWidth / 2;
  const borderY = originVec.y - 0.09;
  const textY = originVec.y + 0.02;
  const textOffset = 0.25;

  // Material props based on board theme
  const isMarble = boardTheme === "board_marble";
  const isNeon = boardTheme === "board_neon";
  const isWalnut = boardTheme === "board_walnut";
  const isClassic = !isMarble && !isNeon && !isWalnut;

  // Border colors based on theme
  const borderColor = isMarble
    ? "#2b2b33"
    : isNeon
    ? "#07101c"
    : isWalnut
    ? "#5a3a1a"
    : "#0d1b2a";

  return (
    <group>
      {/* Border frame with sci-fi styling */}
      {/* Bottom border */}
      <mesh
        position={[originVec.x, borderY, originVec.z + borderExtend]}
        receiveShadow
        castShadow
      >
        <boxGeometry
          args={[boardSize + borderWidth * 2, borderHeight, borderWidth]}
        />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <meshStandardMaterial
            color={borderColor}
            roughness={0.35}
            metalness={0.65}
            emissive="#021019"
            emissiveIntensity={0.35}
          />
        )}
      </mesh>

      {/* Top border */}
      <mesh
        position={[originVec.x, borderY, originVec.z - borderExtend]}
        receiveShadow
        castShadow
      >
        <boxGeometry
          args={[boardSize + borderWidth * 2, borderHeight, borderWidth]}
        />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <meshStandardMaterial
            color={borderColor}
            roughness={0.35}
            metalness={0.65}
            emissive="#021019"
            emissiveIntensity={0.35}
          />
        )}
      </mesh>

      {/* Left border */}
      <mesh
        position={[originVec.x - borderExtend, borderY, originVec.z]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[borderWidth, borderHeight, boardSize]} />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <meshStandardMaterial
            color={borderColor}
            roughness={0.35}
            metalness={0.65}
            emissive="#021019"
            emissiveIntensity={0.35}
          />
        )}
      </mesh>

      {/* Right border */}
      <mesh
        position={[originVec.x + borderExtend, borderY, originVec.z]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[borderWidth, borderHeight, boardSize]} />
        {isMarble ? (
          <MarbleTileMaterial color={borderColor} />
        ) : isNeon ? (
          <NeonTileMaterial color={borderColor} />
        ) : (
          <meshStandardMaterial
            color={borderColor}
            roughness={0.35}
            metalness={0.65}
            emissive="#021019"
            emissiveIntensity={0.35}
          />
        )}
      </mesh>

      {/* File labels (a-h) at bottom */}
      {files.map((file, idx) => {
        const x = (idx - 3.5) * squareSize;
        return (
          <Text
            key={`file-${file}`}
            position={[originVec.x + x, textY, originVec.z + borderExtend]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.18}
            color="#00d9ff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#000000"
          >
            {file}
          </Text>
        );
      })}

      {/* Rank labels (1-8) on left side */}
      {ranks.map((rank, idx) => {
        const z = (7 - idx - 3.5) * squareSize;
        return (
          <Text
            key={`rank-${rank}`}
            position={[originVec.x - borderExtend, textY, originVec.z + z]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.18}
            color="#00d9ff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#000000"
          >
            {rank}
          </Text>
        );
      })}
    </group>
  );
}

function HolographicPlacementText({
  originVec,
  boardSize,
  squareSize,
}: {
  originVec: THREE.Vector3;
  boardSize: number;
  squareSize: number;
}) {
  const textRef = useRef<any>(null);

  useFrame(() => {
    if (!textRef.current) return;
    const time = performance.now() * 0.001;
    // Gentle float animation
    textRef.current.position.y =
      originVec.y + 1.8 + Math.sin(time * 1.5) * 0.08;
    // Subtle pulse on opacity
    const opacity = 0.85 + Math.sin(time * 2) * 0.15;
    if (textRef.current.material) {
      textRef.current.material.opacity = opacity;
    }
  });

  return (
    <Text
      ref={textRef}
      position={[
        originVec.x,
        originVec.y + 1.8,
        originVec.z - boardSize / 2 - 0.8,
      ]}
      fontSize={0.28}
      color="#00d9ff"
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.015}
      outlineColor="#003d4d"
      font="/fonts/Orbitron-Bold.ttf"
    >
      PLACE GOOSE
      <meshBasicMaterial
        attach="material"
        color="#00d9ff"
        transparent
        opacity={0.85}
        toneMapped={false}
      />
    </Text>
  );
}

function GooseWarningText({
  position,
  startMs,
}: {
  position: [number, number, number];
  startMs: number;
}) {
  const textRef = useRef<any>(null);
  const [opacity, setOpacity] = useState(1);

  useFrame(() => {
    if (!textRef.current) return;
    const elapsed = performance.now() - startMs;
    const duration = 900;
    const t = Math.min(elapsed / duration, 1);
    const y = position[1] + 0.85 + t * 0.55;
    const op = 1 - t;
    textRef.current.position.set(position[0], y, position[2]);
    setOpacity(op);
  });

  return (
    <Text
      ref={textRef}
      position={[position[0], position[1] + 0.85, position[2]]}
      fontSize={0.34}
      color="#ff4444"
      anchorX="center"
      anchorY="middle"
      fillOpacity={opacity}
      renderOrder={10}
    >
      !
      <meshBasicMaterial
        attach="material"
        color="#ff4444"
        transparent
        opacity={opacity}
        depthTest={false}
        toneMapped={false}
      />
    </Text>
  );
}

function FloatingWarning({
  square,
  originVec,
  squareSize,
  startMs,
}: {
  square: Square;
  originVec: THREE.Vector3;
  squareSize: number;
  startMs: number;
}) {
  const textRef = useRef<any>(null);
  const [opacity, setOpacity] = useState(1);

  useFrame(() => {
    if (!textRef.current) return;
    const elapsed = performance.now() - startMs;
    const duration = 800;
    const t = Math.min(elapsed / duration, 1);

    // Float up and fade out
    const y = SQUARE_TOP_Y + 0.5 + t * 0.4;
    const op = 1 - t;

    textRef.current.position.y = y;
    setOpacity(op);
  });

  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const rankFromTop = 8 - rank;
  const x = (file - 3.5) * squareSize;
  const z = (rankFromTop - 3.5) * squareSize;

  return (
    <Text
      ref={textRef}
      position={[
        originVec.x + x,
        originVec.y + SQUARE_TOP_Y + 0.5,
        originVec.z + z,
      ]}
      fontSize={0.3}
      color="#ff4444"
      anchorX="center"
      anchorY="middle"
      fillOpacity={opacity}
    >
      !
    </Text>
  );
}

function PulsingIndicatorMaterial({
  color,
  baseOpacity,
  pulsingUntilMs,
}: {
  color: string;
  baseOpacity: number;
  pulsingUntilMs: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    const now = Date.now();
    if (pulsingUntilMs && now < pulsingUntilMs) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 90);
      mat.opacity = Math.min(0.95, baseOpacity + pulse * 0.35);
    } else {
      mat.opacity = baseOpacity;
    }
  });

  return (
    <meshBasicMaterial
      ref={matRef}
      color={color}
      transparent
      opacity={baseOpacity}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
    />
  );
}

function SlowPulsingIndicatorMaterial({
  color,
  baseOpacity,
  periodSeconds = 2.2,
}: {
  color: string;
  baseOpacity: number;
  periodSeconds?: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const mat = matRef.current;
    if (!mat) return;
    const t = clock.getElapsedTime();
    const phase = (t * 2 * Math.PI) / periodSeconds;
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    // Slow fade in/out around baseOpacity.
    mat.opacity = Math.min(
      0.95,
      Math.max(0.02, baseOpacity * (0.55 + 0.65 * pulse))
    );
  });

  return (
    <meshBasicMaterial
      ref={matRef}
      color={color}
      transparent
      opacity={baseOpacity}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
    />
  );
}

function FadeInAdditiveMaterial({
  color,
  baseOpacity,
  startMs,
  durationMs = 220,
  polygonOffsetFactor = -1,
  polygonOffsetUnits = -1,
}: {
  color: string;
  baseOpacity: number;
  startMs: number;
  durationMs?: number;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    if (!startMs) {
      mat.opacity = baseOpacity;
      return;
    }
    const t = Math.min(
      1,
      Math.max(0, (performance.now() - startMs) / durationMs)
    );
    mat.opacity = baseOpacity * t;
  });

  return (
    <meshBasicMaterial
      ref={matRef}
      color={color}
      transparent
      opacity={0}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={polygonOffsetFactor}
      polygonOffsetUnits={polygonOffsetUnits}
    />
  );
}

function CheckerPiece({
  position,
  tint,
  side,
  chessTheme,
  king,
  canMove,
  onPick,
}: {
  position: [number, number, number];
  tint: THREE.Color;
  side: Side;
  chessTheme?: string;
  king: boolean;
  canMove: boolean;
  onPick: () => void;
}) {
  const gltf = useGLTF("/models/checker.glb") as any;

  const modelHeight = useMemo(() => {
    const tmp = gltf.scene.clone(true);
    tmp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tmp);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Fallback in case the model has no geometry yet.
    return Number.isFinite(size.y) && size.y > 0 ? size.y : 1;
  }, [gltf.scene]);

  const model = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((obj: any) => {
      if (obj && obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;

        // Throw away GLB textures/materials and apply the exact chess theme shaders.
        const themed = new THREE.MeshStandardMaterial();
        applyChessThemeToMaterial(themed, { chessTheme, tint, side });
        obj.material = themed;
      }
    });
    return root;
  }, [gltf.scene, tint, chessTheme, side]);

  const scale = 2.2;
  const dy = 0.02;
  // Stack the second piece using the actual GLB height to avoid big gaps.
  const kingStackDy = modelHeight * scale * 0.9;

  return (
    <group
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerEnter={() => {
        if (canMove) document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        document.body.style.cursor = "default";
      }}
    >
      <group scale={[scale, scale, scale]} position={[0, dy, 0]}>
        <primitive object={model} />
      </group>
      {king ? (
        <group
          scale={[scale, scale, scale]}
          position={[0, dy + kingStackDy, 0]}
        >
          <primitive object={model.clone(true)} />
        </group>
      ) : null}
    </group>
  );
}

function MarbleTileMaterial({ color }: { color: string }) {
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
    />
  );
}

function NeonTileMaterial({ color }: { color: string }) {
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
    />
  );
}

function CozyGlowDecal({
  position,
  rotation,
  size,
  colorA,
  colorB,
  intensity = 1.0,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  size: [number, number];
  colorA: string;
  colorB: string;
  intensity?: number;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const cA = useMemo(() => new THREE.Color(colorA), [colorA]);
  const cB = useMemo(() => new THREE.Color(colorB), [colorB]);

  useFrame(({ clock }) => {
    if (matRef.current)
      matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh
      position={position}
      rotation={rotation ?? [-Math.PI / 2, 0, 0]}
      renderOrder={-10}
    >
      <planeGeometry args={size} />
      <shaderMaterial
        ref={matRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        uniforms={{
          uTime: { value: 0 },
          uColorA: { value: cA },
          uColorB: { value: cB },
          uIntensity: { value: intensity },
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
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          uniform float uIntensity;

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

          void main() {
            vec2 uv = vUv;
            vec2 p = uv - 0.5;
            p.x *= 1.15;
            float r = length(p);

            // soft radial pool + a bit of animated texture
            float base = smoothstep(0.55, 0.05, r);
            float n = noise2(uv * 8.0 + vec2(uTime * 0.05, -uTime * 0.04));
            float n2 = noise2(uv * 22.0 + vec2(-uTime * 0.12, uTime * 0.08));
            float tex = 0.75 + 0.25 * (n * 0.7 + n2 * 0.3);
            float pulse = 0.85 + 0.15 * sin(uTime * 0.8);

            vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.9, uv.y));
            float a = base * tex * pulse;
            a *= 0.30;

            gl_FragColor = vec4(col * (a * uIntensity), a);
          }
        `}
      />
    </mesh>
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
    if (e.button !== 0) return; // Left click only
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
      {/* Tech base */}
      <mesh receiveShadow castShadow onPointerDown={handleClick}>
        <boxGeometry args={[w, 0.1, d]} />
        <meshStandardMaterial
          color={disabled ? "#222" : active ? "#0044aa" : "#111"}
          roughness={0.2}
          metalness={0.9}
          emissive={active ? "#0044aa" : "#000"}
          emissiveIntensity={0.5}
        />
      </mesh>
      {/* Holographic top */}
      <mesh position={[0, 0.1, 0]} onPointerDown={handleClick}>
        <boxGeometry args={[w * 0.95, 0.02, d * 0.95]} />
        <meshBasicMaterial
          color={disabled ? "#444" : active ? "#00ffff" : "#0088ff"}
          transparent
          opacity={0.6}
        />
      </mesh>
      {/* Text on top */}
      <Text
        position={[0, 0.15, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.2}
        lineHeight={0.9}
        maxWidth={w * 0.98}
        textAlign="center"
        color={disabled ? "#888" : "#fff"}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.008}
        outlineColor={active ? "#00ffff" : "#000000"}
        onPointerDown={handleClick}
      >
        {label}
      </Text>
      {/* Glowing effect when active */}
      {active && (
        <pointLight
          position={[0, 0.5, 0]}
          color="#00ffff"
          intensity={2}
          distance={3}
        />
      )}
    </group>
  );
}

function ControlTV({
  center,
  active,
  hintText,
  onClick,
}: {
  center: THREE.Vector3;
  active: boolean;
  hintText?: string | null;
  onClick: (e: any) => void;
}) {
  const baseY = center.y;
  const standY = baseY + 0.55;
  const screenY = baseY + 1.08;

  return (
    <group
      position={[center.x, center.y, center.z]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick(e);
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
      {/* Base */}
      <mesh position={[0, 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.32, 0.18, 18]} />
        <meshStandardMaterial
          color="#0a0f18"
          roughness={0.4}
          metalness={0.55}
          emissive="#04080f"
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Stand */}
      <mesh position={[0, standY - baseY, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.8, 18]} />
        <meshStandardMaterial
          color="#0d1b2a"
          roughness={0.35}
          metalness={0.65}
          emissive="#021019"
          emissiveIntensity={0.35}
        />
      </mesh>

      {/* Accent ring */}
      <mesh position={[0, standY + 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.012, 12, 42]} />
        <meshBasicMaterial
          color={active ? "#00ffff" : "#6bc7ff"}
          transparent
          opacity={active ? 0.32 : 0.18}
        />
      </mesh>

      {/* Screen */}
      <group position={[0, screenY - baseY, 0]}>
        <RoundedBox args={[0.98, 0.64, 0.08]} radius={0.06} smoothness={6}>
          <meshStandardMaterial
            color="#05070a"
            roughness={0.22}
            metalness={0.82}
            emissive="#04060a"
            emissiveIntensity={0.45}
          />
        </RoundedBox>
        <mesh position={[0, 0, 0.052]}>
          <planeGeometry args={[0.9, 0.54]} />
          <meshBasicMaterial
            color={active ? "#00ffff" : "#6bc7ff"}
            transparent
            opacity={active ? 0.24 : 0.14}
          />
        </mesh>
        <mesh position={[0, 0, -0.052]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.9, 0.54]} />
          <meshBasicMaterial
            color={active ? "#00ffff" : "#6bc7ff"}
            transparent
            opacity={active ? 0.24 : 0.14}
          />
        </mesh>
        <Text
          position={[0, 0, 0.058]}
          fontSize={0.12}
          color={active ? "#00ffff" : "#a8cfff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {active ? "CLOSE" : "CONTROLS"}
        </Text>
        <Text
          position={[0, 0, -0.058]}
          rotation={[0, Math.PI, 0]}
          fontSize={0.12}
          color={active ? "#00ffff" : "#a8cfff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#000000"
          fontWeight="bold"
        >
          {active ? "CLOSE" : "CONTROLS"}
        </Text>
      </group>

      {hintText ? (
        <group position={[0, screenY - baseY + 0.55, 0]}>
          <RoundedBox args={[1.24, 0.24, 0.04]} radius={0.05} smoothness={5}>
            <meshBasicMaterial
              color="#000000"
              transparent
              opacity={0.55}
              depthWrite={false}
            />
          </RoundedBox>
          <Text
            position={[0, 0, 0.03]}
            fontSize={0.1}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.004}
            outlineColor="#000000"
          >
            {hintText}
          </Text>
          <Text
            position={[0, 0, -0.03]}
            rotation={[0, Math.PI, 0]}
            fontSize={0.1}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.004}
            outlineColor="#000000"
          >
            {hintText}
          </Text>
        </group>
      ) : null}
    </group>
  );
}

function GooseModel({
  position,
  rotation,
  scale,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: number;
}) {
  const { scene } = useGLTF("/models/goose.glb");
  const gooseRef = useRef<THREE.Group>(null);
  const idleRef = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.random() * 1000, []);
  const baseYRef = useRef(position[1]);

  useEffect(() => {
    baseYRef.current = position[1];
  }, [position[1]]);

  // Clone the scene to avoid sharing geometry between instances
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  useEffect(() => {
    if (gooseRef.current) {
      gooseRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, []);

  useFrame(({ clock }) => {
    const g = idleRef.current;
    if (!g) return;
    const t = clock.getElapsedTime() + seed;

    // Cute idle: gentle bob + tiny sway/tilt. (No yaw so facing stays stable.)
    g.position.y = Math.sin(t * 1.3) * 0.035;
    g.rotation.x = Math.sin(t * 1.9) * 0.06;
    g.rotation.z = Math.sin(t * 1.6) * 0.05;
  });

  return (
    <group
      ref={gooseRef}
      position={[position[0], baseYRef.current, position[2]]}
      rotation={rotation}
      scale={[scale, scale, scale]}
    >
      <group ref={idleRef}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

export function ScifiChess({
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
  quickPlay,
  onQuickPlayResult,
  onGameEnd,
  onSelfSeatChange,
  onRequestMove,
  onCenterCamera,
  onBoardControls,
  controlsOpen,
  board2dOpen,
  chessTheme,
  chessBoardTheme,
  gameMode = "chess",
}: {
  roomId: string;
  boardKey: string;
  origin: [number, number, number];
  selfPositionRef: RefObject<THREE.Vector3>;
  selfId: string;
  selfName?: string;
  onActivityMove?: (game: string, boardKey: string) => void;
  joinLockedBoardKey?: string | null;
  leaveAllNonce?: number;
  leaveAllExceptBoardKey?: string | null;
  onJoinIntent?: (boardKey: string) => void;
  quickPlay?: { token: number; targetBoardKey: string | null } | null;
  onQuickPlayResult?: (
    token: number,
    boardKey: string,
    ok: boolean,
    reason?: string
  ) => void;
  onGameEnd?: (event: {
    boardKey: string;
    mode: BoardMode;
    resultLabel: string;
    didWin: boolean | null;
    hadOpponent?: boolean;
    resultSeq?: number;
    rematch: () => void;
    switchSides: () => void;
    leave: () => void;
  }) => void;
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
  chessBoardTheme?: string;
  gameMode?: BoardMode;
}) {
  const engine = engineForMode(gameMode);
  const [warningSquare, setWarningSquare] = useState<Square | null>(null);
  const [warningStartMs, setWarningStartMs] = useState(0);
  const [showCoordinates, setShowCoordinates] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("chess-show-coordinates");
      return stored !== null ? stored === "true" : true;
    }
    return true;
  });

  // Listen for storage changes from the settings modal
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = () => {
      const stored = localStorage.getItem("chess-show-coordinates");
      setShowCoordinates(stored !== null ? stored === "true" : true);
    };

    // Custom event for same-window updates
    window.addEventListener("chess-coordinates-changed", handleStorageChange);
    // Storage event for cross-tab updates
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(
        "chess-coordinates-changed",
        handleStorageChange
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!warningSquare || !warningStartMs) return;
    const timeout = window.setTimeout(() => {
      setWarningSquare(null);
    }, 950);
    return () => window.clearTimeout(timeout);
  }, [warningSquare, warningStartMs]);

  const {
    playMove,
    playCapture,
    playSelect,
    playWarning,
    playClick,
    playHonk,
  } = useChessSounds();

  const chessGame = useChessGame({
    enabled: engine === "chess",
    variant: chessVariantForMode(gameMode),
    roomId,
    boardKey,
    origin,
    selfPositionRef,
    selfId,
    selfName,
    onActivityMove: () =>
      onActivityMove?.(
        chessVariantForMode(gameMode) === "goose" ? "goose" : "chess",
        boardKey
      ),
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
    lobby: "scifi",
    sounds: {
      move: playMove,
      capture: playCapture,
      select: playSelect,
      warning: playWarning,
      click: playClick,
    },
  });

  // Quick Play: if targeted, try to join an available seat (only on fresh games).
  const lastQuickPlayTokenRef = useRef<number>(-1);
  useEffect(() => {
    const token = quickPlay?.token ?? -1;
    const target = quickPlay?.targetBoardKey ?? null;
    if (token <= 0) return;
    if (!target || target !== boardKey) return;
    if (token === lastQuickPlayTokenRef.current) return;
    lastQuickPlayTokenRef.current = token;

    if (engine !== "chess" || gameMode !== "chess") {
      onQuickPlayResult?.(token, boardKey, false, "not-chess");
      return;
    }

    const seats = chessGame.netState.seats;
    const wConnId = seats.w?.connId ?? null;
    const bConnId = seats.b?.connId ?? null;

    if (
      wConnId === chessGame.chessSelfId ||
      bConnId === chessGame.chessSelfId
    ) {
      onQuickPlayResult?.(token, boardKey, true);
      return;
    }

    const isFresh =
      chessGame.netState.seq === 0 &&
      !chessGame.netState.lastMove &&
      !chessGame.netState.clock.running &&
      !chessGame.netState.result;

    const wTaken = !!wConnId;
    const bTaken = !!bConnId;
    const bothTaken = wTaken && bTaken;
    if (bothTaken) {
      onQuickPlayResult?.(token, boardKey, false, "full");
      return;
    }
    if (!isFresh) {
      onQuickPlayResult?.(token, boardKey, false, "in-progress");
      return;
    }

    const side: Side | null = !wTaken ? "w" : !bTaken ? "b" : null;
    if (!side) {
      onQuickPlayResult?.(token, boardKey, false, "full");
      return;
    }

    onJoinIntent?.(boardKey);
    chessGame.centerCamera();
    chessGame.clickJoin(side);
    onQuickPlayResult?.(token, boardKey, true);
  }, [
    quickPlay?.token,
    quickPlay?.targetBoardKey,
    boardKey,
    engine,
    gameMode,
    chessGame.netState.seats,
    chessGame.netState.seq,
    chessGame.netState.lastMove,
    chessGame.netState.clock.running,
    chessGame.netState.result,
    chessGame.chessSelfId,
    chessGame.centerCamera,
    chessGame.clickJoin,
    onJoinIntent,
    onQuickPlayResult,
  ]);

  // Game end -> notify world so it can show rematch/switch UI.
  const lastReportedResultSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (engine !== "chess") return;
    if (gameMode !== "chess" && gameMode !== "goose") return;
    const r = chessGame.netState.result;
    if (!r) return;
    if (chessGame.netState.seq === lastReportedResultSeqRef.current) return;
    lastReportedResultSeqRef.current = chessGame.netState.seq;
    if (!chessGame.resultLabel) return;

    const mySide = chessGame.myPrimarySide;
    const didWin =
      r.type === "draw" ? null : mySide ? r.winner === mySide : null;

    const seats = chessGame.netState.seats;
    const hadOpponent =
      !!seats.w?.connId &&
      !!seats.b?.connId &&
      seats.w.connId !== seats.b.connId;

    onGameEnd?.({
      boardKey,
      mode: gameMode,
      resultLabel: chessGame.resultLabel,
      didWin,
      hadOpponent,
      resultSeq: chessGame.netState.seq,
      rematch: () => chessGame.clickReset(),
      switchSides: () => {
        const s = chessGame.myPrimarySide;
        if (!s) return;
        const other: Side = s === "w" ? "b" : "w";
        chessGame.clickJoin(s);
        chessGame.clickJoin(other);
      },
      leave: () => {
        const s = chessGame.myPrimarySide;
        if (!s) return;
        chessGame.clickJoin(s);
      },
    });
  }, [
    engine,
    gameMode,
    chessGame.netState.result,
    chessGame.netState.seq,
    chessGame.myPrimarySide,
    chessGame.resultLabel,
    chessGame.clickReset,
    chessGame.clickJoin,
    onGameEnd,
    boardKey,
  ]);

  const checkersGame = useCheckersGame({
    enabled: engine === "checkers",
    roomId,
    boardKey,
    origin,
    selfPositionRef,
    selfId,
    selfName,
    onActivityMove: () => onActivityMove?.("checkers", boardKey),
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
    lobby: "scifi",
    sounds: {
      move: playMove,
      capture: playCapture,
      select: playSelect,
      warning: playWarning,
      click: playClick,
    },
  });

  const originVec = chessGame.originVec;
  const ox = originVec.x;
  const oz = originVec.z;
  const skipWhiteRight = ox < -1 && oz < -1;
  const skipWhiteLeft = ox > 1 && oz < -1;
  const skipBlackRight = ox < -1 && oz > 1;
  const skipBlackLeft = ox > 1 && oz > 1;

  const squareSize = chessGame.squareSize;
  const boardSize = chessGame.boardSize;

  const activeTurn = engine === "checkers" ? checkersGame.turn : chessGame.turn;
  const activeMySides =
    engine === "checkers" ? checkersGame.mySides : chessGame.mySides;
  const activeMyPrimarySide =
    engine === "checkers"
      ? checkersGame.myPrimarySide
      : chessGame.myPrimarySide;
  const activeIsSeated =
    engine === "checkers" ? checkersGame.isSeated : chessGame.isSeated;
  const activeSelected = (
    engine === "checkers" ? checkersGame.selected : chessGame.selected
  ) as string | null;
  const activeLegalTargets = (
    engine === "checkers" ? checkersGame.legalTargets : chessGame.legalTargets
  ) as string[];
  const activeLastMove =
    engine === "checkers" ? checkersGame.lastMove : chessGame.lastMove;
  const activePendingJoinSide =
    engine === "checkers"
      ? checkersGame.pendingJoinSide
      : chessGame.pendingJoinSide;
  const activeClocks =
    engine === "checkers" ? checkersGame.clocks : chessGame.clocks;
  const activeSeats =
    engine === "checkers"
      ? checkersGame.netState.seats
      : chessGame.netState.seats;
  const activeSelfConnId =
    engine === "checkers" ? checkersGame.gameSelfId : chessGame.chessSelfId;

  const seatOccupied = (
    seat?: { connId?: string | null; playerId?: string | null } | null
  ) => !!seat?.connId && !!seat?.playerId;
  const activeBothSeatsOccupied =
    seatOccupied(activeSeats.w) && seatOccupied(activeSeats.b);
  const canUseControlTV = activeIsSeated || !activeBothSeatsOccupied;

  const activeEmitControlsOpen =
    engine === "checkers"
      ? checkersGame.emitControlsOpen
      : chessGame.emitControlsOpen;
  const activeOnPickSquare = (sq: string) => {
    if (engine === "checkers") {
      checkersGame.onPickSquare(sq);
      return;
    }
    chessGame.onPickSquare(sq as any);
  };
  const activeOnPickPiece = (sq: string) => {
    if (engine === "checkers") {
      checkersGame.onPickPiece(sq);
      return;
    }
    chessGame.onPickPiece(sq as any);
  };
  const activeClickJoin = (side: Side) => {
    if (engine === "checkers") {
      checkersGame.clickJoin(side);
      return;
    }
    chessGame.clickJoin(side);
  };
  const activeRequestSitAt = (seatX: number, seatZ: number) => {
    if (engine === "checkers") {
      checkersGame.requestSitAt(seatX, seatZ);
      return;
    }
    chessGame.requestSitAt(seatX, seatZ);
  };
  const activeResultLabel =
    engine === "checkers" ? checkersGame.resultLabel : chessGame.resultLabel;

  const controlsHintTimerRef = useRef<number | null>(null);
  const [controlsHintOpen, setControlsHintOpen] = useState(false);

  const showControlsHint = () => {
    setControlsHintOpen(true);
    if (controlsHintTimerRef.current !== null) {
      window.clearTimeout(controlsHintTimerRef.current);
    }
    controlsHintTimerRef.current = window.setTimeout(() => {
      setControlsHintOpen(false);
      controlsHintTimerRef.current = null;
    }, 2200);
  };

  useEffect(() => {
    if (activeIsSeated) setControlsHintOpen(false);
  }, [activeIsSeated]);

  useEffect(() => {
    return () => {
      if (controlsHintTimerRef.current !== null) {
        window.clearTimeout(controlsHintTimerRef.current);
      }
    };
  }, []);

  // Brighter, more readable colors - Chrome silver vs Deep blue (unless wood set equipped)
  const whiteTint = useMemo(() => {
    if (chessTheme === "chess_wood") return new THREE.Color("#e1c28b");
    return new THREE.Color("#d0d8e8");
  }, [chessTheme]);
  const blackTint = useMemo(() => {
    if (chessTheme === "chess_wood") return new THREE.Color("#8a6a1b");
    return new THREE.Color("#2a4a7a");
  }, [chessTheme]);

  const boardPalette = useMemo(() => {
    switch (chessBoardTheme) {
      case "board_walnut":
        return {
          base: {
            color: "#2a1b12",
            roughness: 0.55,
            metalness: 0.25,
            emissive: "#110a08",
            emissiveIntensity: 0.08,
          },
          light: { color: "#c7a07a", emissive: "#2a1b12" },
          dark: { color: "#5a2d13", emissive: "#1a0e08" },
        };
      case "board_marble":
        return {
          base: {
            color: "#2b2b33",
            roughness: 0.35,
            metalness: 0.6,
            emissive: "#16161c",
            emissiveIntensity: 0.12,
          },
          light: { color: "#d9d9df", emissive: "#202028" },
          dark: { color: "#3a3a44", emissive: "#101018" },
        };
      case "board_neon":
        return {
          base: {
            color: "#07101c",
            roughness: 0.18,
            metalness: 0.9,
            emissive: "#07101c",
            emissiveIntensity: 0.08,
          },
          light: { color: "#1f5561", emissive: "#0a203a" },
          dark: { color: "#070a10", emissive: "#07101c" },
        };
      default:
        return {
          base: {
            color: "#2a3a4a",
            roughness: 0.3,
            metalness: 0.7,
            emissive: "#1a2a3a",
            emissiveIntensity: 0.2,
          },
          light: { color: "#4a5a6a", emissive: "#2a3a4a" },
          dark: { color: "#1a2a3a", emissive: "#0a1a2a" },
        };
    }
  }, [chessBoardTheme]);

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
  const controlPadCenter = useMemo(
    () =>
      new THREE.Vector3(originVec.x + boardSize / 2 + 1.6, 0.06, originVec.z),
    [originVec, boardSize]
  );

  return (
    <group>
      {/* Cozy glow pools (cheap shader decals) */}
      <CozyGlowDecal
        position={[originVec.x, 0.031, originVec.z]}
        size={[10.5, 10.5]}
        colorA="#ff7ad9"
        colorB="#7ae6ff"
        intensity={1.0}
      />

      {/* under-seat pools */}
      <CozyGlowDecal
        position={[originVec.x - 3.5, 0.031, originVec.z + padOffset + 1.5]}
        size={[4.0, 2.2]}
        colorA="#ffb36b"
        colorB="#ff5fd6"
        intensity={0.9}
      />
      <CozyGlowDecal
        position={[originVec.x + 3.5, 0.031, originVec.z + padOffset + 1.5]}
        size={[4.0, 2.2]}
        colorA="#ffb36b"
        colorB="#ff5fd6"
        intensity={0.9}
      />
      <CozyGlowDecal
        position={[originVec.x - 3.5, 0.031, originVec.z - padOffset - 1.5]}
        size={[4.0, 2.2]}
        colorA="#7ae6ff"
        colorB="#8fff6b"
        intensity={0.85}
      />
      <CozyGlowDecal
        position={[originVec.x + 3.5, 0.031, originVec.z - padOffset - 1.5]}
        size={[4.0, 2.2]}
        colorA="#7ae6ff"
        colorB="#8fff6b"
        intensity={0.85}
      />

      {/* Result banner */}
      {activeResultLabel ? (
        <Text
          position={[originVec.x, originVec.y + 1.5, originVec.z]}
          fontSize={0.32}
          color="#00ffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000"
        >
          {activeResultLabel}
        </Text>
      ) : null}

      {/* Sci-fi Seats */}
      {/* White side seats */}
      {!skipWhiteLeft && (
        <group
          position={[originVec.x - 3.5, 0.28, originVec.z + padOffset + 1.5]}
        >
          <mesh
            castShadow
            receiveShadow
            onPointerEnter={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerLeave={() => {
              document.body.style.cursor = "default";
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              activeRequestSitAt(
                originVec.x - 3.5,
                originVec.z + padOffset + 1.35
              );
            }}
          >
            <boxGeometry args={[2.9, 0.1, 0.85]} />
            <meshStandardMaterial
              color="#111"
              roughness={0.2}
              metalness={0.9}
            />
          </mesh>

          {/* cushion + pillows (raise seat height) */}
          <RoundedBox
            args={[2.55, 0.14, 0.72]}
            radius={0.1}
            smoothness={3}
            position={[0, 0.1, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#1a1a24"
              roughness={0.98}
              metalness={0.02}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.82, 0.12, 0.36]}
            radius={0.1}
            smoothness={3}
            position={[-0.62, 0.18, 0.1]}
            rotation={[0, 0.08, 0.06]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.88, 0.12, 0.38]}
            radius={0.1}
            smoothness={3}
            position={[0.62, 0.175, -0.06]}
            rotation={[0, -0.07, -0.05]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          {/* Glowing edge */}
          <mesh position={[0, 0.135, 0.42]}>
            <boxGeometry args={[2.9, 0.01, 0.02]} />
            <meshBasicMaterial color="#00ffff" />
          </mesh>
          {/* Floating effect base */}
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.4, 8]} />
            <meshBasicMaterial color="#00ffff" transparent opacity={0.3} />
          </mesh>
        </group>
      )}
      {!skipWhiteRight && (
        <group
          position={[originVec.x + 3.5, 0.28, originVec.z + padOffset + 1.5]}
        >
          <mesh
            castShadow
            receiveShadow
            onPointerEnter={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerLeave={() => {
              document.body.style.cursor = "default";
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              activeRequestSitAt(
                originVec.x + 3.5,
                originVec.z + padOffset + 1.35
              );
            }}
          >
            <boxGeometry args={[2.9, 0.1, 0.85]} />
            <meshStandardMaterial
              color="#111"
              roughness={0.2}
              metalness={0.9}
            />
          </mesh>

          {/* cushion + pillows (raise seat height) */}
          <RoundedBox
            args={[2.55, 0.14, 0.72]}
            radius={0.1}
            smoothness={3}
            position={[0, 0.1, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#1a1a24"
              roughness={0.98}
              metalness={0.02}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.82, 0.12, 0.36]}
            radius={0.1}
            smoothness={3}
            position={[-0.62, 0.18, 0.1]}
            rotation={[0, 0.08, 0.06]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.88, 0.12, 0.38]}
            radius={0.1}
            smoothness={3}
            position={[0.62, 0.175, -0.06]}
            rotation={[0, -0.07, -0.05]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <mesh position={[0, 0.135, 0.42]}>
            <boxGeometry args={[2.9, 0.01, 0.02]} />
            <meshBasicMaterial color="#00ffff" />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.4, 8]} />
            <meshBasicMaterial color="#00ffff" transparent opacity={0.3} />
          </mesh>
        </group>
      )}

      {/* Black side seats */}
      {!skipBlackLeft && (
        <group
          position={[originVec.x - 3.5, 0.28, originVec.z - padOffset - 1.5]}
        >
          <mesh
            castShadow
            receiveShadow
            onPointerEnter={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerLeave={() => {
              document.body.style.cursor = "default";
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              activeRequestSitAt(
                originVec.x - 3.5,
                originVec.z - padOffset - 1.35
              );
            }}
          >
            <boxGeometry args={[2.9, 0.1, 0.85]} />
            <meshStandardMaterial
              color="#111"
              roughness={0.2}
              metalness={0.9}
            />
          </mesh>

          {/* cushion + pillows (raise seat height) */}
          <RoundedBox
            args={[2.55, 0.14, 0.72]}
            radius={0.1}
            smoothness={3}
            position={[0, 0.1, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#1a1a24"
              roughness={0.98}
              metalness={0.02}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.82, 0.12, 0.36]}
            radius={0.1}
            smoothness={3}
            position={[-0.62, 0.18, 0.1]}
            rotation={[0, 0.08, 0.06]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.88, 0.12, 0.38]}
            radius={0.1}
            smoothness={3}
            position={[0.62, 0.175, -0.06]}
            rotation={[0, -0.07, -0.05]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <mesh position={[0, 0.135, -0.42]}>
            <boxGeometry args={[2.9, 0.01, 0.02]} />
            <meshBasicMaterial color="#ff00ff" />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.4, 8]} />
            <meshBasicMaterial color="#ff00ff" transparent opacity={0.3} />
          </mesh>
        </group>
      )}
      {!skipBlackRight && (
        <group
          position={[originVec.x + 3.5, 0.28, originVec.z - padOffset - 1.5]}
        >
          <mesh
            castShadow
            receiveShadow
            onPointerEnter={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerLeave={() => {
              document.body.style.cursor = "default";
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              activeRequestSitAt(
                originVec.x + 3.5,
                originVec.z - padOffset - 1.35
              );
            }}
          >
            <boxGeometry args={[2.9, 0.1, 0.85]} />
            <meshStandardMaterial
              color="#111"
              roughness={0.2}
              metalness={0.9}
            />
          </mesh>

          {/* cushion + pillows (raise seat height) */}
          <RoundedBox
            args={[2.55, 0.14, 0.72]}
            radius={0.1}
            smoothness={3}
            position={[0, 0.1, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#1a1a24"
              roughness={0.98}
              metalness={0.02}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.82, 0.12, 0.36]}
            radius={0.1}
            smoothness={3}
            position={[-0.62, 0.18, 0.1]}
            rotation={[0, 0.08, 0.06]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <RoundedBox
            args={[0.88, 0.12, 0.38]}
            radius={0.1}
            smoothness={3}
            position={[0.62, 0.175, -0.06]}
            rotation={[0, -0.07, -0.05]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color="#151525"
              roughness={0.99}
              metalness={0.01}
            />
          </RoundedBox>

          <mesh position={[0, 0.135, -0.42]}>
            <boxGeometry args={[2.9, 0.01, 0.02]} />
            <meshBasicMaterial color="#ff00ff" />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.4, 8]} />
            <meshBasicMaterial color="#ff00ff" transparent opacity={0.3} />
          </mesh>
        </group>
      )}

      {/* Sci-fi Props (Data Pylons) */}
      {[-1, 1].map((side) => (
        <group
          key={`pylon-${side}`}
          position={[originVec.x + side * 5, 0, originVec.z]}
        >
          {/* Base */}
          <mesh castShadow receiveShadow position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.4, 0.5, 0.2, 6]} />
            <meshStandardMaterial
              color="#222"
              roughness={0.3}
              metalness={0.8}
            />
          </mesh>

          {/* Floating Crystal/Core */}
          <mesh position={[0, 1.2, 0]} rotation={[0, 0, 0]}>
            <octahedronGeometry args={[0.3, 0]} />
            <meshBasicMaterial
              color={side > 0 ? "#00ffff" : "#ff00ff"}
              wireframe
            />
          </mesh>
          <mesh position={[0, 1.2, 0]} rotation={[0, Math.PI / 4, 0]}>
            <octahedronGeometry args={[0.2, 0]} />
            <meshBasicMaterial color={side > 0 ? "#00ffff" : "#ff00ff"} />
          </mesh>

          {/* Energy Beam */}
          <mesh position={[0, 1.0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 2, 8]} />
            <meshBasicMaterial
              color={side > 0 ? "#00ffff" : "#ff00ff"}
              transparent
              opacity={0.3}
            />
          </mesh>

          {/* Rings */}
          <mesh position={[0, 0.5, 0]} rotation={[0.1, 0, 0]}>
            <torusGeometry args={[0.3, 0.02, 8, 32]} />
            <meshStandardMaterial color="#444" metalness={1} roughness={0} />
          </mesh>
          <mesh position={[0, 1.8, 0]} rotation={[-0.1, 0, 0]}>
            <torusGeometry args={[0.3, 0.02, 8, 32]} />
            <meshStandardMaterial color="#444" metalness={1} roughness={0} />
          </mesh>
        </group>
      ))}

      {/* Board overhead lighting */}
      <pointLight
        position={[originVec.x, originVec.y + 8, originVec.z]}
        intensity={4}
        color="#ffffff"
        distance={15}
        decay={2}
      />
      <pointLight
        position={[originVec.x, originVec.y + 3, originVec.z]}
        intensity={2}
        color="#8899ff"
        distance={10}
        decay={2}
      />

      {/* Board */}
      <group position={[originVec.x, originVec.y, originVec.z]}>
        {/* Board Base - brighter */}
        <mesh position={[0, -0.05, 0]} receiveShadow castShadow>
          <boxGeometry args={[boardSize + 0.2, 0.1, boardSize + 0.2]} />
          {chessBoardTheme === "board_marble" ? (
            <MarbleTileMaterial color={boardPalette.base.color} />
          ) : chessBoardTheme === "board_neon" ? (
            <meshStandardMaterial
              color={boardPalette.base.color}
              roughness={0.18}
              metalness={0.9}
              emissive={boardPalette.base.emissive}
              emissiveIntensity={boardPalette.base.emissiveIntensity}
            />
          ) : (
            <meshStandardMaterial
              color={boardPalette.base.color}
              roughness={boardPalette.base.roughness}
              metalness={boardPalette.base.metalness}
              emissive={boardPalette.base.emissive}
              emissiveIntensity={boardPalette.base.emissiveIntensity}
            />
          )}
        </mesh>

        {Array.from({ length: 64 }).map((_, idx) => {
          const file = idx % 8;
          const rankFromTop = Math.floor(idx / 8);
          const rank = 8 - rankFromTop;
          const square = `${FILES[file]!}${rank}` as const;

          const x = (file - 3.5) * squareSize;
          const z = (rankFromTop - 3.5) * squareSize;
          const isDark = (file + rankFromTop) % 2 === 1;

          const isTarget = activeLegalTargets.includes(square);
          const isSel = activeSelected === square;
          const isLastMoveFrom = (activeLastMove as any)?.from === square;
          const isLastMoveTo = (activeLastMove as any)?.to === square;
          const pieceOnSquare =
            engine === "checkers"
              ? checkersGame.pieces.find((p) => p.square === square)
              : chessGame.pieces.find((p) => p.square === square);
          const canInteract =
            isTarget ||
            (pieceOnSquare &&
              activeMySides.has(pieceOnSquare.color) &&
              activeTurn === pieceOnSquare.color &&
              (engine !== "checkers" ||
                !checkersGame.netState.forcedFrom ||
                checkersGame.netState.forcedFrom === square));

          // Check if this is a valid goose placement square
          const isValidGoosePlacement =
            gameMode === "goose" &&
            chessGame.goosePhase === "goose" &&
            !pieceOnSquare &&
            !(square === chessGame.gooseSquare) &&
            !(
              parseFenMoveNumber(chessGame.netState.fen) > 20 &&
              (square === "d4" ||
                square === "e4" ||
                square === "d5" ||
                square === "e5")
            );

          return (
            <group
              key={square}
              position={[x, 0, z]}
              onPointerDown={(e) => {
                if (e.button !== 0) return; // Left click only
                e.stopPropagation();
                activeOnPickSquare(square);
              }}
              onPointerEnter={() => {
                if (engine === "chess") {
                  chessGame.setHoveredSquare(square as Square);
                }
                if (canInteract) document.body.style.cursor = "pointer";
              }}
              onPointerLeave={() => {
                if (engine === "chess") {
                  chessGame.setHoveredSquare(null);
                }
                document.body.style.cursor = "default";
              }}
            >
              <mesh receiveShadow castShadow>
                <boxGeometry args={[squareSize, 0.08, squareSize]} />
                {chessBoardTheme === "board_marble" ? (
                  <MarbleTileMaterial
                    color={
                      isDark
                        ? boardPalette.dark.color
                        : boardPalette.light.color
                    }
                  />
                ) : chessBoardTheme === "board_neon" ? (
                  <NeonTileMaterial
                    color={
                      isDark
                        ? boardPalette.dark.color
                        : boardPalette.light.color
                    }
                  />
                ) : (
                  <meshStandardMaterial
                    color={
                      isDark
                        ? boardPalette.dark.color
                        : boardPalette.light.color
                    }
                    roughness={0.4}
                    metalness={0.6}
                    emissive={
                      isDark
                        ? boardPalette.dark.emissive
                        : boardPalette.light.emissive
                    }
                    emissiveIntensity={0.15}
                  />
                )}
              </mesh>

              {/* Subtle grid lines on squares */}
              <mesh position={[0, 0.041, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[squareSize * 0.98, squareSize * 0.98]} />
                <meshBasicMaterial
                  color={
                    isDark
                      ? boardPalette.dark.emissive
                      : boardPalette.light.emissive
                  }
                  transparent
                  opacity={0.3}
                />
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
                    color="#00ffff"
                    transparent
                    opacity={0.4}
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
                  <PulsingIndicatorMaterial
                    color="#00ffff"
                    baseOpacity={0.2}
                    pulsingUntilMs={
                      engine === "checkers" && checkersGame.netState.forcedFrom
                        ? checkersGame.pulseTargetsUntilMs
                        : 0
                    }
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
                    opacity={0.3}
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
                    opacity={0.3}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    polygonOffset
                    polygonOffsetFactor={-1}
                    polygonOffsetUnits={-1}
                  />
                </mesh>
              )}

              {gameMode === "goose" &&
                chessGame.goosePhase !== "goose" &&
                !!pieceOnSquare &&
                chessGame.startledSquares.includes(square as any) && (
                  <group
                    position={[0, SQUARE_TOP_Y + 0.02, 0]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    renderOrder={2}
                  >
                    <mesh rotation={[0, 0, -Math.PI / 4]}>
                      <planeGeometry
                        args={[squareSize * 0.91, squareSize * 0.104]}
                      />
                      <SlowPulsingIndicatorMaterial
                        color="#4a9eff"
                        baseOpacity={0.22}
                      />
                    </mesh>
                    <mesh rotation={[0, 0, Math.PI / 4]}>
                      <planeGeometry
                        args={[squareSize * 0.91, squareSize * 0.104]}
                      />
                      <SlowPulsingIndicatorMaterial
                        color="#4a9eff"
                        baseOpacity={0.22}
                      />
                    </mesh>
                  </group>
                )}
            </group>
          );
        })}
      </group>

      {/* Join pads */}
      <JoinPad
        label={`${formatClock(activeClocks.remaining.w)}\n${
          activeSeats.w
            ? activeSeats.w.name || "White"
            : activePendingJoinSide === "w"
            ? "Joining…"
            : "Join White"
        }`}
        center={whitePadCenter}
        size={padSize}
        active={activeMySides.has("w")}
        disabled={
          (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
          activePendingJoinSide === "b" ||
          (!!activeSeats.w && activeSeats.w.connId !== activeSelfConnId)
        }
        onClick={() => activeClickJoin("w")}
      />
      <JoinPad
        label={`${formatClock(activeClocks.remaining.b)}\n${
          activeSeats.b
            ? activeSeats.b.name || "Black"
            : activePendingJoinSide === "b"
            ? "Joining…"
            : "Join Black"
        }`}
        center={blackPadCenter}
        size={padSize}
        active={activeMySides.has("b")}
        disabled={
          (joinLockedBoardKey && joinLockedBoardKey !== boardKey) ||
          activePendingJoinSide === "w" ||
          (!!activeSeats.b && activeSeats.b.connId !== activeSelfConnId)
        }
        onClick={() => activeClickJoin("b")}
      />

      {/* Control console / TV */}
      <ControlTV
        center={controlPadCenter}
        active={!!controlsOpen}
        hintText={controlsHintOpen ? "Both seats occupied" : null}
        onClick={() => {
          console.log("[ControlTV] Click detected", {
            activeIsSeated,
            activeBothSeatsOccupied,
            canUseControlTV,
            seats: {
              w: activeSeats.w,
              b: activeSeats.b,
            },
            controlsOpen,
          });
          if (!canUseControlTV) {
            console.log("[ControlTV] Blocked: canUseControlTV is false");
            showControlsHint();
            return;
          }
          console.log("[ControlTV] Allowed: proceeding");
          try {
            playClick();
          } catch {
            // ignore
          }
          if (controlsOpen) {
            console.log("[ControlTV] Closing controls");
            onBoardControls?.({ type: "close", boardKey });
            return;
          }
          console.log(
            "[ControlTV] Opening controls via activeEmitControlsOpen"
          );
          activeEmitControlsOpen();
        }}
      />

      {/* Goose Chess visuals */}
      {gameMode === "goose"
        ? (() => {
            // Position goose off-board initially or during placement
            if (
              chessGame.gooseSquare &&
              chessGame.netState.lastMove &&
              chessGame.goosePhase !== "goose"
            ) {
              // On board at gooseSquare (only if a move has been played and not placing)
              const sq = chessGame.gooseSquare;
              const file = sq.charCodeAt(0) - 97;
              const rank = Number(sq[1]);
              const rankFromTop = 8 - rank;
              const x = (file - 3.5) * squareSize;
              const z = (rankFromTop - 3.5) * squareSize;
              const y = originVec.y + SQUARE_TOP_Y;

              // Face the bottom of the board by default.
              let yaw = 0;
              let warningStartMs = 0;

              const nowMs = Date.now();
              const warningActive =
                !!chessGame.gooseBlocked &&
                chessGame.gooseBlocked.gooseSquare === sq &&
                nowMs - chessGame.gooseBlocked.at < 950;

              if (warningActive) {
                const psq = chessGame.gooseBlocked!.pieceSquare;
                const pFile = psq.charCodeAt(0) - 97;
                const pRank = Number(psq[1]);
                const pRankFromTop = 8 - pRank;
                const px = (pFile - 3.5) * squareSize;
                const pz = (pRankFromTop - 3.5) * squareSize;
                const dx = px - x;
                const dz = pz - z;
                yaw = Math.atan2(dx, dz);
                warningStartMs = chessGame.gooseBlocked!.at;
              }

              return (
                <group key={`goose:${sq}`}>
                  <GooseModel
                    position={[originVec.x + x, y, originVec.z + z]}
                    rotation={[0, yaw, 0]}
                    scale={squareSize * 0.525}
                  />
                  {warningActive && warningStartMs > 0 && (
                    <GooseWarningText
                      position={[originVec.x + x, y, originVec.z + z]}
                      startMs={warningStartMs}
                    />
                  )}
                </group>
              );
            } else {
              // Off to the side (before first move or during placement)
              return (
                <GooseModel
                  key="goose-waiting"
                  position={[
                    originVec.x + boardSize / 2 + 1.2,
                    originVec.y + 0.15,
                    originVec.z + 0.6,
                  ]}
                  rotation={[0, -Math.PI / 3, 0]}
                  scale={squareSize * 0.525}
                />
              );
            }
          })()
        : null}

      {gameMode === "goose" && chessGame.goosePhase === "goose" ? (
        <HolographicPlacementText
          originVec={originVec}
          boardSize={boardSize}
          squareSize={squareSize}
        />
      ) : null}

      {/* Startled squares handled by shader effect on pieces */}

      {/* Coordinate labels */}
      <CoordinateLabels
        originVec={originVec}
        squareSize={squareSize}
        boardSize={boardSize}
        showCoordinates={showCoordinates}
        boardTheme={chessBoardTheme}
      />

      {/* Pieces */}
      {engine === "checkers"
        ? checkersGame.pieces.map((p) => {
            const file = p.square.charCodeAt(0) - 97;
            const rank = Number(p.square[1]);
            const rankFromTop = 8 - rank;
            const x = (file - 3.5) * squareSize;
            const z = (rankFromTop - 3.5) * squareSize;

            const tint = p.color === "w" ? whiteTint : blackTint;
            const isMyPiece = activeMySides.has(p.color);
            const canMove = activeTurn === p.color && isMyPiece;

            const y = originVec.y + SQUARE_TOP_Y;
            return (
              <CheckerPiece
                key={`${p.color}:${p.king ? "k" : "m"}:${p.square}`}
                position={[originVec.x + x, y, originVec.z + z]}
                tint={tint}
                side={p.color}
                chessTheme={chessTheme}
                king={p.king}
                canMove={canMove}
                onPick={() => activeOnPickPiece(p.square)}
              />
            );
          })
        : chessGame.pieces.map((p) => {
            const isMyPiece = activeMySides.has(p.color);
            const canMove = activeTurn === p.color && isMyPiece;
            const animateFrom =
              chessGame.animatedFromByTo.get(p.square) ?? null;
            const isStartled =
              gameMode === "goose" &&
              chessGame.goosePhase !== "goose" &&
              chessGame.startledSquares.includes(p.square);

            const animKey = animateFrom
              ? `anim:${chessGame.netState.seq}:${p.color}:${p.type}:${animateFrom}->${p.square}`
              : `static:${p.color}:${p.type}:${p.square}`;

            return (
              <group key={animKey}>
                <AnimatedPiece
                  square={p.square}
                  type={p.type}
                  color={p.color}
                  originVec={originVec}
                  squareSize={squareSize}
                  animateFrom={animateFrom}
                  animSeq={chessGame.netState.seq}
                  canMove={canMove}
                  mySide={activeMyPrimarySide}
                  onPickPiece={(sq) => {
                    // Check for invalid capture attempt with startled piece
                    if (
                      gameMode === "goose" &&
                      chessGame.goosePhase !== "goose" &&
                      chessGame.selected &&
                      chessGame.legalTargets.includes(sq) &&
                      chessGame.startledSquares.includes(chessGame.selected) &&
                      chessGame.pieces.find((piece) => piece.square === sq)
                    ) {
                      playWarning();
                      setWarningSquare(chessGame.selected);
                      setWarningStartMs(performance.now());
                      return;
                    }
                    activeOnPickPiece(sq as any);
                  }}
                  whiteTint={whiteTint}
                  blackTint={blackTint}
                  chessTheme={chessTheme}
                  isStartled={isStartled}
                />
              </group>
            );
          })}
    </group>
  );
}

useGLTF.preload("/models/checker.glb");

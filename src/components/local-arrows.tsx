"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { squareCenter, type Square } from "./chess-core";

export type LocalArrow = {
  from: Square;
  to: Square;
  expiresAtMs: number;
};

export function LocalArrow3D({
  arrow,
  origin,
  squareSize,
  color = "#ffffff",
}: {
  arrow: Pick<LocalArrow, "from" | "to">;
  origin: THREE.Vector3;
  squareSize: number;
  color?: string;
}) {
  const { start, dir, len } = useMemo(() => {
    const start = squareCenter(arrow.from, origin, squareSize).add(
      new THREE.Vector3(0, 0.12, 0)
    );
    const end = squareCenter(arrow.to, origin, squareSize).add(
      new THREE.Vector3(0, 0.12, 0)
    );
    const v = end.clone().sub(start);
    const len = v.length();
    const dir = len > 1e-6 ? v.clone().multiplyScalar(1 / len) : v;
    return { start, dir, len };
  }, [arrow.from, arrow.to, origin, squareSize]);

  if (len < 1e-3) return null;

  const shaftLen = Math.max(0.001, len - squareSize * 0.35);
  const headLen = Math.min(squareSize * 0.35, len * 0.45);
  const shaftMid = start.clone().add(dir.clone().multiplyScalar(shaftLen / 2));
  const headMid = start
    .clone()
    .add(dir.clone().multiplyScalar(shaftLen + headLen / 2));
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );

  return (
    <group>
      <mesh
        position={[shaftMid.x, shaftMid.y, shaftMid.z]}
        quaternion={quat}
        renderOrder={4}
      >
        <cylinderGeometry args={[0.03, 0.03, shaftLen, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[headMid.x, headMid.y, headMid.z]}
        quaternion={quat}
        renderOrder={4}
      >
        <coneGeometry args={[0.075, headLen, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.75}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function useLocalArrows({
  enabled = true,
  ttlMs = 10_000,
  maxArrows = 7,
  suppressRightDragRef,
}: {
  enabled?: boolean;
  ttlMs?: number;
  maxArrows?: number;
  suppressRightDragRef?: React.MutableRefObject<boolean>;
}) {
  const [arrows, setArrows] = useState<LocalArrow[]>([]);

  const dragActiveRef = useRef(false);
  const dragStartRef = useRef<Square | null>(null);
  const dragEndRef = useRef<Square | null>(null);

  const clearArrows = useCallback(() => {
    setArrows([]);
  }, []);

  const onRightDownSquare = useCallback(
    (square: Square) => {
      if (!enabled) return;
      dragActiveRef.current = true;
      if (suppressRightDragRef) suppressRightDragRef.current = true;
      dragStartRef.current = square;
      dragEndRef.current = square;
    },
    [enabled, suppressRightDragRef]
  );

  const onRightEnterSquare = useCallback((square: Square) => {
    if (!dragActiveRef.current) return;
    dragEndRef.current = square;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onPointerUp = () => {
      if (!dragActiveRef.current) return;
      dragActiveRef.current = false;
      if (suppressRightDragRef) suppressRightDragRef.current = false;

      const from = dragStartRef.current;
      const to = dragEndRef.current;
      dragStartRef.current = null;
      dragEndRef.current = null;

      if (!from || !to) return;
      if (from === to) {
        clearArrows();
        return;
      }

      const now = Date.now();
      setArrows((prev) => {
        const next = prev.filter((a) => a.expiresAtMs > now).slice(-maxArrows);
        next.push({ from, to, expiresAtMs: now + ttlMs });
        return next;
      });
    };

    const onContextMenu = (e: MouseEvent) => {
      if (dragActiveRef.current) e.preventDefault();
    };

    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      if (suppressRightDragRef) suppressRightDragRef.current = false;
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [enabled, clearArrows, ttlMs, maxArrows, suppressRightDragRef]);

  useEffect(() => {
    if (enabled) return;
    dragActiveRef.current = false;
    dragStartRef.current = null;
    dragEndRef.current = null;
    if (suppressRightDragRef) suppressRightDragRef.current = false;
  }, [enabled, suppressRightDragRef]);

  // Prune expired arrows even if the user stops drawing.
  useEffect(() => {
    if (!enabled) return;
    if (arrows.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setArrows((prev) => prev.filter((a) => a.expiresAtMs > now));
    }, 500);
    return () => window.clearInterval(id);
  }, [enabled, arrows.length]);

  return {
    arrows,
    clearArrows,
    onRightDownSquare,
    onRightEnterSquare,
  };
}

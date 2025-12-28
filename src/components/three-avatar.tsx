"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  createAvatar,
  isAnimationDataLoaded,
  preLoadAnimationData,
  type Avatar,
  type AvatarAnimationDataSource,
} from "@/lib/threeAvatar";

const ANIMATION_MAP: AvatarAnimationDataSource = {
  idle: "/three-avatar/asset/animation/idle.fbx",
  walk: "/three-avatar/asset/animation/walk.fbx",
};

const DEFAULT_AVATAR_URL = "/three-avatar/asset/avatar-example/vrm-v1.vrm";

// Our world treats "forward" as -Z. The vendored three-avatar loader applies a
// 180° rotation internally, so we add an offset here to keep the avatar facing
// aligned with movement.
const MODEL_YAW_OFFSET = Math.PI;

let animationsPreloadPromise: Promise<void> | undefined;

async function ensureAnimationsLoaded() {
  if (isAnimationDataLoaded()) return;
  if (!animationsPreloadPromise) {
    animationsPreloadPromise = preLoadAnimationData(ANIMATION_MAP);
  }
  await animationsPreloadPromise;
}

export function ThreeAvatar({
  movingSpeed = 0,
  url,
}: {
  movingSpeed?: number;
  url?: string;
}) {
  const { gl } = useThree();
  const [avatar, setAvatar] = useState<Avatar | null>(null);

  const avatarRef = useRef<Avatar | null>(null);
  const lastClipRef = useRef<"idle" | "walk" | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureAnimationsLoaded();

      const avatarUrl = url ?? DEFAULT_AVATAR_URL;
      const resp = await fetch(avatarUrl);
      if (!resp.ok) {
        throw new Error(`Failed to fetch avatar: ${resp.status} ${resp.statusText}`);
      }
      const avatarData = new Uint8Array(await resp.arrayBuffer());

      let nextAvatar: Avatar;
      try {
        nextAvatar = await createAvatar(
          avatarData,
          gl as unknown as THREE.WebGLRenderer,
          false,
          {
            isInvisibleFirstPerson: false,
          }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // If a file ends with .vrm but the loader path is behaving like a generic GLB,
        // the most common cause is that optimization stripped VRM extensions/extras.
        // That can surface as RPM retargeting errors like "hip not found".
        if (
          avatarUrl.toLowerCase().endsWith(".vrm") &&
          (message.includes("hip not found") ||
            message.includes("mixamorigHips not found") ||
            message.includes("mixamo.com clip not found"))
        ) {
          throw new Error(
            "This file has a .vrm extension, but it no longer looks like a VRM at runtime. " +
              "Your optimization pipeline likely removed VRM metadata (extensions like VRM/VRMC_vrm and extras). " +
              "When that happens, the loader falls back to the ReadyPlayerMe retarget path and fails with bone-name errors (like 'hip not found'). " +
              "Re-export as VRM or optimize while preserving VRM extensions/extras (and avoid mesh simplify on skinned avatars)."
          );
        }

        throw err;
      }

      // If a file ends with .vrm but the loader didn't detect VRM metadata,
      // it was likely stripped during optimization (VRM extensions/extras removed).
      // In that case the library falls back to the ReadyPlayerMe retarget path,
      // which will fail with confusing bone-name errors like "hip not found".
      if (avatarUrl.toLowerCase().endsWith(".vrm") && !nextAvatar.vrm) {
        nextAvatar.dispose();
        throw new Error(
          "This avatar URL ends with .vrm, but no VRM metadata was found in the file. " +
            "Your optimization pipeline likely removed the VRM extensions (VRM/VRMC_vrm) or extras. " +
            "Re-export as VRM or optimize while preserving extensions/extras."
        );
      }

      nextAvatar.object3D.rotation.y = MODEL_YAW_OFFSET;

      if (cancelled) {
        nextAvatar.dispose();
        return;
      }

      avatarRef.current = nextAvatar;
      setAvatar(nextAvatar);
    })();

    return () => {
      cancelled = true;
      const a = avatarRef.current;
      avatarRef.current = null;
      setAvatar(null);
      if (a) a.dispose();
    };
  }, [gl, url]);

  useFrame((_state, dt) => {
    avatarRef.current?.tick(dt);
  });

  useEffect(() => {
    const a = avatarRef.current;
    if (!a) return;

    // Hysteresis prevents chattering around the threshold.
    const walkOn = 0.45;
    const walkOff = 0.25;
    const prev = lastClipRef.current;
    const next: "idle" | "walk" =
      prev === "walk"
        ? movingSpeed > walkOff
          ? "walk"
          : "idle"
        : movingSpeed > walkOn
          ? "walk"
          : "idle";

    if (lastClipRef.current !== next) {
      a.playClip(next);
      lastClipRef.current = next;
    }
  }, [movingSpeed]);

  if (!avatar) return null;
  return <primitive object={avatar.object3D} />;
}

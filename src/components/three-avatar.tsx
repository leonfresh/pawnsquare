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

type BoneKey =
  | "hips"
  | "spine"
  | "chest"
  | "leftUpperLeg"
  | "rightUpperLeg"
  | "leftLowerLeg"
  | "rightLowerLeg"
  | "leftFoot"
  | "rightFoot"
  | "leftUpperArm"
  | "rightUpperArm"
  | "leftLowerArm"
  | "rightLowerArm";

function buildHeuristicHumanoidMap(
  root: THREE.Object3D
): Map<BoneKey, THREE.Object3D> {
  const out = new Map<BoneKey, THREE.Object3D>();

  // First try to pick the primary deform skeleton from SkinnedMesh.
  const skeletonSet = new Set<THREE.Skeleton>();
  root.traverse((obj) => {
    const anyObj = obj as any;
    if (anyObj?.isSkinnedMesh && anyObj?.skeleton) {
      skeletonSet.add(anyObj.skeleton as THREE.Skeleton);
    }
  });

  let bones: THREE.Bone[] = [];
  if (skeletonSet.size) {
    // Choose the skeleton with the most bones (usually the main body rig).
    let best: THREE.Skeleton | null = null;
    let bestCount = -1;
    for (const sk of skeletonSet) {
      const count = sk.bones?.length ?? 0;
      if (count > bestCount) {
        bestCount = count;
        best = sk;
      }
    }
    bones = best?.bones ? [...best.bones] : [];
  }

  // Fallback: collect any bones reachable under the avatar root.
  if (!bones.length) {
    const boneSet = new Set<THREE.Bone>();
    root.traverse((obj) => {
      if ((obj as any).isBone) boneSet.add(obj as THREE.Bone);
      const anyObj = obj as any;
      const skeleton = anyObj?.skeleton as THREE.Skeleton | undefined;
      if (skeleton?.bones?.length) {
        for (const b of skeleton.bones) boneSet.add(b);
      }
    });
    bones = Array.from(boneSet);
  }

  if (!bones.length) return out;

  root.updateMatrixWorld(true);

  const tmp = new THREE.Vector3();
  const worldPos = new Map<THREE.Bone, THREE.Vector3>();

  const getPos = (b: THREE.Bone) => {
    let v = worldPos.get(b);
    if (!v) {
      v = b.getWorldPosition(tmp.clone());
      worldPos.set(b, v);
    }
    return v;
  };
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of bones) {
    const v = getPos(b);
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const height = Math.max(1e-6, maxY - minY);
  const pelvisY = minY + height * 0.55;

  const childBones = (b: THREE.Bone) =>
    b.children.filter((c): c is THREE.Bone => (c as any).isBone);

  // Pick hips: near center, around pelvis height, has both up and down children.
  let bestHips: THREE.Bone | null = null;
  let bestScore = -Infinity;
  for (const b of bones) {
    const p = getPos(b);
    const kids = childBones(b);
    if (kids.length < 2) continue;

    let down = 0;
    let up = 0;
    for (const k of kids) {
      const kp = getPos(k);
      if (kp.y < p.y - height * 0.03) down++;
      if (kp.y > p.y + height * 0.02) up++;
    }
    if (down < 1 || up < 1) continue;

    const yScore = 1 - Math.min(1, Math.abs(p.y - pelvisY) / height);
    const xScore = 1 - Math.min(1, Math.abs(p.x) / (height * 0.25));
    const score = down * 2 + up + yScore * 2 + xScore;

    if (score > bestScore) {
      bestScore = score;
      bestHips = b;
    }
  }

  if (!bestHips) return out;
  out.set("hips", bestHips);

  const hipsPos = getPos(bestHips);
  const hipsKids = childBones(bestHips);
  const upKids = hipsKids
    .filter((k) => getPos(k).y > hipsPos.y + height * 0.02)
    .sort((a, b) => getPos(b).y - getPos(a).y);
  if (upKids[0]) out.set("spine", upKids[0]);

  // Chest = next bone up the spine if present.
  const spine = out.get("spine") as THREE.Bone | undefined;
  if (spine) {
    const spinePos = getPos(spine);
    const spineUp = childBones(spine)
      .filter((k) => getPos(k).y > spinePos.y + height * 0.01)
      .sort((a, b) => getPos(b).y - getPos(a).y);
    if (spineUp[0]) out.set("chest", spineUp[0]);
  }

  // Legs: choose two most left/right children below hips.
  const downKids = hipsKids
    .filter((k) => getPos(k).y < hipsPos.y - height * 0.03)
    .sort((a, b) => getPos(a).x - getPos(b).x);
  const leftUpperLeg = downKids[0];
  const rightUpperLeg = downKids.length >= 2 ? downKids[downKids.length - 1] : null;

  if (leftUpperLeg) out.set("leftUpperLeg", leftUpperLeg);
  if (rightUpperLeg) out.set("rightUpperLeg", rightUpperLeg);

  const pickDownChain = (start?: THREE.Bone | null) => {
    if (!start) return { lower: null as THREE.Bone | null, foot: null as THREE.Bone | null };
    const startPos = getPos(start);
    const lower = childBones(start)
      .filter((k) => getPos(k).y < startPos.y - height * 0.02)
      .sort((a, b) => getPos(a).y - getPos(b).y)[0];
    if (!lower) return { lower: null, foot: null };
    const lowerPos = getPos(lower);
    const foot = childBones(lower)
      .filter((k) => getPos(k).y < lowerPos.y - height * 0.01)
      .sort((a, b) => getPos(a).y - getPos(b).y)[0];
    return { lower, foot: foot ?? null };
  };

  const leftChain = pickDownChain(leftUpperLeg ?? null);
  const rightChain = pickDownChain(rightUpperLeg ?? null);
  if (leftChain.lower) out.set("leftLowerLeg", leftChain.lower);
  if (rightChain.lower) out.set("rightLowerLeg", rightChain.lower);
  if (leftChain.foot) out.set("leftFoot", leftChain.foot);
  if (rightChain.foot) out.set("rightFoot", rightChain.foot);

  // Arms (optional, best-effort): pick two farthest-x bones near top as upper arms.
  const chestOrSpine = (out.get("chest") as THREE.Bone | undefined) ?? spine;
  if (chestOrSpine) {
    const basePos = getPos(chestOrSpine);
    const candidates = bones
      .filter((b) => {
        const p = getPos(b);
        return p.y > basePos.y - height * 0.05 && p.y < basePos.y + height * 0.15;
      })
      .sort((a, b) => Math.abs(getPos(b).x) - Math.abs(getPos(a).x));
    const left = candidates.find((b) => getPos(b).x < -height * 0.05);
    const right = candidates.find((b) => getPos(b).x > height * 0.05);
    if (left) out.set("leftUpperArm", left);
    if (right) out.set("rightUpperArm", right);

    const pickArmLower = (upper?: THREE.Bone) => {
      if (!upper) return null;
      const upPos = getPos(upper);
      return (
        childBones(upper)
          .filter((k) => getPos(k).y < upPos.y + height * 0.03)
          .sort((a, b) => getPos(a).y - getPos(b).y)[0] ?? null
      );
    };
    const lLower = pickArmLower(left ?? undefined);
    const rLower = pickArmLower(right ?? undefined);
    if (lLower) out.set("leftLowerArm", lLower);
    if (rLower) out.set("rightLowerArm", rLower);
  }

  return out;
}

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
  pose = "stand",
}: {
  movingSpeed?: number;
  url?: string;
  pose?: "stand" | "sit";
}) {
  const { gl } = useThree();
  const [avatar, setAvatar] = useState<Avatar | null>(null);

  const avatarRef = useRef<Avatar | null>(null);
  const lastClipRef = useRef<"idle" | "walk" | null>(null);
  const restQuatsByNodeRef = useRef<WeakMap<THREE.Object3D, THREE.Quaternion>>(
    new WeakMap()
  );
  const tmpQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const tmpTargetQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const boneNameIndexRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const heuristicHumanoidRef = useRef<Map<BoneKey, THREE.Object3D>>(new Map());
  const warnedNoBonesRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const a = avatarRef.current;
    // eslint-disable-next-line no-console
    console.log("[pose]", pose, {
      hasAvatar: !!a,
      hasVrm: !!a?.vrm,
      heuristicKeys: Array.from(heuristicHumanoidRef.current.keys()),
    });
  }, [pose]);

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

      // Ground the avatar so its feet touch y=0 in local space.
      // Different avatar exports have different origins; this normalizes them.
      try {
        nextAvatar.object3D.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(nextAvatar.object3D);
        if (Number.isFinite(box.min.y)) {
          const lift = -box.min.y;
          // Small epsilon avoids z-fighting with the ground.
          nextAvatar.object3D.position.y += lift + 0.002;
          nextAvatar.object3D.updateWorldMatrix(true, true);
        }
      } catch {
        // ignore grounding failures
      }

      // Reset any cached pose/rest data for the newly loaded avatar.
      restQuatsByNodeRef.current = new WeakMap();
      warnedNoBonesRef.current = false;
      lastClipRef.current = null;
      const nameIndex = new Map<string, THREE.Object3D>();
      nextAvatar.object3D.traverse((obj) => {
        if (obj.name) nameIndex.set(obj.name.toLowerCase(), obj);
      });
      boneNameIndexRef.current = nameIndex;

      // Heuristic fallback: works for skinned humanoids even if bones have no names.
      heuristicHumanoidRef.current = buildHeuristicHumanoidMap(nextAvatar.object3D);

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

    const sitWeight = useRef(0);

    // Fidget state
    const fidgetTargetRef = useRef({
      neck: new THREE.Vector2(),
      spine: new THREE.Vector2(),
      leftArm: new THREE.Vector2(),
      rightArm: new THREE.Vector2(),
      leftLeg: new THREE.Vector2(),
      rightLeg: new THREE.Vector2(),
    });
    const fidgetCurrentRef = useRef({
      neck: new THREE.Vector2(),
      spine: new THREE.Vector2(),
      leftArm: new THREE.Vector2(),
      rightArm: new THREE.Vector2(),
      leftLeg: new THREE.Vector2(),
      rightLeg: new THREE.Vector2(),
    });
    const nextFidgetTimeRef = useRef(0);

    useFrame((state, dt) => {
    const a = avatarRef.current;
    if (!a) return;
    a.tick(dt);

    // Procedural sit pose using Normalized Bones (VRM Humanoid).
    // This ensures consistent behavior across different VRM models (VRM 0.0 vs 1.0).
    const vrm = a.vrm;
    const humanoid = vrm?.humanoid;

    // Smoothly transition sit weight
    const targetWeight = pose === "sit" ? 1 : 0;
    const diff = targetWeight - sitWeight.current;
    sitWeight.current += diff * Math.min(1, dt * 4); // Speed of transition

    // If fully standing, don't override animations
    if (sitWeight.current < 0.001) return;

    // Helper to apply rotation to a normalized bone
    const applyNormalized = (boneName: string, x: number, y: number, z: number) => {
      if (!humanoid) return;
      const node = (humanoid.getNormalizedBoneNode as any)?.(boneName);
      if (!node) return;

      const targetQ = tmpTargetQuatRef.current;
      targetQ.setFromEuler(new THREE.Euler(x, y, z));
      
      // Slerp from current animation state (or rest) to target
      node.quaternion.slerp(targetQ, sitWeight.current);
    };

    // Apply Sit Pose (Normalized)
    if (humanoid) {
      // Procedural breathing/idle noise
      const t = state.clock.elapsedTime;
      const breathe = Math.sin(t * 1.5) * 0.04; // Chest rise/fall
      const sway = Math.sin(t * 0.8) * 0.02;    // Slight body sway

      // Fidget logic
      if (t > nextFidgetTimeRef.current) {
        fidgetTargetRef.current.neck.set(
          (Math.random() - 0.5) * 0.8, // Increased range
          (Math.random() - 0.5) * 0.5
        );
        fidgetTargetRef.current.spine.set((Math.random() - 0.5) * 0.3, 0); // Increased range
        
        // Random arm movements (scratching leg, adjusting position)
        fidgetTargetRef.current.leftArm.set(
          (Math.random() - 0.5) * 0.2, 
          (Math.random() - 0.5) * 0.2
        );
        fidgetTargetRef.current.rightArm.set(
          (Math.random() - 0.5) * 0.2, 
          (Math.random() - 0.5) * 0.2
        );

        // Random leg shifts (crossing/uncrossing slightly or tapping foot)
        fidgetTargetRef.current.leftLeg.set(
          (Math.random() - 0.5) * 0.1, 
          (Math.random() - 0.5) * 0.1
        );
        fidgetTargetRef.current.rightLeg.set(
          (Math.random() - 0.5) * 0.1, 
          (Math.random() - 0.5) * 0.1
        );

        nextFidgetTimeRef.current = t + 1 + Math.random() * 3; // More frequent
      }
      const lerpFactor = dt * 3; // Faster transition
      fidgetCurrentRef.current.neck.lerp(
        fidgetTargetRef.current.neck,
        lerpFactor
      );
      fidgetCurrentRef.current.spine.lerp(
        fidgetTargetRef.current.spine,
        lerpFactor
      );
      fidgetCurrentRef.current.leftArm.lerp(fidgetTargetRef.current.leftArm, lerpFactor);
      fidgetCurrentRef.current.rightArm.lerp(fidgetTargetRef.current.rightArm, lerpFactor);
      fidgetCurrentRef.current.leftLeg.lerp(fidgetTargetRef.current.leftLeg, lerpFactor);
      fidgetCurrentRef.current.rightLeg.lerp(fidgetTargetRef.current.rightLeg, lerpFactor);

      const fNeck = fidgetCurrentRef.current.neck;
      const fSpine = fidgetCurrentRef.current.spine;
      const fLArm = fidgetCurrentRef.current.leftArm;
      const fRArm = fidgetCurrentRef.current.rightArm;
      const fLLeg = fidgetCurrentRef.current.leftLeg;
      const fRLeg = fidgetCurrentRef.current.rightLeg;

      // Hips - adjust position to sit on bench
      const hips = (humanoid.getNormalizedBoneNode as any)?.("hips");
      if (hips) {
        // Lower the hips visually.
        hips.position.y = THREE.MathUtils.lerp(
          hips.position.y,
          0.55,
          sitWeight.current * 0.1
        );
      }

      applyNormalized("hips", -0.1, 0, 0);
      applyNormalized("spine", 0.1 + sway + fSpine.x, 0, 0);
      applyNormalized("chest", 0.05 + breathe, 0, 0);
      applyNormalized("neck", fNeck.y, fNeck.x, 0); // Swapped x/y for neck rotation (yaw is Y)
      
      // Legs: Lifted up (~80 deg) and Knees bent down (~90 deg)
      applyNormalized("leftUpperLeg", -1.4 + fLLeg.x, 0.1 + fLLeg.y, 0); 
      applyNormalized("rightUpperLeg", -1.4 + fRLeg.x, -0.1 + fRLeg.y, 0);
      
      applyNormalized("leftLowerLeg", 1.5, 0, 0); 
      applyNormalized("rightLowerLeg", 1.5, 0, 0);
      
      applyNormalized("leftFoot", -0.2, 0, 0); 
      applyNormalized("rightFoot", -0.2, 0, 0);
      
      // Arms - relaxed on lap
      // Inverted Z rotation to bring arms DOWN instead of UP.
      applyNormalized("leftUpperArm", 0.3 + fLArm.x, 0, -1.3 + fLArm.y); 
      applyNormalized("rightUpperArm", 0.3 + fRArm.x, 0, 1.3 + fRArm.y);
      
      // Bend elbows slightly to rest hands on thighs
      applyNormalized("leftLowerArm", -0.3, 0, 0);
      applyNormalized("rightLowerArm", -0.3, 0, 0);
      
      // Force update to apply normalized bone changes to actual mesh
      vrm.update(0);
    }
  });

  useEffect(() => {
    const a = avatarRef.current;
    if (!a) return;

    if (pose === "sit") {
      // Stop animation so our procedural pose takes full effect without fighting
      a.stopClip();
      lastClipRef.current = null; // Reset so we can resume later
      return;
    }

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
  }, [movingSpeed, pose]);

  if (!avatar) return null;
  return <primitive object={avatar.object3D} />;
}

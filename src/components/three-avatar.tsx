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

const avatarDataCache = new Map<string, Promise<Uint8Array>>();

// Cache for shared geometries, materials, and textures by avatar URL
const geometryCache = new Map<string, Map<string, THREE.BufferGeometry>>();
const materialCache = new Map<string, Map<string, THREE.Material>>();
const textureCache = new Map<string, Map<string, THREE.Texture>>();

function getCachedAvatarData(url: string): Promise<Uint8Array> {
  const key = url;
  const existing = avatarDataCache.get(key);
  if (existing) return existing;

  const p = (async () => {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `Failed to fetch avatar: ${resp.status} ${resp.statusText}`
      );
    }
    return new Uint8Array(await resp.arrayBuffer());
  })();

  avatarDataCache.set(key, p);
  p.catch(() => {
    // Don't keep failed entries around.
    if (avatarDataCache.get(key) === p) avatarDataCache.delete(key);
  });

  return p;
}

type EnqueuedTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

const avatarLoadQueue: Array<EnqueuedTask<Avatar>> = [];
let avatarLoadActive = 0;
const AVATAR_LOAD_CONCURRENCY = 1;

function pumpAvatarQueue() {
  while (avatarLoadActive < AVATAR_LOAD_CONCURRENCY && avatarLoadQueue.length) {
    const task = avatarLoadQueue.shift()!;
    avatarLoadActive += 1;
    task
      .run()
      .then(task.resolve)
      .catch(task.reject)
      .finally(() => {
        avatarLoadActive -= 1;
        pumpAvatarQueue();
      });
  }
}

function enqueueAvatarLoad(run: () => Promise<Avatar>): Promise<Avatar> {
  return new Promise((resolve, reject) => {
    avatarLoadQueue.push({ run, resolve, reject });
    pumpAvatarQueue();
  });
}

function optimizeTextures(avatarUrl: string, obj: THREE.Object3D) {
  const MAX_TEXTURE_SIZE = 512;

  let texCache = textureCache.get(avatarUrl);
  if (!texCache) {
    texCache = new Map();
    textureCache.set(avatarUrl, texCache);
  }

  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const mat of materials) {
      if (!mat || typeof mat !== "object") continue;
      const anyMat = mat as any;

      // Process common texture slots
      const slots = [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "emissiveMap",
        "aoMap",
      ];

      for (const slot of slots) {
        const tex = anyMat[slot] as THREE.Texture | undefined;
        if (!tex || !tex.isTexture) continue;

        // Create texture key based on image source
        const img = tex.image as
          | HTMLImageElement
          | HTMLCanvasElement
          | undefined;
        if (!img) continue;

        const imgSrc =
          (img as HTMLImageElement).src ||
          (img as HTMLCanvasElement).toDataURL?.()?.substring(0, 100) ||
          tex.uuid;
        const texKey = `${slot}_${imgSrc}`;

        // Check if we already have this texture cached
        const cachedTex = texCache!.get(texKey);
        if (cachedTex) {
          // Reuse cached texture
          tex.dispose();
          anyMat[slot] = cachedTex;
          continue;
        }

        // Disable mipmaps to save memory
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;

        const w = img.width || 0;
        const h = img.height || 0;

        if (w > MAX_TEXTURE_SIZE || h > MAX_TEXTURE_SIZE) {
          // Downsample large textures
          const scale = Math.min(MAX_TEXTURE_SIZE / w, MAX_TEXTURE_SIZE / h);
          const newW = Math.floor(w * scale);
          const newH = Math.floor(h * scale);

          const canvas = document.createElement("canvas");
          canvas.width = newW;
          canvas.height = newH;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img as any, 0, 0, newW, newH);
            tex.image = canvas;
            tex.needsUpdate = true;
          }
        }

        // Cache this texture for future instances
        texCache!.set(texKey, tex);
      }
    }
  });
}

// Share geometries and materials across avatar instances with the same URL
function shareGeometryAndMaterials(avatarUrl: string, obj: THREE.Object3D) {
  let geoCache = geometryCache.get(avatarUrl);
  let matCache = materialCache.get(avatarUrl);

  if (!geoCache) {
    geoCache = new Map();
    geometryCache.set(avatarUrl, geoCache);
  }
  if (!matCache) {
    matCache = new Map();
    materialCache.set(avatarUrl, matCache);
  }

  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    // Skip skinned meshes - they need unique geometries for bone weights
    if (mesh.isSkinnedMesh) return;

    // Share geometry for non-skinned meshes
    if (mesh.geometry) {
      const geoKey = mesh.geometry.uuid;
      const cached = geoCache!.get(geoKey);
      if (cached) {
        // Dispose old geometry and use cached one
        mesh.geometry.dispose();
        mesh.geometry = cached;
      } else {
        geoCache!.set(geoKey, mesh.geometry);
      }
    }

    // Share materials (but not for skinned meshes which might have unique material properties)
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    const newMaterials: THREE.Material[] = [];
    for (const mat of materials) {
      if (!mat) {
        newMaterials.push(mat);
        continue;
      }

      // Create a more robust key based on material properties
      const anyMat = mat as any;
      const colorHex = anyMat.color?.getHex() ?? "none";
      const emissiveHex = anyMat.emissive?.getHex() ?? "none";
      const roughness = anyMat.roughness ?? "none";
      const metalness = anyMat.metalness ?? "none";
      const matKey = `${mat.type}_${colorHex}_${emissiveHex}_${roughness}_${metalness}`;

      const cached = matCache!.get(matKey);
      if (cached && cached.type === mat.type) {
        // Dispose old material and use cached one
        mat.dispose();
        newMaterials.push(cached);
      } else {
        matCache!.set(matKey, mat);
        newMaterials.push(mat);
      }
    }

    if (Array.isArray(mesh.material)) {
      mesh.material = newMaterials as THREE.Material[];
    } else {
      mesh.material = newMaterials[0];
    }
  });
}

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
  const rightUpperLeg =
    downKids.length >= 2 ? downKids[downKids.length - 1] : null;

  if (leftUpperLeg) out.set("leftUpperLeg", leftUpperLeg);
  if (rightUpperLeg) out.set("rightUpperLeg", rightUpperLeg);

  const pickDownChain = (start?: THREE.Bone | null) => {
    if (!start)
      return {
        lower: null as THREE.Bone | null,
        foot: null as THREE.Bone | null,
      };
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
        return (
          p.y > basePos.y - height * 0.05 && p.y < basePos.y + height * 0.15
        );
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

const DEFAULT_AVATAR_URL =
  "/three-avatar/asset/avatar-example/default_female.vrm";

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
  idleWiggle = false,
  idleWiggleStrength = 1,
  onLoaded,
}: {
  movingSpeed?: number;
  url?: string;
  pose?: "stand" | "sit";
  idleWiggle?: boolean;
  idleWiggleStrength?: number;
  onLoaded?: (object3D: THREE.Object3D) => void;
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
  const onLoadedRef = useRef<((object3D: THREE.Object3D) => void) | undefined>(
    undefined
  );
  const tmpWiggleQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion());

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

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

      let nextAvatar: Avatar;
      try {
        nextAvatar = await enqueueAvatarLoad(async () => {
          if (cancelled) {
            throw new Error("Avatar load cancelled");
          }
          // Load avatar data and create instance
          const avatarData = await getCachedAvatarData(avatarUrl);
          return await createAvatar(
            avatarData,
            gl as unknown as THREE.WebGLRenderer,
            true, // Enable frustum culling for performance
            {
              isInvisibleFirstPerson: false,
            }
          );
        });
      } catch (err) {
        if (cancelled) return;

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

      // Optimize textures and share geometry/materials (order matters - textures first)
      optimizeTextures(avatarUrl, nextAvatar.object3D);
      shareGeometryAndMaterials(avatarUrl, nextAvatar.object3D);

      // Disable shadows on avatars for performance (huge FPS gain with many avatars)
      nextAvatar.object3D.traverse((node) => {
        if ((node as any).isMesh) {
          node.castShadow = false;
          node.receiveShadow = false;
        }
      });

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

        // Fix ghosting on sideways movement: ensure all materials have proper depth settings
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          materials.forEach((mat: any) => {
            if (mat.transparent) {
              mat.depthWrite = true;
              mat.depthTest = true;
            }
          });
        }
      });
      boneNameIndexRef.current = nameIndex;

      // Heuristic fallback: works for skinned humanoids even if bones have no names.
      heuristicHumanoidRef.current = buildHeuristicHumanoidMap(
        nextAvatar.object3D
      );

      if (cancelled) {
        nextAvatar.dispose();
        return;
      }

      avatarRef.current = nextAvatar;
      setAvatar(nextAvatar);
      onLoadedRef.current?.(nextAvatar.object3D);
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

  // Throttle animation updates based on distance from camera
  const updateThrottleRef = useRef(0);
  const shouldUpdateThisFrame = (camera: THREE.Camera) => {
    if (!avatarRef.current) return false;

    const pos = avatarRef.current.object3D.position;
    const camPos = camera.position;
    const dx = pos.x - camPos.x;
    const dz = pos.z - camPos.z;
    const distSq = dx * dx + dz * dz;

    // Close avatars (< 15 units): update every frame
    if (distSq < 225) return true;

    // Medium distance (15-30 units): update every 2 frames
    if (distSq < 900) {
      updateThrottleRef.current = (updateThrottleRef.current + 1) % 2;
      return updateThrottleRef.current === 0;
    }

    // Far avatars (> 30 units): update every 4 frames
    updateThrottleRef.current = (updateThrottleRef.current + 1) % 4;
    return updateThrottleRef.current === 0;
  };

  useFrame((state, dt) => {
    const a = avatarRef.current;
    if (!a) return;

    // Throttle updates for distant avatars
    if (!shouldUpdateThisFrame(state.camera)) return;

    a.tick(dt);

    // Small idle wiggle to help drive VRM spring bones (hair/cloth) in previews.
    // This is applied on top of the current animation pose.
    if (
      idleWiggle &&
      pose === "stand" &&
      (movingSpeed ?? 0) < 0.05 &&
      Number.isFinite(idleWiggleStrength) &&
      idleWiggleStrength > 0
    ) {
      const t = state.clock.elapsedTime;
      const s = Math.min(2.5, Math.max(0.05, idleWiggleStrength));

      const ax = Math.sin(t * 1.25) * 0.05 * s;
      const ay = Math.sin(t * 0.95 + 1.3) * 0.085 * s;
      const az = Math.sin(t * 1.15 + 2.1) * 0.03 * s;

      const wiggleQ = tmpWiggleQuatRef.current;
      wiggleQ.setFromEuler(new THREE.Euler(ax, ay, az));

      const vrm = a.vrm;
      const humanoid = vrm?.humanoid;
      const k = Math.min(1, dt * 5);

      const applyToNode = (node: THREE.Object3D | undefined | null) => {
        if (!node) return false;
        const target = tmpTargetQuatRef.current;
        target.copy(node.quaternion).multiply(wiggleQ);
        node.quaternion.slerp(target, k);
        return true;
      };

      let applied = false;
      if (humanoid) {
        const getNorm = (humanoid.getNormalizedBoneNode as any)?.bind(humanoid);
        if (typeof getNorm === "function") {
          const nodes = [
            getNorm("spine"),
            getNorm("chest"),
            getNorm("upperChest"),
            getNorm("neck"),
            getNorm("head"),
          ];
          for (const n of nodes) applied = applyToNode(n) || applied;
        }
      }
      if (!applied) {
        // Heuristic fallback for non-VRM rigs.
        const m = heuristicHumanoidRef.current;
        const nodes = [m.get("spine"), m.get("chest"), m.get("hips")];
        for (const n of nodes) applied = applyToNode(n) || applied;
      }
    }

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
    const applyNormalized = (
      boneName: string,
      x: number,
      y: number,
      z: number
    ) => {
      if (!humanoid) return;
      const node = (humanoid.getNormalizedBoneNode as any)?.(boneName);
      if (!node) return;

      // Some VRMs (notably the Miu avatar) have normalized bone local axes that are
      // permuted/flipped relative to the rest of the avatars. Our procedural sit pose
      // assumes a consistent local axis basis when using Euler(x,y,z).
      //
      // Detect Miu via VRM meta and apply a minimal axis remap for the bones we pose.
      const meta: any = (vrm as any)?.meta;
      const metaTitle = meta?.title || meta?.name || meta?.author || "";
      const isMiu =
        typeof metaTitle === "string" && metaTitle.toLowerCase() === "miu";

      const targetQ = tmpTargetQuatRef.current;

      if (!isMiu) {
        targetQ.setFromEuler(new THREE.Euler(x, y, z));
      } else {
        // Pragmatic fix for Miu: keep the same Euler convention as other avatars,
        // but flip the axes that are mirrored on this specific rig.
        // (This avoids axis-swapping artifacts like sideways/"T-pose" arms.)
        const sign =
          (
            {
              // Legs: fix "knees bend backwards" / legs going behind the bench
              leftUpperLeg: { x: -1, y: 1, z: 1 },
              rightUpperLeg: { x: -1, y: 1, z: 1 },
              leftLowerLeg: { x: -1, y: 1, z: 1 },
              rightLowerLeg: { x: -1, y: 1, z: 1 },
              leftFoot: { x: -1, y: 1, z: 1 },
              rightFoot: { x: -1, y: 1, z: 1 },

              // Arms: fix "hands up" by mirroring the roll that brings arms down
              leftUpperArm: { x: 1, y: 1, z: -1 },
              rightUpperArm: { x: 1, y: 1, z: -1 },
            } as const
          )[boneName] || ({ x: 1, y: 1, z: 1 } as const);

        targetQ.setFromEuler(
          new THREE.Euler(x * sign.x, y * sign.y, z * sign.z)
        );
      }

      // Slerp from current animation state (or rest) to target
      node.quaternion.slerp(targetQ, sitWeight.current);
    };

    // Apply Sit Pose (Normalized)
    if (humanoid) {
      // Procedural breathing/idle noise
      const t = state.clock.elapsedTime;
      const breathe = Math.sin(t * 1.5) * 0.04; // Chest rise/fall
      const sway = Math.sin(t * 0.8) * 0.02; // Slight body sway

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
      fidgetCurrentRef.current.leftArm.lerp(
        fidgetTargetRef.current.leftArm,
        lerpFactor
      );
      fidgetCurrentRef.current.rightArm.lerp(
        fidgetTargetRef.current.rightArm,
        lerpFactor
      );
      fidgetCurrentRef.current.leftLeg.lerp(
        fidgetTargetRef.current.leftLeg,
        lerpFactor
      );
      fidgetCurrentRef.current.rightLeg.lerp(
        fidgetTargetRef.current.rightLeg,
        lerpFactor
      );

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

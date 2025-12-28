"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Plane, Text } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { usePartyRoom as useP2PRoom, type ChatMessage, type Vec3 } from "@/lib/partyRoom";
import { useWASDKeys } from "@/lib/keyboard";
import { PlayerAvatar } from "@/components/player-avatar";
import { getAvatarSystem } from "@/lib/avatarSystem";
import { OutdoorChess } from "@/components/outdoor-chess";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function distSq(a: Vec3, b: Vec3) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function OrganicPath({
  points,
  y = 0.017,
  width = 2.7,
  color = "#4a4038",
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
      const right = new THREE.Vector3(p.x, y, p.z).addScaledVector(side, -halfW);

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
    return g;
  }, [points, y, width]);

  return (
    <mesh geometry={geom} receiveShadow>
      <meshStandardMaterial
        color={color}
        roughness={0.96}
        metalness={0.01}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

function BoardLamp({
  lampPos,
  targetPos,
}: {
  lampPos: [number, number, number];
  targetPos: [number, number, number];
}) {
  const keyRef = useRef<THREE.SpotLight>(null);
  const fillRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    const target = new THREE.Object3D();
    target.position.set(targetPos[0], targetPos[1], targetPos[2]);
    targetRef.current = target;

    const key = keyRef.current;
    const fill = fillRef.current;
    if (key) key.target = target;
    if (fill) fill.target = target;

    return () => {
      targetRef.current = null;
    };
  }, [targetPos]);

  return (
    <>
      <group position={lampPos}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.11, 0.13, 3.2, 12]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.65} metalness={0.25} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 1.65, 0]}>
          <cylinderGeometry args={[0.17, 0.19, 0.18, 12]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.65} metalness={0.25} />
        </mesh>
        <mesh castShadow position={[0, 1.85, 0]}>
          <boxGeometry args={[0.55, 0.55, 0.55]} />
          <meshStandardMaterial
            color="#ffe0b8"
            emissive="#ffb45a"
            emissiveIntensity={0.35}
            roughness={0.35}
            metalness={0}
          />
        </mesh>
        <pointLight
          position={[0, 1.85, 0]}
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
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0002}
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
    shirt, shirtDark, pants, pantsDark, skin, skinLight, skinDark, shoes, shoeSole, 
    hair, hairShine, lips, lipsDark, irisColor, outfitType, skinTone, hairstyleType,
    accent1, accent2, belt, bodyHeight, bodyBuild
  } = useMemo(() => {
    const base = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);

    // Use hue to determine character features for variety
    const hash = Math.floor(hsl.h * 1000);
    
    // Body proportions - height and build variation
    const heightVariation = ((hash * 3) % 20 - 10) / 100; // -0.1 to +0.1
    const bodyHeight = 1 + heightVariation;
    const buildIndex = hash % 3; // 0=slim, 1=average, 2=stocky
    const bodyBuild = buildIndex;
    
    // Diverse realistic skin tones (5 different tones)
    const skinToneIndex = hash % 5;
    const skinTones = [
      { h: 0.08, s: 0.48, l: 0.72 },  // Light peachy
      { h: 0.06, s: 0.38, l: 0.65 },  // Medium light
      { h: 0.07, s: 0.42, l: 0.55 },  // Medium
      { h: 0.05, s: 0.35, l: 0.42 },  // Medium dark
      { h: 0.04, s: 0.32, l: 0.32 },  // Dark
    ];
    const skinTone = skinToneIndex;
    const selectedSkin = skinTones[skinToneIndex];
    const skin = new THREE.Color().setHSL(selectedSkin.h, selectedSkin.s, selectedSkin.l);
    const skinLight = new THREE.Color().setHSL(selectedSkin.h, selectedSkin.s * 0.9, selectedSkin.l * 1.08);
    const skinDark = new THREE.Color().setHSL(selectedSkin.h, selectedSkin.s * 1.05, selectedSkin.l * 0.86);
    
    // Outfit types (casual, formal, dress, suit, sporty)
    const outfitTypeIndex = Math.floor((hash * 7) % 5);
    const outfitType = outfitTypeIndex;
    
    let shirt, shirtDark, pants, pantsDark, accent1, accent2, belt;
    
    if (outfitTypeIndex === 0) {
      // Casual t-shirt and jeans
      const shirtSat = clamp(0.5 + hsl.s * 0.5, 0.5, 0.75);
      const shirtLit = clamp(0.5 + hsl.l * 0.15, 0.5, 0.65);
      shirt = new THREE.Color().setHSL(hsl.h, shirtSat, shirtLit);
      shirtDark = new THREE.Color().setHSL(hsl.h, shirtSat * 0.9, shirtLit * 0.75);
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
      shirtDark = new THREE.Color().setHSL(hsl.h, dressSat * 0.9, dressLit * 0.75);
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
    const shoes = new THREE.Color().setHSL(hsl.h, Math.min(0.2, hsl.s * 0.25), 0.15 + (hash % 30) / 100);
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
    if (bodyBuild === 0) return gender === "female" ? [0.95, 1, 0.95] : [0.92, 1, 0.92]; // slim
    if (bodyBuild === 2) return gender === "female" ? [1.08, 1, 1.08] : [1.12, 1, 1.12]; // stocky
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
            <capsuleGeometry args={gender === "female" ? [0.16, 0.32, 12, 24] : [0.18, 0.35, 12, 24]} />
            <meshStandardMaterial color={shirt} roughness={0.75} metalness={0.02} />
          </mesh>
          
          {/* Chest/bust area - subtle for female */}
          {gender === "female" ? (
            <mesh position={[0, 0.1, 0.07]} castShadow>
              <sphereGeometry args={[0.1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
              <meshStandardMaterial color={shirt} roughness={0.76} />
            </mesh>
          ) : null}

          {/* Arms - Sims 4 style shorter and simpler */}
          <group ref={armLRef} position={gender === "female" ? [-0.22, 0.12, 0] : [-0.24, 0.14, 0]} scale={[armScale, 1, armScale]}>
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

          <group ref={armRRef} position={gender === "female" ? [0.22, 0.12, 0] : [0.24, 0.14, 0]} scale={[armScale, 1, armScale]}>
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
              <sphereGeometry args={[0.28, 24, 20]} scale={[0.95, 1.15, 0.92]} />
              <meshStandardMaterial color={skin} roughness={0.65} />
            </mesh>

            {/* Cheeks - Sims style rounded */}
            <mesh position={[-0.16, -0.04, 0.2]}>
              <sphereGeometry args={[0.08, 14, 12]} />
              <meshStandardMaterial color={lips} transparent opacity={0.12} roughness={1} />
            </mesh>
            <mesh position={[0.16, -0.04, 0.2]}>
              <sphereGeometry args={[0.08, 14, 12]} />
              <meshStandardMaterial color={lips} transparent opacity={0.12} roughness={1} />
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
              <meshStandardMaterial color={skinDark} transparent opacity={0.12} roughness={1} />
            </mesh>
            
            {/* Hair - Sims 4 style VOLUMINOUS and stylized */}
            {gender === "female" ? (
              <>
                {/* Female hair - varied styles based on hairstyleType */}
                {hairstyleType === 0 ? (
                  /* Long flowing hair */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry args={[0.3, 18, 16]} scale={[1, 0.95, 1.05]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.22, 0]} castShadow>
                      <sphereGeometry args={[0.22, 16, 14]} scale={[1.1, 1, 1.1]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[-0.22, 0.05, 0]} castShadow>
                      <sphereGeometry args={[0.15, 14, 12]} scale={[1.2, 1.3, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0.22, 0.05, 0]} castShadow>
                      <sphereGeometry args={[0.15, 14, 12]} scale={[1.2, 1.3, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.02, -0.22]} castShadow>
                      <sphereGeometry args={[0.2, 16, 14]} scale={[1.15, 1.25, 1]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[-0.16, -0.32, -0.1]} rotation={[0.12, 0, 0.15]} castShadow>
                      <capsuleGeometry args={[0.05, 0.62, 12, 16]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0.16, -0.32, -0.1]} rotation={[0.12, 0, -0.15]} castShadow>
                      <capsuleGeometry args={[0.05, 0.62, 12, 16]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, -0.35, -0.18]} rotation={[0.18, 0, 0]} castShadow>
                      <capsuleGeometry args={[0.06, 0.66, 12, 16]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                  </>
                ) : hairstyleType === 1 ? (
                  /* Bun/updo */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry args={[0.29, 18, 16]} scale={[1, 0.92, 1.02]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.18, -0.24]} castShadow>
                      <sphereGeometry args={[0.18, 16, 14]} scale={[1.2, 1.1, 1.2]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.26, -0.22]} castShadow>
                      <sphereGeometry args={[0.14, 14, 12]} scale={[1.15, 1, 1.15]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[-0.12, 0.15, -0.18]} castShadow>
                      <capsuleGeometry args={[0.05, 0.15, 10, 14]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0.12, 0.15, -0.18]} castShadow>
                      <capsuleGeometry args={[0.05, 0.15, 10, 14]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                  </>
                ) : hairstyleType === 2 ? (
                  /* Short pixie cut */
                  <>
                    <mesh position={[0, 0.08, -0.01]} castShadow>
                      <sphereGeometry args={[0.29, 18, 16]} scale={[1, 0.88, 1.06]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.18, 0.08]} castShadow>
                      <sphereGeometry args={[0.16, 16, 14]} scale={[1.2, 0.9, 1.1]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[-0.2, 0.08, 0]} castShadow>
                      <sphereGeometry args={[0.12, 14, 12]} scale={[1.1, 1.05, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0.2, 0.08, 0]} castShadow>
                      <sphereGeometry args={[0.12, 14, 12]} scale={[1.1, 1.05, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                  </>
                ) : (
                  /* Shoulder-length bob */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry args={[0.3, 18, 16]} scale={[1, 0.95, 1.05]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.2, 0]} castShadow>
                      <sphereGeometry args={[0.2, 16, 14]} scale={[1.1, 1, 1.08]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[-0.22, -0.02, 0]} castShadow>
                      <sphereGeometry args={[0.16, 14, 12]} scale={[1.2, 1.4, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0.22, -0.02, 0]} castShadow>
                      <sphereGeometry args={[0.16, 14, 12]} scale={[1.2, 1.4, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, -0.02, -0.22]} castShadow>
                      <sphereGeometry args={[0.18, 16, 14]} scale={[1.15, 1.3, 1]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[-0.14, -0.15, -0.08]} rotation={[0.1, 0, 0.12]} castShadow>
                      <capsuleGeometry args={[0.06, 0.28, 12, 16]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0.14, -0.15, -0.08]} rotation={[0.1, 0, -0.12]} castShadow>
                      <capsuleGeometry args={[0.06, 0.28, 12, 16]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                  </>
                )}

                {/* Top tuft - adds volume without looking like glass */}
                <mesh position={[0, 0.18, 0.12]} castShadow>
                  <sphereGeometry args={[0.13, 12, 10]} scale={[1.25, 0.9, 0.7]} />
                  <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                </mesh>
              </>
            ) : (
              <>
                {/* Male hair - varied styles based on hairstyleType */}
                {hairstyleType === 0 ? (
                  /* Classic short */
                  <>
                    <mesh position={[0, 0.08, -0.01]} castShadow>
                      <sphereGeometry args={[0.28, 18, 16]} scale={[1, 0.85, 1.08]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.2, 0.04]} castShadow>
                      <sphereGeometry args={[0.18, 16, 14]} scale={[1.15, 0.95, 1.1]} />
                      <meshStandardMaterial color={hair} roughness={0.9} />
                    </mesh>
                    <mesh position={[0, 0.15, 0.2]} castShadow>
                      <sphereGeometry args={[0.12, 14, 12]} scale={[1.3, 0.9, 1]} />
                      <meshStandardMaterial color={hair} roughness={0.89} />
                    </mesh>
                  </>
                ) : hairstyleType === 1 ? (
                  /* Slicked back */
                  <>
                    <mesh position={[0, 0.08, -0.02]} castShadow>
                      <sphereGeometry args={[0.28, 18, 16]} scale={[1, 0.82, 1.15]} />
                      <meshStandardMaterial color={hair} roughness={0.7} />
                    </mesh>
                    <mesh position={[0, 0.18, -0.08]} castShadow>
                      <sphereGeometry args={[0.2, 16, 14]} scale={[1.05, 0.9, 1.2]} />
                      <meshStandardMaterial color={hair} roughness={0.65} />
                    </mesh>
                    <mesh position={[0, 0.05, -0.22]} castShadow>
                      <sphereGeometry args={[0.16, 14, 12]} scale={[1.1, 1.05, 1]} />
                      <meshStandardMaterial color={hair} roughness={0.68} />
                    </mesh>
                  </>
                ) : hairstyleType === 2 ? (
                  /* Mohawk/spiky */
                  <>
                    <mesh position={[0, 0.08, 0]} castShadow>
                      <sphereGeometry args={[0.27, 18, 16]} scale={[1, 0.8, 1.05]} />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.26, 0.02]} castShadow>
                      <sphereGeometry args={[0.095, 16, 14]} scale={[0.8, 1.05, 1]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.2, 0.08]} castShadow>
                      <sphereGeometry args={[0.085, 14, 12]} scale={[0.9, 1.05, 0.9]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                    <mesh position={[0, 0.22, -0.06]} castShadow>
                      <sphereGeometry args={[0.09, 14, 12]} scale={[0.85, 1.05, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.32} metalness={0} />
                    </mesh>
                  </>
                ) : (
                  /* Longer messy */
                  <>
                    <mesh position={[0, 0.08, -0.01]} castShadow>
                      <sphereGeometry args={[0.29, 18, 16]} scale={[1, 0.88, 1.08]} />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.2, 0.04]} castShadow>
                      <sphereGeometry args={[0.19, 16, 14]} scale={[1.15, 1, 1.15]} />
                      <meshStandardMaterial color={hair} roughness={0.9} />
                    </mesh>
                    <mesh position={[-0.2, 0.06, 0.02]} castShadow>
                      <sphereGeometry args={[0.14, 14, 12]} scale={[1.15, 1.15, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0.2, 0.06, 0.02]} castShadow>
                      <sphereGeometry args={[0.14, 14, 12]} scale={[1.15, 1.15, 0.95]} />
                      <meshStandardMaterial color={hair} roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.04, -0.22]} castShadow>
                      <sphereGeometry args={[0.17, 14, 12]} scale={[1.2, 1.1, 1]} />
                      <meshStandardMaterial color={hair} roughness={0.87} />
                    </mesh>
                  </>
                )}
                
                {/* Hair shine */}
                <mesh position={[0, 0.16, 0.14]}>
                  <sphereGeometry args={[0.12, 12, 10]} scale={[1.2, 0.7, 0.6]} />
                  <meshStandardMaterial color={hairShine} transparent opacity={0.6} roughness={0.06} metalness={0} />
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
                <meshStandardMaterial color={skinDark} transparent opacity={0.3} roughness={1} />
              </mesh>
              {/* Eye white - larger */}
              <mesh position={[0, 0, 0.02]} castShadow>
                <sphereGeometry args={[0.048, 16, 14]} scale={[1.15, 1, 0.6]} />
                <meshStandardMaterial color="#fefefe" roughness={0.35} />
              </mesh>
              {/* Iris outer ring - adds depth */}
              <mesh position={[0, 0, 0.038]}>
                <sphereGeometry args={[0.035, 18, 16]} scale={[1, 1, 0.35]} />
                <meshStandardMaterial color={irisColor} roughness={0.25} transparent opacity={0.6} />
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
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={1.2} roughness={0} />
              </mesh>
              <mesh position={[0.008, -0.008, 0.056]}>
                <sphereGeometry args={[0.006, 8, 6]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.7} roughness={0} transparent opacity={0.8} />
              </mesh>
              {/* Upper eyelid */}
              <mesh position={[0, 0.028, 0.032]} rotation={[0.15, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.027, 0.064, 8, 12]} />
                <meshStandardMaterial color={skinDark} transparent opacity={0.55} roughness={0.75} />
              </mesh>
              {/* Lower eyelid */}
              <mesh position={[0, -0.022, 0.028]} rotation={[-0.1, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.024, 0.058, 8, 12]} />
                <meshStandardMaterial color={skin} transparent opacity={0.4} roughness={0.8} />
              </mesh>

              {/* Eyelashes (female) */}
              {gender === "female" ? (
                <mesh position={[0.006, 0.028, 0.06]} rotation={[0.1, 0, Math.PI / 2 - 0.25]}>
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
                <meshStandardMaterial color={skinDark} transparent opacity={0.3} roughness={1} />
              </mesh>
              {/* Eye white - larger */}
              <mesh position={[0, 0, 0.02]} castShadow>
                <sphereGeometry args={[0.048, 16, 14]} scale={[1.15, 1, 0.6]} />
                <meshStandardMaterial color="#fefefe" roughness={0.35} />
              </mesh>
              {/* Iris outer ring - adds depth */}
              <mesh position={[0, 0, 0.038]}>
                <sphereGeometry args={[0.035, 18, 16]} scale={[1, 1, 0.35]} />
                <meshStandardMaterial color={irisColor} roughness={0.25} transparent opacity={0.6} />
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
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={1.2} roughness={0} />
              </mesh>
              <mesh position={[0.008, -0.008, 0.056]}>
                <sphereGeometry args={[0.006, 8, 6]} />
                <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.7} roughness={0} transparent opacity={0.8} />
              </mesh>
              {/* Upper eyelid */}
              <mesh position={[0, 0.028, 0.032]} rotation={[0.15, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.027, 0.064, 8, 12]} />
                <meshStandardMaterial color={skinDark} transparent opacity={0.55} roughness={0.75} />
              </mesh>
              {/* Lower eyelid */}
              <mesh position={[0, -0.022, 0.028]} rotation={[-0.1, 0, Math.PI / 2]}>
                <capsuleGeometry args={[0.024, 0.058, 8, 12]} />
                <meshStandardMaterial color={skin} transparent opacity={0.4} roughness={0.8} />
              </mesh>

              {/* Eyelashes (female) */}
              {gender === "female" ? (
                <mesh position={[0.006, 0.028, 0.06]} rotation={[0.1, 0, Math.PI / 2 - 0.25]}>
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
              <sphereGeometry args={[0.048, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} scale={[1.2, 0.75, 0.8]} />
              <meshStandardMaterial color={lips} roughness={0.5} />
            </mesh>
            {/* Lip definition */}
            <mesh position={[0, -0.132, 0.256]} rotation={[1.35, 0, Math.PI / 2]}>
              <capsuleGeometry args={[0.006, 0.052, 6, 10]} />
              <meshStandardMaterial color={lipsDark} transparent opacity={0.6} roughness={0.6} />
            </mesh>
            {/* Lip shine */}
            <mesh position={[0, -0.14, 0.26]}>
              <sphereGeometry args={[0.022, 12, 10]} scale={[1.3, 0.6, 0.5]} />
              <meshStandardMaterial color="white" transparent opacity={0.2} roughness={0.2} />
            </mesh>

            {/* Chin - Sims style rounded */}
            <mesh position={[0, -0.2, 0.2]} castShadow>
              <sphereGeometry args={[0.065, 14, 12]} scale={[1, 1.1, 0.9]} />
              <meshStandardMaterial color={skin} transparent opacity={0.35} roughness={0.7} />
            </mesh>
          </group>
        </group>

        {/* Legs - Sims 4 style shorter and more stylized */}
        <group ref={legLRef} position={[-0.09, 0.02, 0]} scale={[legScale, 1, legScale]}>
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
          <mesh position={[0, -0.69, 0.06]} rotation={[-0.1, 0, Math.PI / 2]} castShadow>
            <capsuleGeometry args={[0.055, 0.11, 10, 14]} />
            <meshStandardMaterial color={shoes} roughness={0.68} />
          </mesh>
          <mesh position={[0, -0.72, 0.11]} castShadow>
            <sphereGeometry args={[0.058, 12, 12]} scale={[1, 0.8, 1.3]} />
            <meshStandardMaterial color={shoes} roughness={0.7} />
          </mesh>
        </group>

        <group ref={legRRef} position={[0.09, 0.02, 0]} scale={[legScale, 1, legScale]}>
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
          <mesh position={[0, -0.69, 0.06]} rotation={[-0.1, 0, Math.PI / 2]} castShadow>
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
}: {
  color: string;
  name: string;
  pos: React.RefObject<THREE.Vector3>;
  rotY: React.RefObject<number>;
  speed: React.RefObject<number>;
  gender: "male" | "female";
  avatarUrl?: string;
  sittingRef?: React.RefObject<boolean>;
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
    // Smooth rotation with lerp
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rotY.current, 0.15);
    setMovingSpeed(speed.current);

    const nextPose = sittingRef?.current ? "sit" : "stand";
    if (nextPose !== lastPoseRef.current) {
      lastPoseRef.current = nextPose;
      setPose(nextPose);
    }
  });

  return (
    <group ref={groupRef}>
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
    targetRef.current.set(targetPosition[0], targetPosition[1], targetPosition[2]);
    posRef.current.lerp(targetRef.current, alpha);
    // shortest angle lerp
    const d =
      ((targetRotY - rotRef.current + Math.PI) % (Math.PI * 2)) - Math.PI;
    rotRef.current = rotRef.current + d * alpha;

    g.position.set(posRef.current.x, posRef.current.y, posRef.current.z);
    // Apply smooth rotation to visual
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rotRef.current, 0.2);

    // estimate speed
    const dx = posRef.current.x - lastPosRef.current.x;
    const dy = posRef.current.y - lastPosRef.current.y;
    const dz = posRef.current.z - lastPosRef.current.z;
    const sp = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.0001, dt);
    speedRef.current = THREE.MathUtils.lerp(speedRef.current, sp, clamp(dt * 8, 0, 1));
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

      {bubbleText ? (
        <Billboard position={[0, 2.65, 0]}>
          <Text
            fontSize={0.2}
            color="#ffffff"
            outlineWidth={0.012}
            outlineColor="rgba(0,0,0,0.75)"
            anchorX="center"
            anchorY="bottom"
            maxWidth={4.6}
            textAlign="center"
          >
            {bubbleText}
          </Text>
        </Billboard>
      ) : null}

      <PlayerAvatar id={id} movingSpeed={movingSpeed} gender={gender} url={avatarUrl} />
    </group>
  );
}

function FollowCamera({ target }: { target: React.RefObject<THREE.Vector3> }) {
  const { gl } = useThree();
  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  // Camera orbit state (spherical)
  const thetaRef = useRef(0); // azimuth around Y
  const phiRef = useRef(1.06); // polar from +Y (matches ~[0,4.5,8])
  const radiusRef = useRef(9.2);

  useEffect(() => {
    const el = gl.domElement;
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      // Right mouse button only
      if (e.button !== 2) return;
      draggingRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      draggingRef.current = false;
      lastRef.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const last = lastRef.current;
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      lastRef.current = { x: e.clientX, y: e.clientY };

      const rotSpeed = 0.004;
      thetaRef.current -= dx * rotSpeed;
      phiRef.current = clamp(phiRef.current + dy * rotSpeed, 0.45, 1.45);
    };

    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointermove", onMove);

    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointermove", onMove);
    };
  }, [gl]);

  useFrame(({ camera }, dt) => {
    const t = target.current;
    if (!t) return;

    const offset = new THREE.Vector3().setFromSphericalCoords(
      radiusRef.current,
      phiRef.current,
      thetaRef.current
    );
    const desired = new THREE.Vector3(t.x, t.y, t.z).add(offset);
    camera.position.lerp(desired, clamp(dt * 6, 0, 1));
    camera.lookAt(t.x, t.y + 1.0, t.z);
  });

  return null;
}

const DEBUG_AVATAR_URLS = {
  male: "/three-avatar/avatars/adam.vrm",
  kawaiiOptimized5mb: "/three-avatar/avatars/kawaii_optimized_5mb.vrm",
  renOptimized7mb: "/three-avatar/avatars/ren_optimized_7mb.vrm",
  vrmV1: "/three-avatar/asset/avatar-example/vrm-v1.vrm",
  vrmV0: "/three-avatar/asset/avatar-example/vrm-v0.vrm",
  rpm: "/three-avatar/asset/avatar-example/rpm.glb",
} as const;

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
}: {
  enabled: boolean;
  keysRef: ReturnType<typeof useWASDKeys>;
  pos: React.RefObject<THREE.Vector3>;
  rotY: React.RefObject<number>;
  lastSent: React.RefObject<{ t: number; p: Vec3; r: number }>;
  sendSelfState: (position: Vec3, rotY: number) => void;
  speedRef: React.RefObject<number>;
  moveTargetRef: React.RefObject<
    | {
        dest: Vec3;
        rotY?: number;
        sit?: boolean;
      }
    | null
  >;
  sittingRef: React.RefObject<boolean>;
}) {
  const vRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const camDirRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const forwardRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const rightRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const upRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
  const lastPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
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
      if (sittingRef.current && process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[sit] canceled via keyboard");
      }
      sittingRef.current = false;
    }

    // If we're sitting, ignore movement until user provides input or click-to-move sets a target.
    if (sittingRef.current && !hasKeyboardInput && !moveTargetRef.current) {
      speedRef.current = THREE.MathUtils.lerp(speedRef.current, 0, clamp(dt * 10, 0, 1));
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
      v.copy(forward).multiplyScalar(inputForward).addScaledVector(right, inputRight);
    } else if (moveTargetRef.current) {
      const d = moveTargetRef.current.dest;
      v.set(d[0] - pos.current.x, 0, d[2] - pos.current.z);
      const dist = v.length();
      if (dist < 0.25) {
        // Snap to target and optionally sit.
        pos.current.set(d[0], pos.current.y, d[2]);
        if (typeof moveTargetRef.current.rotY === "number") {
          rotY.current = moveTargetRef.current.rotY;
        }
        if (moveTargetRef.current.sit) {
          if (!sittingRef.current && process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.log("[sit] entered (arrived)");
          }
          sittingRef.current = true;
        }
        moveTargetRef.current = null;
        v.set(0, 0, 0);
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
    speedRef.current = THREE.MathUtils.lerp(speedRef.current, sp, clamp(dt * 10, 0, 1));
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

export default function World({
  roomId,
  onExit,
  initialName,
  initialGender = "male",
}: {
  roomId: string;
  onExit: () => void;
  initialName?: string;
  initialGender?: "male" | "female";
}) {
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
  } = useP2PRoom(roomId, { initialName, initialGender });
  const keysRef = useWASDKeys();

  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [bubbles, setBubbles] = useState<Record<string, { text: string; until: number }>>({});
  const lastSeenChatIdRef = useRef<string>("");

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const last = chat[chat.length - 1];
    if (!last) return;
    if (last.id === lastSeenChatIdRef.current) return;
    lastSeenChatIdRef.current = last.id;

    setBubbles((prev) => ({
      ...prev,
      [last.fromId]: { text: last.text, until: Date.now() + 4500 },
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
  const [debugAvatarUrl, setDebugAvatarUrl] = useState<string>(
    DEBUG_AVATAR_URLS.vrmV1
  );

  // If the user hasn't changed the selector yet, default males to the male avatar.
  useEffect(() => {
    if (avatarSystem !== "three-avatar") return;
    if (!self) return;
    if (debugAvatarUrl !== DEBUG_AVATAR_URLS.vrmV1) return;
    if (self.gender === "male") {
      setDebugAvatarUrl(DEBUG_AVATAR_URLS.male);
      setAvatarUrl(DEBUG_AVATAR_URLS.male);
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

  const moveTargetRef = useRef<
    | {
        dest: Vec3;
        rotY?: number;
        sit?: boolean;
      }
    | null
  >(null);
  const sittingRef = useRef<boolean>(false);
  const sitDebugRef = useRef<{ requested: number }>({ requested: 0 });

  const [joinedBoardKey, setJoinedBoardKey] = useState<string | null>(null);
  const [pendingJoinBoardKey, setPendingJoinBoardKey] = useState<string | null>(null);
  const joinLockedBoardKey = joinedBoardKey ?? pendingJoinBoardKey;

  useEffect(() => {
    if (!pendingJoinBoardKey) return;
    if (joinedBoardKey) {
      setPendingJoinBoardKey(null);
      return;
    }

    const t = window.setTimeout(() => {
      setPendingJoinBoardKey((cur) => (cur === pendingJoinBoardKey ? null : cur));
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
        console.error("[World] Unhandled rejection:", reason.message, reason.stack);
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

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        dpr={[1, 1]}
        camera={{ position: [0, 5, 8], fov: 60 }}
        gl={{ antialias: false }}
        style={{ background: "#b98a63" }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color("#b98a63"), 1);
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
          }}
        >
          {/* Cozy garden plaza lighting (sunset) */}
          <ambientLight intensity={0.28} color="#ffe8c8" />
          <hemisphereLight intensity={0.35} groundColor="#35513a" color="#ffd1a1" />

          {/* Low-angle golden sun */}
          <directionalLight
            intensity={1.05}
            position={[10, 16, 6]}
            color="#ffd5ab"
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-camera-far={70}
            shadow-camera-left={-28}
            shadow-camera-right={28}
            shadow-camera-top={28}
            shadow-camera-bottom={-28}
            shadow-bias={-0.00015}
          />

          {/* Cool fill to keep silhouettes readable */}
          <directionalLight intensity={0.25} position={[-18, 18, -12]} color="#b9d6ff" />

          {/* Warm haze */}
          <fog attach="fog" args={["#d6a57d", 30, 120]} />

          {/* Ground: grass base */}
          <Plane args={[220, 220]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <meshStandardMaterial color="#263626" roughness={1} metalness={0} />
          </Plane>

          {/* Main plaza path (stone-ish) */}
          <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[22, 72]} />
            <meshStandardMaterial
              color="#4a4038"
              roughness={0.95}
              metalness={0.02}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </mesh>

        {/* Subtle ring path near the edge for depth */}
        <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <ringGeometry args={[26, 30, 80]} />
          <meshStandardMaterial
            color="#3b332f"
            roughness={0.98}
            metalness={0.01}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>

        {/* Organic pathways (curved ribbons) */}
        <OrganicPath
          points={[
            [-18, -8],
            [-12, -14],
            [-4, -16],
            [6, -14],
            [16, -10],
          ]}
          width={2.5}
          color="#4a4038"
        />
        <OrganicPath
          points={[
            [-16, 10],
            [-10, 14],
            [-2, 16],
            [8, 14],
            [14, 10],
          ]}
          width={2.1}
          color="#463d36"
        />
        <OrganicPath
          points={[
            [18, -14],
            [14, -10],
            [12, -4],
            [14, 4],
            [18, 10],
          ]}
          width={1.8}
          color="#3f3832"
        />

        {/* Small grass variation patches (subtle, helps the ground feel less flat) */}
        {Array.from({ length: 18 }).map((_, i) => {
          const x = ((i * 37) % 34) - 17;
          const z = (((i * 61) % 34) - 17);
          const r = 0.9 + (i % 5) * 0.22;
          const c = i % 3 === 0 ? "#223222" : i % 3 === 1 ? "#2a3b2a" : "#1f2f22";
          return (
            <mesh
              key={i}
              position={[x, 0.003, z]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
            >
              <circleGeometry args={[r, 24]} />
              <meshStandardMaterial
                color={c}
                roughness={1}
                metalness={0}
                polygonOffset
                polygonOffsetFactor={-1}
                polygonOffsetUnits={-1}
              />
            </mesh>
          );
        })}

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
                <meshStandardMaterial color="#2b2a26" roughness={0.95} metalness={0.02} />
              </mesh>
              {/* Soil bed */}
              <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
                <boxGeometry args={[4.2, 0.32, 0.95]} />
                <meshStandardMaterial color="#1f2f22" roughness={1} metalness={0} />
              </mesh>

              {/* Bush clusters */}
              {[-1.55, -0.55, 0.55, 1.55].map((bx, bi) => (
                <group key={bi} position={[bx, 0.62, (bi % 2 === 0 ? -0.18 : 0.16)]}>
                  <mesh castShadow>
                    <sphereGeometry args={[0.32 + (bi % 2) * 0.06, 12, 10]} />
                    <meshStandardMaterial color={bi % 2 === 0 ? "#2c5a33" : "#3a7436"} roughness={1} />
                  </mesh>
                  <mesh castShadow position={[0.18, 0.06, 0.12]}>
                    <sphereGeometry args={[0.24, 12, 10]} />
                    <meshStandardMaterial color="#2a4f2a" roughness={1} />
                  </mesh>
                </group>
              ))}

              {/* Tiny flowers along the front edge */}
              {Array.from({ length: 7 }).map((__, fi) => (
                <mesh key={fi} position={[-1.8 + fi * 0.6, 0.61, 0.42]}>
                  <sphereGeometry args={[0.04, 8, 8]} />
                  <meshStandardMaterial
                    color={i % 2 === 0 ? (fi % 2 === 0 ? "#ffd6e7" : "#fff1b8") : (fi % 2 === 0 ? "#cfe8ff" : "#ffe1bf")}
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
                <meshStandardMaterial color="#232323" roughness={0.7} metalness={0.2} />
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
        {Array.from({ length: 10 }).map((_, i) => {
          const angle = (i / 10) * Math.PI * 2;
          const radius = 28;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const h = 3.2 + (i % 3) * 0.4;
          return (
            <group key={i} position={[x, 0, z]}>
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.25, 0.32, h, 10]} />
                <meshStandardMaterial color="#2a1f17" roughness={1} metalness={0} />
              </mesh>
              <mesh position={[0, h * 0.65, 0]} castShadow>
                <sphereGeometry args={[1.4 + (i % 2) * 0.2, 14, 12]} />
                <meshStandardMaterial color="#1f3a25" roughness={1} metalness={0} />
              </mesh>
              <mesh position={[0.65, h * 0.62, 0.2]} castShadow>
                <sphereGeometry args={[1.05, 14, 12]} />
                <meshStandardMaterial color="#214028" roughness={1} metalness={0} />
              </mesh>
              <mesh position={[-0.6, h * 0.6, -0.1]} castShadow>
                <sphereGeometry args={[1.1, 14, 12]} />
                <meshStandardMaterial color="#1b341f" roughness={1} metalness={0} />
              </mesh>
            </group>
          );
        })}

        {boards.map((b) => (
          <group key={b.key}>
            <BoardLamp
              lampPos={[
                b.origin[0] + (b.origin[0] < 0 ? -5.8 : 5.8),
                0,
                b.origin[2] + (b.origin[2] < 0 ? -4.8 : 4.8),
              ]}
              targetPos={[b.origin[0], 0.2, b.origin[2]]}
            />
            <Suspense fallback={null}>
              <OutdoorChess
                roomId={roomId}
                boardKey={b.key}
                origin={b.origin}
                selfPositionRef={selfPosRef}
                selfId={self?.id || ""}
                selfName={self?.name || ""}
                joinLockedBoardKey={joinLockedBoardKey}
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
                  setPendingJoinBoardKey((prev) => (prev === boardKey ? null : prev));
                }}
                onRequestMove={(dest, opts) => {
                  moveTargetRef.current = { dest, rotY: opts?.rotY, sit: opts?.sit };
                  if (opts?.sit) {
                    if (!sittingRef.current && process.env.NODE_ENV !== "production") {
                      sitDebugRef.current.requested++;
                      // eslint-disable-next-line no-console
                      console.log("[sit] requested", sitDebugRef.current.requested);
                    }
                    sittingRef.current = true;
                  } else {
                    sittingRef.current = false;
                  }
                }}
              />
            </Suspense>
          </group>
        ))}

        <FollowCamera target={selfPosRef} />

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
              avatarUrl={avatarSystem === "three-avatar" ? debugAvatarUrl : undefined}
              sittingRef={sittingRef}
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
            </div>            <button
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

      {/* UI overlay */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(127,127,127,0.25)",
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, opacity: 0.9 }}>Room: {roomId}</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Players: {peerCount + 1}/20 • Move: WASD / arrows
          </div>

          {avatarSystem === "three-avatar" ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                opacity: 0.85,
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>Avatar (debug)</span>
              <select
                value={debugAvatarUrl}
                onChange={(e) => {
                  const next = e.target.value;
                  setDebugAvatarUrl(next);
                  setAvatarUrl(next);
                }}
                style={{
                  background: "rgba(0,0,0,0.35)",
                  color: "white",
                  border: "1px solid rgba(127,127,127,0.35)",
                  borderRadius: 8,
                  padding: "4px 8px",
                  outline: "none",
                }}
              >
                <option value={DEBUG_AVATAR_URLS.male}>Male (custom)</option>
                <option value={DEBUG_AVATAR_URLS.kawaiiOptimized5mb}>
                  Kawaii (optimized)
                </option>
                <option value={DEBUG_AVATAR_URLS.renOptimized7mb}>
                  Ren (optimized ~7MB)
                </option>
                <option value={DEBUG_AVATAR_URLS.vrmV1}>
                  VRM v1
                </option>
                <option value={DEBUG_AVATAR_URLS.vrmV0}>
                  VRM v0
                </option>
                <option value={DEBUG_AVATAR_URLS.rpm}>
                  Ready Player Me
                </option>
              </select>
            </label>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {hudPlayers.slice(0, 10).map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  opacity: 0.85,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: p.color,
                    flex: "0 0 auto",
                  }}
                />
                <div style={{ whiteSpace: "nowrap" }}>
                  {p.name || p.id.slice(0, 4)}{self?.id === p.id ? " (you)" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        <input
          value={nameInput}
          placeholder="Your name"
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const cleaned = nameInput.trim().slice(0, 24);
            setName(cleaned);
            try {
              window.sessionStorage.setItem("pawnsquare:name", cleaned);
            } catch {
              // ignore
            }
            (e.currentTarget as HTMLInputElement).blur();
          }}
          onBlur={() => {
            const cleaned = nameInput.trim().slice(0, 24);
            setName(cleaned);
            try {
              window.sessionStorage.setItem("pawnsquare:name", cleaned);
            } catch {
              // ignore
            }
          }}
          style={{
            pointerEvents: "auto",
            height: 34,
            width: 160,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid rgba(127,127,127,0.25)",
            background: "transparent",
            color: "inherit",
            outline: "none",
          }}
        />

        <button
          style={{
            pointerEvents: "auto",
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid rgba(127,127,127,0.25)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(roomLink);
              setCopied(true);
            } catch {
              // ignore
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>

        <button
          style={{
            pointerEvents: "auto",
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid rgba(127,127,127,0.25)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
          onClick={onExit}
        >
          Exit
        </button>
      </div>

      <div
        style={{
          position: "fixed",
          left: 12,
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
              <span style={{ opacity: 0.9, fontWeight: 600 }}>{m.fromName}:</span>{" "}
              <span style={{ opacity: 0.95 }}>{m.text}</span>
            </div>
          ))}
        </div>

        <input
          value={chatInput}
          placeholder={connected ? "Chat..." : "Connecting..."}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (!connected) return;
            const cleaned = chatInput.trim().slice(0, 160);
            if (!cleaned) return;
            sendChat(cleaned);
            setChatInput("");
          }}
          style={{
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid rgba(127,127,127,0.25)",
            background: "transparent",
            color: "inherit",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

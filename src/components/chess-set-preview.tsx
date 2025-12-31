"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

function CameraResetOnThemeChange({
  chessTheme,
  controlsRef,
  target = [0, 0.55, 0],
}: {
  chessTheme: string;
  controlsRef: React.MutableRefObject<any>;
  target?: [number, number, number];
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 1.25, 3.1);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
      if (typeof controls.saveState === "function") controls.saveState();
    }
  }, [chessTheme, camera, controlsRef, target]);
  return null;
}

function applyFresnelRim(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  rimColor: THREE.Color,
  rimPower = 2.25,
  rimIntensity = 0.65
) {
  material.onBeforeCompile = (shader) => {
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

function ThemedPiece({
  path,
  chessTheme,
  side,
  position,
  rotation,
  scale = 1,
}: {
  path: string;
  chessTheme: string;
  side: "w" | "b";
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}) {
  const gltf = useGLTF(path) as any;

  const obj = useMemo(() => {
    const root: THREE.Object3D = gltf.scene.clone(true);

    const classicWhite = new THREE.Color("#e8e8e8");
    const classicBlack = new THREE.Color("#1c1c1c");

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;

      const srcMat = mesh.material as any;
      if (!srcMat || !srcMat.isMaterial) return;

      mesh.material = srcMat.clone();
      const mat = mesh.material as any;

      if (mat.color && mat.color.isColor) {
        mat.color = mat.color.clone();
      }

      const isWhite = side === "w";

      if (chessTheme === "chess_glass") {
        const base = isWhite
          ? new THREE.Color("#d7f0ff")
          : new THREE.Color("#0b1220");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#7dd3ff");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 0.0;
        if (typeof mat.roughness === "number")
          mat.roughness = isWhite ? 0.35 : 0.12;
        mat.transparent = true;
        mat.opacity = isWhite ? 0.42 : 0.28;
        mat.depthWrite = false;
        if (mat.emissive && mat.emissive.isColor) {
          mat.emissive = mat.emissive.clone();
          mat.emissive.copy(rim);
          mat.emissiveIntensity = isWhite ? 0.08 : 0.12;
        }
        if (typeof mat.envMapIntensity === "number") mat.envMapIntensity = 1.0;
        applyFresnelRim(mat, rim, 2.0, isWhite ? 0.55 : 0.75);
      } else if (chessTheme === "chess_gold") {
        const base = isWhite
          ? new THREE.Color("#dfe6ef")
          : new THREE.Color("#d4af37");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#fff2b0");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 1.0;
        if (typeof mat.roughness === "number")
          mat.roughness = isWhite ? 0.18 : 0.22;
        if (mat.emissive && mat.emissive.isColor) {
          mat.emissive = mat.emissive.clone();
          mat.emissive.copy(rim);
          mat.emissiveIntensity = isWhite ? 0.02 : 0.06;
        }
        if (typeof mat.envMapIntensity === "number") mat.envMapIntensity = 1.0;
        applyFresnelRim(mat, rim, 2.6, isWhite ? 0.28 : 0.42);
      } else if (chessTheme === "chess_wood") {
        const base = isWhite
          ? new THREE.Color("#e1c28b")
          : new THREE.Color("#8a6a1b");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 0.05;
        if (typeof mat.roughness === "number") mat.roughness = 0.85;
        if (typeof mat.envMapIntensity === "number") mat.envMapIntensity = 0.35;
      } else {
        const base = isWhite ? classicWhite : classicBlack;
        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 0.7;
        if (typeof mat.roughness === "number") mat.roughness = 0.3;
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    root.rotation.set(Math.PI / 2, 0, 0);
    // Center on X/Z and rest on floor.
    root.updateWorldMatrix(true, true);
    let box = new THREE.Box3().setFromObject(root);
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
      box = new THREE.Box3().setFromObject(root);
    }

    // Normalize size so the preview is consistently large.
    const size = box.getSize(new THREE.Vector3());
    const desiredHeight = 1.05;
    const h = Math.max(1e-4, size.y);
    const s = (desiredHeight / h) * scale;
    root.scale.setScalar(s);
    root.updateWorldMatrix(true, true);

    // Re-center after scaling.
    box = new THREE.Box3().setFromObject(root);
    if (
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.min.y) &&
      Number.isFinite(box.min.z)
    ) {
      const center2 = box.getCenter(new THREE.Vector3());
      root.position.x -= center2.x;
      root.position.z -= center2.z;
      root.position.y -= box.min.y;
      root.updateWorldMatrix(true, true);
    }

    return root;
  }, [gltf, chessTheme, scale, side]);

  return (
    <group position={position} rotation={rotation}>
      <primitive object={obj} />
    </group>
  );
}

function PreviewFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color="#555" roughness={0.8} metalness={0.1} />
    </mesh>
  );
}

function PreviewScene({
  chessTheme,
  autoRotate,
  setAutoRotate,
  resumeTimerRef,
  controlsRef,
}: {
  chessTheme: string;
  autoRotate: boolean;
  setAutoRotate: (v: boolean) => void;
  resumeTimerRef: React.MutableRefObject<number | null>;
  controlsRef: React.MutableRefObject<any>;
}) {
  const modelPath = "/models/knight.glb";
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 2]} intensity={1.1} />
      <directionalLight position={[-3, 4, -2]} intensity={0.6} />

      <CameraResetOnThemeChange
        chessTheme={chessTheme}
        controlsRef={controlsRef}
      />

      <ThemedPiece
        path={modelPath}
        chessTheme={chessTheme}
        side="w"
        position={[-0.48, 0, 0]}
        rotation={[0, 0.25, 0]}
        scale={0.95}
      />

      <ThemedPiece
        path={modelPath}
        chessTheme={chessTheme}
        side="b"
        position={[0.48, 0, 0]}
        rotation={[0, -0.25, 0]}
        scale={0.95}
      />

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={false}
        target={[0, 0.55, 0]}
        minPolarAngle={0.9}
        maxPolarAngle={1.35}
        enableDamping
        dampingFactor={0.08}
        autoRotate={autoRotate}
        // Match the previous dt*0.55 orbit speed.
        autoRotateSpeed={5.3}
        onStart={() => {
          setAutoRotate(false);
          if (resumeTimerRef.current !== null) {
            window.clearTimeout(resumeTimerRef.current);
            resumeTimerRef.current = null;
          }
        }}
        onEnd={() => {
          if (resumeTimerRef.current !== null) {
            window.clearTimeout(resumeTimerRef.current);
          }
          resumeTimerRef.current = window.setTimeout(() => {
            setAutoRotate(true);
            resumeTimerRef.current = null;
          }, 3000);
        }}
      />
    </>
  );
}

export function ChessSetPreview({ chessTheme }: { chessTheme: string }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 1.25, 3.1], fov: 32 }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={<PreviewFallback />}>
        <PreviewSceneWithDrag chessTheme={chessTheme} />
      </Suspense>
    </Canvas>
  );
}

function PreviewSceneWithDrag({ chessTheme }: { chessTheme: string }) {
  const [autoRotate, setAutoRotate] = useState(true);
  const controlsRef = useRef<any>(null);
  const resumeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setAutoRotate(true);
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [chessTheme]);

  return (
    <PreviewScene
      chessTheme={chessTheme}
      autoRotate={autoRotate}
      setAutoRotate={setAutoRotate}
      resumeTimerRef={resumeTimerRef}
      controlsRef={controlsRef}
    />
  );
}

useGLTF.preload("/models/knight.glb");

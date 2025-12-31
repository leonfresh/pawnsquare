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
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      // onBeforeCompile is a method on Material; preserve `this`.
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

function applyFrostedGlassShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { scale?: number; strength?: number }
) {
  const scale = opts?.scale ?? 18.0;
  const strength = opts?.strength ?? 0.22;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    try {
      (prev as any).call(material as any, shader, renderer);
    } catch {
      // ignore
    }

    shader.uniforms.uFrostScale = { value: scale };
    shader.uniforms.uFrostStrength = { value: strength };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vFrostWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvec4 wsPosF = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwsPosF = instanceMatrix * wsPosF;\n#endif\nwsPosF = modelMatrix * wsPosF;\nvFrostWorldPos = wsPosF.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vFrostWorldPos;\nuniform float uFrostScale;\nuniform float uFrostStrength;\nfloat frostHash(vec2 p){\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\nfloat nF = frostHash(vFrostWorldPos.xz * uFrostScale);\nroughnessFactor = clamp(roughnessFactor + (nF - 0.5) * uFrostStrength, 0.02, 1.0);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat nC = frostHash((vFrostWorldPos.zy + vFrostWorldPos.xz) * (uFrostScale * 0.65));\nfloat cloud = mix(0.90, 1.02, nC);\ndiffuseColor.rgb *= cloud;\ndiffuseColor.a *= mix(0.92, 1.02, nC);`
      )
      .replace(
        "#include <output_fragment>",
        `float ndvF = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);\nfloat absorb = mix(0.92, 1.0, pow(1.0 - ndvF, 1.6));\noutgoingLight *= absorb;\n#include <output_fragment>`
      );
  };

  material.needsUpdate = true;
}

function applyWoodGrainShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { scale?: number; intensity?: number }
) {
  const scale = opts?.scale ?? 9.5;
  const intensity = opts?.intensity ?? 0.22;

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
        `#include <common>\nvarying vec3 vWorldPos;\nuniform float uWoodScale;\nuniform float uWoodIntensity;\nfloat woodNoise(vec2 p){\n  float n = 0.0;\n  n += sin(p.x * 1.9 + sin(p.y * 1.2)) * 0.55;\n  n += sin(p.x * 3.7 + p.y * 0.7) * 0.25;\n  n += sin(p.x * 8.1 - p.y * 2.3) * 0.12;\n  return n * 0.5 + 0.5;\n}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nvec2 wp = vWorldPos.xz * uWoodScale;\nfloat n = woodNoise(wp);\nfloat grain = smoothstep(0.25, 0.85, n);\nfloat rings = sin((vWorldPos.x + vWorldPos.z) * uWoodScale * 0.35 + n * 3.14);\nrings = rings * 0.5 + 0.5;\nfloat streak = smoothstep(0.2, 0.95, rings);\nfloat shade = mix(0.88, 1.08, grain) * mix(0.92, 1.06, streak);\ndiffuseColor.rgb *= mix(1.0, shade, uWoodIntensity);`
      );
  };

  material.needsUpdate = true;
}

function applyBrushedMetalShader(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  opts?: { strength?: number; scale?: number }
) {
  const strength = opts?.strength ?? 0.05;
  const scale = opts?.scale ?? 10.0;

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
        `#include <common>\nvarying vec3 vWorldPos2;\nuniform float uMetalVarStrength;\nuniform float uMetalVarScale;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\nfloat v = sin((vWorldPos2.x + vWorldPos2.z) * uMetalVarScale) * 0.5 + 0.5;\nroughnessFactor = clamp(roughnessFactor + (v - 0.5) * uMetalVarStrength, 0.02, 1.0);`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat c = sin((vWorldPos2.x - vWorldPos2.z) * uMetalVarScale * 0.6) * 0.5 + 0.5;\ndiffuseColor.rgb *= (1.0 + (c - 0.5) * (uMetalVarStrength * 0.9));`
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
          ? new THREE.Color("#cfefff")
          : new THREE.Color("#07101d");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#bfe7ff");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 0.0;
        if (typeof mat.roughness === "number")
          mat.roughness = isWhite ? 0.62 : 0.48;
        mat.transparent = true;
        mat.opacity = isWhite ? 0.68 : 0.58;
        mat.depthWrite = true;
        (mat as any).premultipliedAlpha = true;
        if (mat.emissive && mat.emissive.isColor) {
          mat.emissive = mat.emissive.clone();
          mat.emissive.copy(rim);
          mat.emissiveIntensity = isWhite ? 0.02 : 0.04;
        }
        if (typeof mat.envMapIntensity === "number") mat.envMapIntensity = 0.65;
        applyFrostedGlassShader(mat, {
          scale: 22.0,
          strength: isWhite ? 0.20 : 0.24,
        });
        applyFresnelRim(mat, rim, 2.4, isWhite ? 0.33 : 0.38);
      } else if (chessTheme === "chess_gold") {
        const base = isWhite
          ? new THREE.Color("#d8dee6")
          : new THREE.Color("#ffd15a");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#fff0c2");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number")
          mat.metalness = isWhite ? 0.72 : 0.9;
        if (typeof mat.roughness === "number")
          mat.roughness = isWhite ? 0.34 : 0.2;
        if (mat.emissive && mat.emissive.isColor) {
          mat.emissive = mat.emissive.clone();
          mat.emissive.copy(rim);
          mat.emissiveIntensity = isWhite ? 0.04 : 0.08;
        }
        if (typeof mat.envMapIntensity === "number")
          mat.envMapIntensity = isWhite ? 1.1 : 1.25;
        applyBrushedMetalShader(mat, {
          strength: isWhite ? 0.04 : 0.05,
          scale: 12.0,
        });
        applyFresnelRim(mat, rim, 2.8, isWhite ? 0.24 : 0.28);
      } else if (chessTheme === "chess_wood") {
        const base = isWhite
          ? new THREE.Color("#e1c28b")
          : new THREE.Color("#8a6a1b");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 0.05;
        if (typeof mat.roughness === "number") mat.roughness = 0.85;
        if (typeof mat.envMapIntensity === "number") mat.envMapIntensity = 0.35;
        applyWoodGrainShader(mat, { scale: 11.5, intensity: 0.55 });
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

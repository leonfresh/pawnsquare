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
  opts?: { milkiness?: number; bottomTint?: THREE.Color }
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
        // Match ref: white = frosted/milky, black = smoked glossy black glass.
        const base = isWhite
          ? new THREE.Color("#f7fbff")
          : new THREE.Color("#0f141b");
        const rim = isWhite
          ? new THREE.Color("#ffffff")
          : new THREE.Color("#e9f2ff");

        if (mat.color && mat.color.isColor) mat.color.copy(base);
        if (typeof mat.metalness === "number") mat.metalness = 0.0;
        if (typeof mat.roughness === "number")
          mat.roughness = isWhite ? 0.92 : 0.03;
        mat.transparent = true;
        mat.opacity = isWhite ? 0.86 : 0.42;
        mat.depthWrite = isWhite;
        (mat as any).premultipliedAlpha = true;
        if (mat.emissive && mat.emissive.isColor) {
          mat.emissive = mat.emissive.clone();
          mat.emissive.copy(rim);
          mat.emissiveIntensity = isWhite ? 0.02 : 0.04;
        }
        if (typeof mat.envMapIntensity === "number")
          mat.envMapIntensity = isWhite ? 0.8 : 1.6;

        if (isWhite) {
          applyMilkGlassShader(mat, {
            milkiness: 0.85,
            bottomTint: new THREE.Color("#eef4ff"),
          });
          applyFresnelRim(mat, rim, 2.2, 0.25);
        } else {
          applyClearGlassShader(mat, {
            scale: 1.0,
            absorbStrength: 0.7,
            bottomTint: new THREE.Color("#050607"),
          });
          applyFresnelRim(mat, rim, 2.8, 0.22);
        }
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
        applyHammeredMetalShader(mat, {
          strength: isWhite ? 0.15 : 0.2,
          scale: 14.0,
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
      } else if (chessTheme === "chess_marble") {
        // Marble shader using the same technique as the marble board
        const darkBase = isWhite
          ? new THREE.Color("#e8e8e8")
          : new THREE.Color("#5e5e5e");
        const lightBase = isWhite
          ? new THREE.Color("#6a6560")
          : new THREE.Color("#c0c0c0");

        if (mat.color && mat.color.isColor) mat.color.copy(darkBase);
        if (typeof mat.metalness === "number") mat.metalness = 0.12;
        if (typeof mat.roughness === "number") mat.roughness = 0.25;
        if (typeof mat.envMapIntensity === "number") mat.envMapIntensity = 0.85;

        // Apply marble shader
        const prev = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader: any, renderer: any) => {
          try {
            (prev as any).call(mat as any, shader, renderer);
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
        mat.needsUpdate = true;
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

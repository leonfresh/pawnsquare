"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ThreeAvatar } from "@/components/three-avatar";
import { OrbitControls } from "@react-three/drei";

function CameraResetOnUrlChange({
  url,
  controlsRef,
  targetY = 1.1,
}: {
  url: string;
  controlsRef: React.MutableRefObject<any>;
  targetY?: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 1.75, 3.25);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, targetY, 0);
      controls.update();
      // Make this the new "home" so reset() always returns to the front.
      if (typeof controls.saveState === "function") controls.saveState();
    }
  }, [url, camera, controlsRef, targetY]);
  return null;
}

function WarmupFrames({
  enabled,
  frames = 8,
  onDone,
}: {
  enabled: boolean;
  frames?: number;
  onDone: () => void;
}) {
  const leftRef = useRef(frames);
  useEffect(() => {
    leftRef.current = frames;
  }, [enabled, frames]);

  useFrame(() => {
    if (!enabled) return;
    leftRef.current -= 1;
    if (leftRef.current <= 0) onDone();
  });

  return null;
}

function SpinnerOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.15)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          border: "3px solid rgba(255,255,255,0.25)",
          borderTopColor: "rgba(255,255,255,0.9)",
          animation: "vrmspin 0.9s linear infinite",
        }}
      />
      <style jsx>{`
        @keyframes vrmspin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export function VrmPreview({
  url,
  width = 220,
  height = 220,
}: {
  url: string;
  width?: number;
  height?: number;
}) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [everReady, setEverReady] = useState(false);
  const [phase, setPhase] = useState<"loading" | "warming" | "ready">(
    "loading"
  );
  const [yOffset, setYOffset] = useState(0);
  const controlsRef = useRef<any>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const style = useMemo(
    () => ({
      width,
      height,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid rgba(127,127,127,0.25)",
      background: "rgba(0,0,0,0.25)",
      position: "relative" as const,
    }),
    [width, height]
  );

  useEffect(() => {
    // Hide the model during swaps so you don't see a pose reset flash.
    setPhase("loading");
    setYOffset(0);
    setAutoRotate(true);
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div style={style}>
      <SpinnerOverlay visible={!everReady && phase !== "ready"} />
      <Canvas
        dpr={[1, 1.25]}
        gl={{ antialias: true, powerPreference: "low-power", alpha: true }}
        camera={{ position: [0, 1.75, 3.25], fov: 40 }}
      >
        <CameraResetOnUrlChange url={url} controlsRef={controlsRef} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 2, -3]} intensity={0.35} />

        <WarmupFrames
          enabled={phase === "warming"}
          frames={10}
          onDone={() => {
            setPhase("ready");
            setEverReady(true);
          }}
        />

        <Suspense fallback={null}>
          <group position={[0, yOffset, 0]} visible={phase === "ready"}>
            <ThreeAvatar
              url={url}
              movingSpeed={0}
              pose="stand"
              idleWiggle={phase === "ready"}
              idleWiggleStrength={autoRotate ? 1.15 : 0.95}
              onLoaded={(obj) => {
                try {
                  obj.updateWorldMatrix(true, true);
                  const box = new THREE.Box3().setFromObject(obj);
                  if (
                    Number.isFinite(box.min.y) &&
                    Number.isFinite(box.max.y)
                  ) {
                    const centerY = (box.min.y + box.max.y) * 0.5;
                    // Camera/controls are centered around y=1.1, so move the model
                    // to put its vertical center there.
                    setYOffset(1.1 - centerY);
                  }
                } catch {
                  // ignore bbox failures
                }
                setPhase("warming");
              }}
            />
          </group>
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableZoom={false}
          target={[0, 1.1, 0]}
          minPolarAngle={0.9}
          maxPolarAngle={1.35}
          enableDamping
          dampingFactor={0.08}
          autoRotate={autoRotate}
          // Match the old dt*0.6 manual camera orbit speed.
          autoRotateSpeed={5.7}
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
      </Canvas>
    </div>
  );
}

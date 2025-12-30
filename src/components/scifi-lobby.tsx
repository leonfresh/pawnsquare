"use client";

import { Text, Billboard, Float, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Note: Keep this lobby lightweight. Avoid heavy geometry/props to reduce
// WebGL context loss risk on weaker GPUs.

function HoloTape({ position, color = "#00ffaa", label = "DATA_LOG_01" }: { position: [number, number, number], color?: string, label?: string }) {
  return (
    <group position={position}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh rotation={[0, 0, 0]}>
          <planeGeometry args={[1.8, 1]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh rotation={[0, 0, 0]}>
          <planeGeometry args={[1.8, 1]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
        <Text
          position={[-0.8, 0.3, 0.01]}
          fontSize={0.15}
          color={color}
          anchorX="left"
          anchorY="top"
        >
          {label}
        </Text>
        <Text
          position={[-0.8, 0, 0.01]}
          fontSize={0.08}
          color={color}
          anchorX="left"
          anchorY="top"
          maxWidth={1.6}
          lineHeight={1.2}
        >
          {`> ANALYZING SECTOR 7\n> OPTIMIZING MESH...\n> UPLOAD COMPLETE`}
        </Text>
      </Float>
    </group>
  );
}

function Blimp({ position, range = 40, speed = 0.1, text, color }: any) {
  const groupRef = useRef<THREE.Group>(null);
  const [offset] = useState(() => Math.random() * 100);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime() * speed + offset;
      // Elliptical orbit
      groupRef.current.position.x = Math.sin(t) * range;
      groupRef.current.position.z = Math.cos(t) * (range * 0.6);
      groupRef.current.position.y = position[1] + Math.sin(t * 2) * 2;
      
      const dx = Math.cos(t) * range;
      const dz = -Math.sin(t) * (range * 0.6);
      groupRef.current.rotation.y = Math.atan2(dx, dz); 
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Hull */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[2, 8, 8, 16]} />
        <meshStandardMaterial color="#222" roughness={0.3} metalness={0.8} />
      </mesh>
      
      {/* Cabin */}
      <mesh position={[0, -2.5, 0]}>
        <boxGeometry args={[1.5, 1, 3]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[0, -2.5, 1.51]}>
         <planeGeometry args={[1.2, 0.6]} />
         <meshBasicMaterial color="#ffffaa" toneMapped={false} />
      </mesh>

      {/* Fins */}
      <group position={[0, 0, -5]}>
         <mesh position={[0, 1.5, 0]}>
            <boxGeometry args={[0.2, 3, 2]} />
            <meshStandardMaterial color="#333" />
         </mesh>
         <mesh position={[0, -1.5, 0]}>
            <boxGeometry args={[0.2, 3, 2]} />
            <meshStandardMaterial color="#333" />
         </mesh>
         <mesh position={[1.5, 0, 0]} rotation={[0, 0, Math.PI/2]}>
            <boxGeometry args={[0.2, 3, 2]} />
            <meshStandardMaterial color="#333" />
         </mesh>
         <mesh position={[-1.5, 0, 0]} rotation={[0, 0, Math.PI/2]}>
            <boxGeometry args={[0.2, 3, 2]} />
            <meshStandardMaterial color="#333" />
         </mesh>
      </group>

      {/* Screen / Ad on side (Left) */}
      <group position={[1.8, 0, 0]} rotation={[0, Math.PI/2, 0]}>
         <mesh position={[0, 0, -0.1]}>
            <planeGeometry args={[6, 2.5]} />
            <meshStandardMaterial color="#000" />
         </mesh>
         <Text
            fontSize={2.0}
            color={color}
            anchorX="center"
            anchorY="middle"
            maxWidth={5.5}
            outlineWidth={0.08}
            outlineColor="#ffffff"
         >
            {text}
         </Text>
      </group>
      
      {/* Screen / Ad on side (Right) */}
      <group position={[-1.8, 0, 0]} rotation={[0, -Math.PI/2, 0]}>
         <mesh position={[0, 0, -0.1]}>
            <planeGeometry args={[6, 2.5]} />
            <meshStandardMaterial color="#000" />
         </mesh>
         <Text
            fontSize={2.0}
            color={color}
            anchorX="center"
            anchorY="middle"
            maxWidth={5.5}
            outlineWidth={0.08}
            outlineColor="#ffffff"
         >
            {text}
         </Text>
      </group>
      
      {/* Engine Glow */}
      <pointLight position={[0, 0, -6]} color="#00ffff" intensity={2} distance={10} />
    </group>
  )
}

function SciFiSky() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
    }),
    []
  );

  useFrame(({ clock }) => {
    const m = materialRef.current;
    if (m) m.uniforms.time.value = clock.getElapsedTime();
  });

  return (
    <mesh scale={600} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 24]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `}
        fragmentShader={`
          uniform float time;
          varying vec3 vWorldPosition;

          // Auroras by nimitz 2017 (twitter: @stormoid)
          // Adapted for Three.js

          mat2 mm2(in float a){float c = cos(a), s = sin(a);return mat2(c,s,-s,c);}
          mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
          float tri(in float x){return clamp(abs(fract(x)-.5),0.01,0.49);}
          vec2 tri2(in vec2 p){return vec2(tri(p.x)+tri(p.y),tri(p.y+tri(p.x)));}

          float triNoise2d(in vec2 p, float spd)
          {
              float z=1.8;
              float z2=2.5;
              float rz = 0.;
              p *= mm2(p.x*0.06);
              vec2 bp = p;
              for (float i=0.; i<5.; i++ )
              {
                  vec2 dg = tri2(bp*1.85)*.75;
                  dg *= mm2(time*spd);
                  p -= dg/z2;

                  bp *= 1.3;
                  z2 *= .45;
                  z *= .42;
                  p *= 1.21 + (rz-1.0)*.02;
                  
                  rz += tri(p.x+tri(p.y))*z;
                  p*= -m2;
              }
              return clamp(1./pow(rz*29., 1.3),0.,.55);
          }

          float hash21(in vec2 n){ return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
          
          vec4 aurora(vec3 ro, vec3 rd)
          {
              vec4 col = vec4(0);
              vec4 avgCol = vec4(0);
              
              // Reduced iterations from 50 to 25 for performance
              for(float i=0.;i<25.;i++)
              {
                  float of = 0.006*hash21(gl_FragCoord.xy)*smoothstep(0.,15., i);
                  float pt = ((.8+pow(i,1.4)*.002)-ro.y)/(rd.y*2.+0.4);
                  pt -= of;
                  vec3 bpos = ro + pt*rd;
                  vec2 p = bpos.zx;
                  float rzt = triNoise2d(p, 0.06);
                  vec4 col2 = vec4(0,0,0, rzt);
                  col2.rgb = (sin(1.-vec3(2.15,-.5, 1.2)+i*0.043)*0.5+0.5)*rzt;
                  avgCol =  mix(avgCol, col2, .5);
                  col += avgCol*exp2(-i*0.065 - 2.5)*smoothstep(0.,5., i);
                  
              }
              
              col *= (clamp(rd.y*15.+.4,0.,1.));
              return col*1.8;
          }

          void main() {
            vec3 rd = normalize(vWorldPosition);
            vec3 ro = vec3(0.0, 0.0, -6.7); // Fixed origin to match original shader scale

            vec3 col = vec3(0.0);
            
            // Background gradient (simplified from original)
            float sd = dot(normalize(vec3(-0.5, -0.6, 0.9)), rd)*0.5+0.5;
            sd = pow(sd, 5.);
            vec3 bgCol = mix(vec3(0.05,0.1,0.2), vec3(0.1,0.05,0.2), sd);
            col = bgCol * 0.63;

            // Only render aurora above horizon
            if (rd.y > 0.0) {
                vec4 aur = smoothstep(0., 1.5, aurora(ro, rd));
                col = col * (1.0 - aur.a) + aur.rgb;
            }
            
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function SciFiFloor() {
  return (
    <group>
      {/* Main floor - shiny base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial 
          color="#050510" 
          roughness={0.3} 
          metalness={0.8}
          emissive="#020205"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Matte "Carpet" Zones - adds variance */}
      <group position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
         {/* Central Hub Carpet */}
         <mesh receiveShadow>
           <circleGeometry args={[13, 64]} />
           <meshStandardMaterial color="#151525" roughness={0.9} metalness={0.1} />
         </mesh>
         
         {/* Outer Walkway Ring */}
         <mesh receiveShadow>
           <ringGeometry args={[24, 36, 64]} />
           <meshStandardMaterial color="#101018" roughness={1.0} metalness={0.0} />
         </mesh>
      </group>
      
      {/* Glowing rings */}
      {Array.from({ length: 3 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[15 + i * 5, 15.1 + i * 5, 64]} />
          <meshBasicMaterial color={i % 2 === 0 ? "#00ffff" : "#ff00ff"} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function SciFiLamp({ lampPos }: { lampPos: [number, number, number] }) {
  return (
    <group position={lampPos}>
      {/* Base */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.15, 0.25, 0.2, 8]} />
        <meshStandardMaterial color="#111" roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Glowing Pole */}
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 4, 8]} />
        <meshStandardMaterial color="#ff00ff" emissive="#ff00ff" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* Top Light */}
      <pointLight position={[0, 3.5, 0]} intensity={2} color="#ff00ff" distance={15} decay={2} />
      <mesh position={[0, 4, 0]}>
        <octahedronGeometry args={[0.2, 0]} />
        <meshBasicMaterial color="#ffccff" wireframe toneMapped={false} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function SciFiPlanters() {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      groupRef.current.children.forEach((child, i) => {
        // Animate the holographic plant inside
        const holo = child.getObjectByName("holo");
        if (holo) {
          holo.rotation.y = -t * 0.5 + i;
          holo.rotation.z = Math.sin(t * 0.5 + i) * 0.1;
        }
      });
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const radius = 16.5;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, -angle, 0]}>
             {/* Hexagonal bench base */}
            <mesh position={[0, 0.3, 0]}>
              <cylinderGeometry args={[2.5, 2.5, 0.6, 6]} />
              <meshStandardMaterial color="#0a0a1a" roughness={0.2} metalness={0.9} />
            </mesh>
            {/* Glowing edge */}
            <mesh position={[0, 0.61, 0]} rotation={[-Math.PI/2, 0, 0]}>
               <ringGeometry args={[2.4, 2.5, 6]} />
               <meshBasicMaterial color="#00ffaa" toneMapped={false} />
            </mesh>
            {/* Holographic data stream in center */}
             <group name="holo" position={[0, 1.8, 0]}>
               <mesh>
                 <cylinderGeometry args={[0.8, 0.8, 2, 6, 4, true]} />
                 <meshBasicMaterial color="#00ffaa" wireframe transparent opacity={0.15} toneMapped={false} side={THREE.DoubleSide} />
               </mesh>
               <mesh scale={[0.8, 0.8, 0.8]}>
                 <octahedronGeometry args={[0.6, 0]} />
                 <meshBasicMaterial color="#00ffaa" wireframe transparent opacity={0.4} toneMapped={false} />
               </mesh>
             </group>
             {/* Inner glow for holo */}
             <pointLight position={[0, 1.2, 0]} color="#00ffaa" intensity={1.5} distance={6} decay={2} />
             
             {/* Floating HoloTape */}
             <HoloTape position={[0, 2.8, 0]} color="#00ffaa" label={`TERMINAL_0${i+1}`} />
          </group>
        );
      })}
    </group>
  )
}

function GiantTV({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.time.value = clock.getElapsedTime();
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[3, 2, 0.2]} />
        <meshStandardMaterial color="#111" roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.11]}>
        <planeGeometry args={[2.8, 1.8]} />
        <shaderMaterial
          ref={materialRef}
          uniforms={{ time: { value: 0 } }}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform float time;
            varying vec2 vUv;
            
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
              vec2 uv = vUv;
              // Glitchy static effect
              float noise = random(uv * vec2(100.0, 100.0) + time * 10.0);
              
              // Moving bars
              float bar = step(0.9, sin(uv.y * 20.0 + time * 5.0));
              
              vec3 col = vec3(0.0, 0.8, 1.0) * noise * 0.5;
              col += vec3(1.0, 0.0, 0.5) * bar * 0.5;
              
              // Scanlines
              col *= 0.8 + 0.2 * sin(uv.y * 200.0 + time * 10.0);
              
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>
    </group>
  )
}

function SciFiDecorations() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      groupRef.current.children.forEach((child, i) => {
        // Animate rings
        const ring1 = child.getObjectByName("ring1");
        const ring2 = child.getObjectByName("ring2");
        if (ring1) ring1.rotation.z = t * 0.2 + i;
        if (ring2) ring2.rotation.x = t * 0.3 + i;
      });
    }
  });

   return (
     <group ref={groupRef}>
       {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const radius = 28;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, -angle + Math.PI/2, 0]}>
            {/* Data Pillar */}
            <mesh position={[0, 4, 0]}>
              <boxGeometry args={[0.8, 8, 0.8]} />
              <meshStandardMaterial color="#050510" roughness={0.1} metalness={0.9} />
            </mesh>
            {/* Glowing seams */}
            <mesh position={[0, 4, 0]}>
               <boxGeometry args={[0.82, 8, 0.82]} />
               <meshBasicMaterial color="#ff00ff" wireframe transparent opacity={0.1} />
            </mesh>
            
            {/* Floating rings around pillar */}
             <mesh name="ring1" position={[0, 6, 0]} rotation={[Math.PI/2, 0.2, 0]}>
               <torusGeometry args={[1.5, 0.05, 8, 4]} />
               <meshBasicMaterial color="#00ffff" toneMapped={false} />
             </mesh>
             <mesh name="ring2" position={[0, 3, 0]} rotation={[Math.PI/2, -0.2, 0]}>
               <torusGeometry args={[1.8, 0.05, 8, 4]} />
               <meshBasicMaterial color="#ff00ff" toneMapped={false} />
             </mesh>

             {/* HoloTape attached to pillar */}
             <HoloTape position={[0, 5, 1.5]} color={i % 2 === 0 ? "#ff00ff" : "#00ffff"} label={`SERVER_NODE_${i}`} />

             {/* Giant TV on every other pillar */}
             {i % 2 === 0 && (
               <GiantTV position={[0, 3, -1.2]} rotation={[0, Math.PI, 0]} />
             )}
          </group>
        );
      })}
     </group>
   )
}

function ArenaCrowds() {
  return (
    <group>
      {/* 6 arc-shaped balcony platforms around the arena (large gaps) */}
      {Array.from({ length: 6 }).map((_, arcIndex) => {
        const rand = (seed: number) => {
          const x = Math.sin(seed * 9999.123) * 43758.5453123;
          return x - Math.floor(x);
        };

        const slices = 6;
        const full = Math.PI * 2;
        const gap = 0.7; // generous gaps
        const sliceAngle = full / slices;
        const arcSpan = sliceAngle - gap;
        const startAngle = arcIndex * sliceAngle + gap * 0.5;

        const platformInner = 18.0;
        const platformOuter = 24.0;
        const platformTopY = 2.8;
        const platformThickness = 0.45;

        const parapetRadius = platformInner + 0.15;
        const parapetHeight = 0.55;
        const parapetY = platformTopY + parapetHeight * 0.5 + 0.04;

        // Spectators stand on the platform, behind the parapet (slightly outward)
        const crowdMinR = parapetRadius + 0.9;
        const crowdMaxR = platformOuter - 0.8;
        const crowdCount = 16;
        const crowdBaseY = platformTopY + 0.55;

        return (
          <group key={`arc${arcIndex}`}>
            {/* Platform top */}
            <mesh position={[0, platformTopY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <ringGeometry args={[platformInner, platformOuter, 110, 1, startAngle, arcSpan]} />
              <meshStandardMaterial color="#1a1a2a" roughness={0.75} metalness={0.35} side={THREE.DoubleSide} />
            </mesh>

            {/* Platform thickness/skirt */}
            <mesh position={[0, platformTopY - platformThickness * 0.5, 0]}>
              <cylinderGeometry args={[platformOuter, platformOuter, platformThickness, 110, 1, true, startAngle, arcSpan]} />
              <meshStandardMaterial color="#101022" roughness={0.85} metalness={0.35} side={THREE.DoubleSide} />
            </mesh>

            {/* Random spectators on top of platform */}
            {Array.from({ length: crowdCount }).map((_, personIndex) => {
              const seed = arcIndex * 1000 + personIndex * 17;
              const a = startAngle + rand(seed + 1) * arcSpan;
              const r = crowdMinR + rand(seed + 2) * (crowdMaxR - crowdMinR);

              const x = Math.cos(a) * r;
              const z = Math.sin(a) * r;
              const yaw = -(a + Math.PI / 2);

              const bodyH = 0.78 + rand(seed + 3) * 0.28;
              const bodyW = 0.42 + rand(seed + 4) * 0.18;
              const headSize = 0.26 + rand(seed + 5) * 0.14;
              const armW = 0.12;
              const legW = 0.16;
              const shoulderY = bodyH * 0.85;
              const hipY = bodyH * 0.15;
              const pose = rand(seed + 6);

              // small jitter so it doesn't look like a perfect arc grid
              const tangJitter = (rand(seed + 7) - 0.5) * 0.45;
              const radialJitter = (rand(seed + 8) - 0.5) * 0.25;
              const xj = x + Math.cos(a + Math.PI / 2) * tangJitter + Math.cos(a) * radialJitter;
              const zj = z + Math.sin(a + Math.PI / 2) * tangJitter + Math.sin(a) * radialJitter;

              return (
                <group key={`p${arcIndex}_${personIndex}`} position={[xj, crowdBaseY, zj]} rotation={[0, yaw, 0]}>
                  {/* Torso */}
                  <mesh position={[0, bodyH / 2, 0]} castShadow>
                    <boxGeometry args={[bodyW, bodyH, 0.35]} />
                    <meshStandardMaterial
                      color={seed % 3 === 0 ? "#2a4a6a" : seed % 3 === 1 ? "#4a2a6a" : "#2a6a4a"}
                      emissive={seed % 2 === 0 ? "#001133" : "#110033"}
                      emissiveIntensity={0.35}
                      roughness={0.8}
                    />
                  </mesh>
                  {/* Head */}
                  <mesh position={[0, bodyH + headSize * 0.6, 0]} castShadow>
                    <sphereGeometry args={[headSize, 8, 8]} />
                    <meshStandardMaterial
                      color={seed % 3 === 0 ? "#3a5a7a" : seed % 3 === 1 ? "#5a3a7a" : "#3a7a5a"}
                      emissive={seed % 2 === 0 ? "#002255" : "#220055"}
                      emissiveIntensity={0.45}
                      roughness={0.7}
                    />
                  </mesh>
                  {/* Arms */}
                  <mesh position={[-bodyW / 2 - armW / 2, shoulderY, 0]} rotation={[0, 0, pose > 0.5 ? 0.35 : -0.25]} castShadow>
                    <boxGeometry args={[armW, 0.5, 0.15]} />
                    <meshStandardMaterial color="#1a2a4a" roughness={0.9} />
                  </mesh>
                  <mesh position={[bodyW / 2 + armW / 2, shoulderY, 0]} rotation={[0, 0, pose > 0.5 ? -0.35 : 0.25]} castShadow>
                    <boxGeometry args={[armW, 0.5, 0.15]} />
                    <meshStandardMaterial color="#1a2a4a" roughness={0.9} />
                  </mesh>
                  {/* Legs */}
                  <mesh position={[-bodyW / 4, hipY - 0.3, 0]} castShadow>
                    <boxGeometry args={[legW, 0.6, 0.18]} />
                    <meshStandardMaterial color="#0a1a2a" roughness={0.95} />
                  </mesh>
                  <mesh position={[bodyW / 4, hipY - 0.3, 0]} castShadow>
                    <boxGeometry args={[legW, 0.6, 0.18]} />
                    <meshStandardMaterial color="#0a1a2a" roughness={0.95} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function HoloJellyfish({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      groupRef.current.position.y = position[1] + Math.sin(t * 0.5) * 2;
      groupRef.current.rotation.y = t * 0.1;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Bell */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#00ffaa" wireframe transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      {/* Tentacles */}
      {Array.from({ length: 8 }).map((_, i) => (
        <group key={i} rotation={[0, (i / 8) * Math.PI * 2, 0]}>
            <mesh position={[1.5, -2, 0]}>
                <cylinderGeometry args={[0.05, 0.02, 4, 4]} />
                <meshBasicMaterial color="#00ffaa" transparent opacity={0.4} />
            </mesh>
        </group>
      ))}
    </group>
  );
}



export function SciFiLobby() {
  return (
    <>
      {/* Cyberpunk lighting: Darker ambient, strong colored rims */}
      <ambientLight intensity={0.4} color="#2a0a4a" />
      <hemisphereLight intensity={0.6} color="#4a00ff" groundColor="#000000" />
      
      {/* Strong overhead spotlights */}
      <directionalLight intensity={1.5} position={[0, 25, 0]} color="#aaccff" castShadow />
      <directionalLight intensity={2.0} position={[15, 10, 10]} color="#00ffff" />
      <directionalLight intensity={2.0} position={[-15, 10, -10]} color="#ff00ff" />
      
      {/* Arena spot lights */}
      <spotLight
        position={[0, 18, 0]}
        angle={Math.PI / 3}
        penumbra={0.5}
        intensity={2}
        color="#ffffff"
        distance={40}
        castShadow
      />
      
      <SciFiSky />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <SciFiFloor />
      {/* ArenaCrowds removed */}
      <SciFiPlanters />
      <SciFiDecorations />
      
      {/* Blimps with Ads */}
      <Blimp position={[-30, 12, -30]} text="ATARI" color="#ff0000" range={50} speed={0.05} />
      <Blimp position={[30, 15, 20]} text="COCA-COLA" color="#ffffff" range={45} speed={0.07} />
      <Blimp position={[0, 18, -40]} text="CYBER" color="#00ffff" range={60} speed={0.04} />
      <Blimp position={[25, 10, -25]} text="PAN AM" color="#0055ff" range={55} speed={0.06} />
      <Blimp position={[-20, 14, 30]} text="TDK" color="#ffffff" range={40} speed={0.08} />
      <Blimp position={[0, 22, 35]} text="SHIMATA" color="#ff00ff" range={65} speed={0.03} />

      {/* Holographic Jellyfish */}
      <HoloJellyfish position={[20, 15, -20]} />
      <HoloJellyfish position={[-20, 20, 20]} />
      
      <fog attach="fog" args={["#050010", 20, 90]} />
    </>
  );
}

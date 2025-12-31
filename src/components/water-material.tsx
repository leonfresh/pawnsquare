import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";
import { extend, useFrame } from "@react-three/fiber";
import { useRef } from "react";

const WaterShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uBaseColor: new THREE.Color("#103025"), // Deep forest green
    uLightColor: new THREE.Color("#2a7f35"), // Natural leaf green
    uLightDir: new THREE.Vector3(0.5, 0.6, 0).normalize(),
    uDirtColor: new THREE.Color("#463e28"), // Muddy brown
  },
  // Vertex Shader
  `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vViewPosition;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;
      vViewPosition = cameraPosition;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  // Fragment Shader
  `
    uniform float uTime;
    uniform vec3 uBaseColor;
    uniform vec3 uLightColor;
    uniform vec3 uLightDir;
    uniform vec3 uDirtColor;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vViewPosition;

    // Noise functions from reference
    mat2 m2 = mat2( 0.60, -0.80, 0.80, 0.60 );

    float hash( vec2 p ) {
      float h = dot(p,vec2(127.1,311.7));
      return fract(sin(h)*43758.5453123);
    }

    float noise( in vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f*f*(3.0-2.0*f);
      return -1.0+2.0*mix( mix( hash( i + vec2(0.0,0.0) ), 
                       hash( i + vec2(1.0,0.0) ), u.x),
                  mix( hash( i + vec2(0.0,1.0) ), 
                       hash( i + vec2(1.0,1.0) ), u.x), u.y);
    }

    // 3D Noise for FBM
    float noise3d( in vec3 x ) {
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f*f*(3.0-2.0*f);
      
      // Simple 3D noise approximation using 2D noise
      float n = p.x + p.y*57.0 + 113.0*p.z;
      return mix(mix(mix( hash(p.xy+vec2(0,0)+p.z*vec2(37,17)), hash(p.xy+vec2(1,0)+p.z*vec2(37,17)),f.x),
                     mix( hash(p.xy+vec2(0,1)+p.z*vec2(37,17)), hash(p.xy+vec2(1,1)+p.z*vec2(37,17)),f.x),f.y),
                 mix(mix( hash(p.xy+vec2(0,0)+(p.z+1.)*vec2(37,17)), hash(p.xy+vec2(1,0)+(p.z+1.)*vec2(37,17)),f.x),
                     mix( hash(p.xy+vec2(0,1)+(p.z+1.)*vec2(37,17)), hash(p.xy+vec2(1,1)+(p.z+1.)*vec2(37,17)),f.x),f.y),f.z);
    }

    // Better noise function from the reference (simplified)
    float Noise( in vec3 x )
    {
        vec3 p = floor(x);
        vec3 f = fract(x);
        f = f*f*(3.0-2.0*f);
        
        // We don't have the texture from shadertoy, so we use a procedural hash
        // This is a replacement for: vec2 rg = textureLod( iChannel0, (uv+0.5)/256.0, 0.0).yx;
        
        // Using a simple procedural noise instead
        return noise3d(x);
    }

    float FBM( in vec3 p )
    {
        float n = 0.0;
        n += 0.50000*Noise( p*1.0 );
        n += 0.25000*Noise( p*2.0 );
        n += 0.12500*Noise( p*4.0 );
        n += 0.06250*Noise( p*8.0 );
        n += 0.03125*Noise( p*16.0 );
        return n/0.984375;
    }

    float WaterMap( vec3 pos ) {
        return FBM( vec3( pos.xz * 0.2, uTime*0.3 )) * 1.;
    }

    vec3 WaterNormal(vec3 pos, float rz){
        float EPSILON = 0.01; // Fixed epsilon for now
        vec3 dx = vec3( EPSILON, 0.,0. );
        vec3 dz = vec3( 0.,0., EPSILON );
          
        vec3  normal = vec3( 0., 1., 0. );
        float bumpfactor = 0.3; // * pow(1.-clamp((rz)/1000.,0.,1.),6.);
        
        normal.x = -bumpfactor * (WaterMap(pos + dx) - WaterMap(pos-dx) ) / (2. * EPSILON);
        normal.z = -bumpfactor * (WaterMap(pos + dz) - WaterMap(pos-dz) ) / (2. * EPSILON);
        return normalize( normal ); 
    }

    void main() {
      vec3 viewDir = normalize(vWorldPos - vViewPosition);
      float dist = length(vWorldPos - vViewPosition);
      
      vec3 nor = WaterNormal(vWorldPos, dist);
      
      // Lighting
      float diff = pow(dot(nor, uLightDir) * 0.4 + 0.6, 3.);
      vec3 waterCol = uBaseColor + diff * uLightColor * 0.12;
      
      // Specular
      vec3 rd = viewDir;
      vec3 ref = reflect(rd, nor);
      float spec = pow(max(dot(ref, uLightDir), 0.0), 128.) * 3.;
      
      // Fresnel
      float fresnel = pow(1.0 - abs(dot(nor, -rd)), 6.);
      
      // Simple reflection approximation (sky color) - muted blue
      vec3 skyCol = vec3(0.3, 0.5, 0.7);
      
      vec3 col = mix(waterCol, skyCol, fresnel * 0.5);
      col += vec3(spec * 0.8); // Moderate specular intensity

      // Radial fade for soft edges
      float distFromCenter = length(vUv - 0.5);
      
      // Mix dirt at edges
      float dirtFactor = smoothstep(0.35, 0.5, distFromCenter);
      // Add some noise to the dirt edge
      float dirtNoise = noise(vUv * 10.0 + uTime * 0.1);
      dirtFactor += dirtNoise * 0.1;
      dirtFactor = clamp(dirtFactor, 0.0, 1.0);
      
      col = mix(col, uDirtColor, dirtFactor * 0.9);

      float alpha = 1.0 - smoothstep(0.42, 0.5, distFromCenter);
      alpha *= 0.95; // Max opacity

      gl_FragColor = vec4(col, alpha);
      
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
);

extend({ WaterShaderMaterial });

declare global {
  namespace JSX {
    interface IntrinsicElements {
      waterShaderMaterial: any & {
        uTime?: number;
        uBaseColor?: THREE.Color;
        uLightColor?: THREE.Color;
        uLightDir?: THREE.Vector3;
        uDirtColor?: THREE.Color;
      };
    }
  }
}

export function WaterPlane({
  position,
  rotation,
  args,
}: {
  position?: [number, number, number];
  rotation?: [number, number, number];
  args?: [number, number];
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh position={position} rotation={rotation} receiveShadow>
      <circleGeometry args={args} />
      {/* @ts-expect-error Custom shader material extended via drei */}
      <waterShaderMaterial ref={materialRef} transparent />
    </mesh>
  );
}

export { WaterShaderMaterial };

import React, { Suspense, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei';
import { Model } from '../character/Ayla';
import './Scene.css';

// Type assertions for React Three Fiber elements
const AmbientLight = 'ambientLight' as any;
const DirectionalLight = 'directionalLight' as any;
const PointLight = 'pointLight' as any;
const Group = 'group' as any;
const Mesh = 'mesh' as any;
const SphereGeometry = 'sphereGeometry' as any;
const MeshBasicMaterial = 'meshBasicMaterial' as any;

const Scene = () => {
  const characterRef = useRef(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      if (canvasContainerRef.current) {
        const canvas = canvasContainerRef.current.querySelector('canvas');
        if (canvas) {
          canvas.style.width = '100%';
          canvas.style.height = '100%';
        }
      }
    };

    // Initial sizing
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Clean up
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return (
    <div className="scene-container">
      {/* Background image */}
      <div 
        className="background-image" 
        style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/background.jpg)` }}
      />
      
      <div className="canvas-container" ref={canvasContainerRef}>
        <Canvas
          style={{ width: '100%', height: '100%' }}
          gl={{ antialias: true }}
          shadows
        >
          {/* Camera setup - using values from the example */}
          <PerspectiveCamera 
            name="camera"
            makeDefault 
            position={[0.5, 3.35, 2.58]} 
            fov={30}
            near={0.1}
            far={1000}
          />
          
          {/* Lighting setup from example */}
          {/* Soft ambient lighting */}
          <AmbientLight intensity={0.7} />
          
          {/* Main directional light from front-top */}
          <DirectionalLight 
            position={[2, 4, 3]} 
            intensity={1.0} 
            castShadow 
          />
          
          {/* Fill light from left */}
          <PointLight position={[-3, 2, 0]} intensity={0.7} color="#ffffff" />
          
          {/* Fill light from right */}
          <PointLight position={[3, 2, 0]} intensity={0.7} color="#ffffff" />
          
          {/* OrbitControls with values from example */}
          <OrbitControls 
            makeDefault
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            target={[-0.06, 3.04, -0.14]} 
            minDistance={1.0}
            maxDistance={5.0}
            maxPolarAngle={Math.PI * 0.65}
            minPolarAngle={Math.PI * 0.15}
            dampingFactor={0.05}
            enableDamping={true}
          />
          
          {/* Environment */}
          <Environment preset="city" />
          
          {/* Character group with positioning from example */}
          <Suspense fallback={null}>
            <Group ref={characterRef}>
              <Model 
                position={[0, 0.8, 0]} 
                scale={[1.6, 1.6, 1.6]} 
                rotation={[0, 0.2, 0]}
              />
              
              {/* Keep the marker for debug purposes */}
              <Mesh position={[0, 0, 0]} scale={[0.1, 0.1, 0.1]}>
                <SphereGeometry />
                <MeshBasicMaterial color="red" />
              </Mesh>
            </Group>
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
};

export default Scene;

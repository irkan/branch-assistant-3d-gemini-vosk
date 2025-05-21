import React, { Suspense, useRef, useEffect, ReactNode } from 'react';
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

interface SceneProps {
  children?: ReactNode;
}

const Scene = ({ children }: SceneProps) => {
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
      
      <div className="canvas-container" ref={canvasContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Canvas style={{ background: 'transparent' }}>
          <Suspense fallback={null}>
            <PerspectiveCamera makeDefault position={[0, 1.6, 3]} fov={60} />
            <OrbitControls target={[0, 1, 0]} />

            <AmbientLight intensity={0.5} />
            <DirectionalLight position={[10, 10, 5]} intensity={1} />
            <PointLight position={[-10, -10, -10]} intensity={0.5} />

            {/* Render children here, which will include Altair and thus the Ayla model */}
            {children}

            {/* Example: Keep existing model if it's meant to be separate or remove if Altair handles it */}
            {/* <Model ref={characterRef} position={[0, 0, 0]} /> */}

            <Environment preset="sunset" />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
};

export default Scene;

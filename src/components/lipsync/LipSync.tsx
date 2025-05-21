import React, { useRef } from "react";
import { GladiaWordTimestamp } from "../speech/gladia/useGladiaRt";
import { AylaModelRef, Model, MorphTargetData } from "../character/Ayla";

export interface LipSyncRef {
    proccessLipSyncData: (data: GladiaWordTimestamp[]) => void;
}

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {

    const modelRef = useRef<AylaModelRef>(null);

    const proccessLipSyncData = (data: GladiaWordTimestamp[]) => {
        console.log("LipSync--------: ", data);
        const sampleUniversalTargets: MorphTargetData[] = [
            { morphTarget: "Merged_Open_Mouth", weight: "0.7" },
            { morphTarget: "V_Wide", weight: "0.2" }
        ];
        modelRef.current?.updateMorphTargets(sampleUniversalTargets);
    }

    React.useImperativeHandle(ref, () => ({
        proccessLipSyncData: proccessLipSyncData,
    }));

    return (
        <Model 
                position={[0, -4.65, 0]} 
                scale={[3.95, 3.95, 3.95]} 
                rotation={[0, 0, 0]}
                ref={modelRef} 
              />
    );
});

LipSync.displayName = 'LipSync';
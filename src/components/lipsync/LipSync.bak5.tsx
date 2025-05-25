import React, { useRef, useEffect } from "react";
import { GladiaWordTimestamp } from "../speech/gladia/useGladiaRt";
import { AylaModelRef, Model, MorphTargetData } from "../character/Ayla";

export interface LipSyncRef {
    proccessLipSyncData: (data: GladiaWordTimestamp[], sequenceNumber?: number) => void;
}

interface PhonemeItem {
    id: number;
    phoneme: string;
    duration: number;
    session: number;
}

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {
    const modelRef = useRef<AylaModelRef>(null);
    const phonemeQueue = useRef<PhonemeItem[]>([]);
    const animationFrameId = useRef<number | null>(null);
    const isProcessing = useRef<boolean>(false);
    const timeoutId = useRef<NodeJS.Timeout | null>(null);
    const id = useRef<number>(0);
    // Növbəni avtomatik izləmək üçün watcher
    useEffect(() => {
        // Asinxron işləyən funksiya
        const checkQueue = () => {
            // Əgər növbədə fonem varsa və emal prosesi işləmirsə
            if (phonemeQueue.current.length > 0 && !isProcessing.current) {
                isProcessing.current = true;
                processQueue();
            }
            
            // Daimi olaraq yoxla
            animationFrameId.current = requestAnimationFrame(checkQueue);
        };
        
        // İzləməni başlat
        checkQueue();
        
        // Təmizləmək üçün
        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
            if (timeoutId.current) {
                clearTimeout(timeoutId.current);
            }
        };
    }, []);

    const proccessLipSyncData = (data: GladiaWordTimestamp[], sequenceNumber: number = 0) => {
        console.log(`LipSync: Processing new word data with sequence ${sequenceNumber}:`, data);
        
        // Növbədə element var və son elementin session ID-si gələn session ID-dən fərqlidirsə
        if (phonemeQueue.current.length > 0 && 
            phonemeQueue.current[phonemeQueue.current.length - 1].session !== sequenceNumber) {
            
            console.log(`LipSync: Session changed from ${phonemeQueue.current[phonemeQueue.current.length - 1].session} to ${sequenceNumber}, clearing queue`);
            
            // Növbəni təmizlə
            phonemeQueue.current = [];
            
            // Əgər emal prosesi gedirsə, dayandır
            if (isProcessing.current && timeoutId.current) {
                clearTimeout(timeoutId.current);
                timeoutId.current = null;
                isProcessing.current = false;
            }
        }
        
        // Hər söz üçün analiz et
        data.forEach((wordData, wordIndex) => {
            const word = wordData.word.trim().replace(/[^a-zA-Z0-9əƏıİöÖüÜçÇşŞğĞ]/g, '');
            if (!word) return;
            
            // Sözün müddətini hesabla
            const wordDuration = wordData.end - wordData.start;
            
            // Sözü hərflərə parçala
            const chars = word.split('');
            
            // Hər hərf üçün vaxt hesabla
            const charDuration = ((wordDuration / chars.length) * 1000)-27;
            
            // Hər hərf üçün fonem əlavə et
            chars.forEach((char, charIndex) => {
                // Queue-yə əlavə et
                phonemeQueue.current.push({
                    id: id.current++,
                    phoneme: char.toLowerCase(),
                    duration: charDuration,
                    session: sequenceNumber
                });
                
                console.log(`PHONEME: char="${char.toLowerCase()}", ID: ${id.current}, duration=${charDuration.toFixed(3)}, seq=${sequenceNumber}`);
            });
            
            // Əgər növbəti söz varsa, sözlər arası boşluq əlavə et
            if (wordIndex < data.length-1) {
                const nextWordData = data[wordIndex + 1];
                
                // Boşluq üçün "_" fonem əlavə et
                phonemeQueue.current.push({
                    id: id.current++,
                    phoneme: '_',
                    duration: (Math.round((nextWordData.start - wordData.end) * 1000)-27),
                    session: sequenceNumber
                });
                
                console.log(`PHONEME: char="_", ID: ${id.current}, duration=${(nextWordData.start - wordData.end)}, seq=${sequenceNumber}`);
           
            }

        });
    };
    
    const processQueue = () => {
        // Əgər növbə boşdursa, prosesi dayandır
        if (phonemeQueue.current.length === 0) {
            console.log("QUEUE_EMPTY");
            isProcessing.current = false;
            return;
        }

        const phoneme = phonemeQueue.current.shift();
        if (phoneme) {
            const targets = getPhonemeTargets(phoneme.phoneme);
            modelRef.current?.updateMorphTargets(targets);
        }
        
        // Console-a yaz
        if (phoneme) {
            console.log(`PROCESSED: char="${phoneme.phoneme}", ID: ${phoneme.id}, duration=${phoneme.duration.toFixed(3)}, seq=${phoneme.session}`);
        }
        
        // Növbəti addım üçün 200ms gözlə
        if (phonemeQueue.current.length > 0) {
            timeoutId.current = setTimeout(() => {
                processQueue();
            }, phoneme?.duration || 88); // Default to 88ms if duration is undefined
        } else {
            console.log("QUEUE_EMPTY");
            isProcessing.current = false;
        }
    };

    React.useImperativeHandle(ref, () => ({
        proccessLipSyncData: proccessLipSyncData,
    }));

    const getPhonemeTargets = (phoneme: string | undefined): MorphTargetData[] => {
        if (!phoneme) return [{ morphTarget: "Merged_Open_Mouth", weight: "0" }];
        switch (phoneme) {
           case 'a': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.6" }];
           case 'ə': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.5" }];
           case 'i': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.6" }];
           //case 'l': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'r': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'n': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           case 'm': return [{ morphTarget: "V_Explosive", weight: "1" }];
           case 'e': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.3" }, { morphTarget: "V_Wide", weight: "0.6" }];
           //case 's': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 't': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'd': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'k': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
           case 'b': return [{ morphTarget: "V_Explosive", weight: "1" }];
           //case 'g': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
           //case 'y': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           case 'u': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.1" }, { morphTarget: "V_Affricate", weight: "1" }, { morphTarget: "V_Tight", weight: "1" }];
           case 'o': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Affricate", weight: "1" }, { morphTarget: "V_Tight", weight: "1" }];
           //case 'ç': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'z': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'ş': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'q': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
           //case 'x': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
           case 'v': return [{ morphTarget: "V_Dental_Lip", weight: "1" }];
           //case 'j': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           case 'ü': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.1" }, { morphTarget: "V_Affricate", weight: "1" }, { morphTarget: "V_Tight", weight: "1" }];
           case 'ö': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Affricate", weight: "1" }, { morphTarget: "V_Tight", weight: "1" }];
           //case 'h': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
           //case 'ğ': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
           //case 'c': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
           case 'ı': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.6" }];
           case 'p': return [{ morphTarget: "V_Explosive", weight: "1" }];
           case 'f': return [{ morphTarget: "V_Dental_Lip", weight: "1" }];
           case '_': return [
            { morphTarget: "Merged_Open_Mouth", weight: "0" }, 
            { morphTarget: "V_Lip_Open", weight: "0" }, 
            { morphTarget: "V_Tight_O", weight: "0" }, 
            { morphTarget: "V_Dental_Lip", weight: "0" }, 
            { morphTarget: "V_Explosive", weight: "0" }, 
            { morphTarget: "V_Wide", weight: "0" }, 
            { morphTarget: "V_Affricate", weight: "0" }
          ];
          default: return [
            { morphTarget: "Merged_Open_Mouth", weight: "0" }, 
            { morphTarget: "V_Lip_Open", weight: "0" }, 
            { morphTarget: "V_Tight_O", weight: "0" }, 
            { morphTarget: "V_Dental_Lip", weight: "0" }, 
            { morphTarget: "V_Explosive", weight: "0" }, 
            { morphTarget: "V_Wide", weight: "0" }, 
            { morphTarget: "V_Affricate", weight: "0" }
          ];
        }
      };

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
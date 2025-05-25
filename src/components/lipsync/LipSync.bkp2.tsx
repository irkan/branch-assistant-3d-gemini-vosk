import React, { useRef, useEffect, useState } from "react";
import { GladiaWordTimestamp } from "../speech/gladia/useGladiaRt";
import { AylaModelRef, Model, MorphTargetData } from "../character/Ayla";

export interface LipSyncRef {
    proccessLipSyncData: (data: GladiaWordTimestamp[]) => void;
}

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {

    const modelRef = useRef<AylaModelRef>(null);
    const [timeoutIds, setTimeoutIds] = useState<NodeJS.Timeout[]>([]);
    const sessionClientStartTimeRef = useRef<number | null>(null); // Müştəri tərəfində sessiyanın başlandığı an (performance.now())
    const firstWordAudioStartTimeRef = useRef<number | null>(null); // Gladia-dan gələn ilk sözün mütləq başlama vaxtı (ms)

    useEffect(() => {
        // Komponent söküləndə bütün taymerləri təmizlə
        return () => {
            timeoutIds.forEach(clearTimeout);
            // Sessiya referanslarını da sıfırlamaq olar, əgər komponentin təkrar istifadəsi zamanı yeni sessiya gözlənilirsə
            // sessionClientStartTimeRef.current = null;
            // firstWordAudioStartTimeRef.current = null;
        };
    }, [timeoutIds]);

    const proccessLipSyncData = (data: GladiaWordTimestamp[]) => {
        //console.log("LipSync: proccessLipSyncData called. Received items: ", data.length, "at client time: ", performance.now());

        // Əvvəlki taymerləri təmizlə
        timeoutIds.forEach(clearTimeout);
        const newTimeoutIds: NodeJS.Timeout[] = [];
        const currentClientTimeMs = performance.now();

        if (data.length === 0) {
            const resetTargets = getPhonemeTargets('_');
            modelRef.current?.updateMorphTargets(resetTargets);
            setTimeoutIds([]);
            // Sessiya referansları sıfırlanmır, çünki bu, sadəcə müvəqqəti bir fasilə ola bilər
            return;
        }

        // Sessiya başlanğıc referanslarını təyin et (əgər hələ təyin edilməyibsə)
        if (sessionClientStartTimeRef.current === null || firstWordAudioStartTimeRef.current === null) {
            sessionClientStartTimeRef.current = currentClientTimeMs;
            firstWordAudioStartTimeRef.current = data[0].start * 1000; // İlk sözün başlama vaxtı sessiyanın audio başlanğıcıdır
            console.log(`LipSync: Session started. ClientStartTime: ${sessionClientStartTimeRef.current.toFixed(3)}, FirstWordAudioStartTime: ${firstWordAudioStartTimeRef.current.toFixed(3)}`);
        }

        let currentBatchSequentialOffsetMs = 0; // Bu dəstədəki sözlərin ardıcıl animasiyası üçün ofset

        for (let wordIndex = 0; wordIndex < data.length; wordIndex++) {
            const wordData = data[wordIndex];
            const wordPhonemes = wordData.word.trim().toLowerCase();
            const wordAudioStartTimeMs = wordData.start * 1000;
            const wordAudioEndTimeMs = wordData.end * 1000;
            const wordDurationMs = wordAudioEndTimeMs - wordAudioStartTimeMs;

            if (wordPhonemes.length === 0 || wordDurationMs <= 0) {
                console.log("LipSync: Skipping empty or zero-duration word: ", wordData.word);
                continue;
            }

            const phonemeDurationMs = wordDurationMs / wordPhonemes.length;

            // Sözün audio axınındakı ilk sözə görə nisbi başlama vaxtı
            const wordAudioStartTimeRelativeToSessionAudioStartMs = wordAudioStartTimeMs - firstWordAudioStartTimeRef.current!;
            
            // Sözün müştəri zaman xəttində ideal başlama vaxtı
            const idealWordStartOnClientTimelineMs = sessionClientStartTimeRef.current! + wordAudioStartTimeRelativeToSessionAudioStartMs;

            // İdeal başlama vaxtına qədər olan gecikmə (cari andan etibarən)
            const delayFromNowToIdealStartMs = Math.max(0, idealWordStartOnClientTimelineMs - currentClientTimeMs);

            // Bu sözün ilk fonemi üçün effektiv cədvəlləmə gecikməsi
            // Bu, həm əvvəlki sözlərin bitməsini gözləyir (cari dəstədə), həm də sözün öz ideal vaxtını
            const effectiveSchedulingDelayForWordMs = Math.max(currentBatchSequentialOffsetMs, delayFromNowToIdealStartMs);


            for (let phonemeIndex = 0; phonemeIndex < wordPhonemes.length; phonemeIndex++) {
                const phoneme = wordPhonemes[phonemeIndex];
                const targets = getPhonemeTargets(phoneme);
                const phonemeRelativeStartTimeMs = phonemeIndex * phonemeDurationMs;
                const totalDelayForPhonemeMs = effectiveSchedulingDelayForWordMs + phonemeRelativeStartTimeMs;

                const timeoutId = setTimeout(() => {
                    // const timeSinceSessionStart = (performance.now() - sessionClientStartTimeRef.current!) / 1000;
                    // console.log(`LipSync: [${timeSinceSessionStart.toFixed(3)}s] Updating morphs for phoneme: '${phoneme}' (Word: '${wordData.word}', ScheduledDelay: ${totalDelayForPhonemeMs.toFixed(3)}ms)`);
                    modelRef.current?.updateMorphTargets(targets);
                }, totalDelayForPhonemeMs);
                newTimeoutIds.push(timeoutId);
            }

            // Söz bitdikdən sonra morfları sıfırlamaq üçün taymer
            const totalDelayForWordResetMs = effectiveSchedulingDelayForWordMs + wordDurationMs;
            const resetTimeoutId = setTimeout(() => {
                // const timeSinceSessionStart = (performance.now() - sessionClientStartTimeRef.current!) / 1000;
                // console.log(`LipSync: [${timeSinceSessionStart.toFixed(3)}s] Resetting morphs after word: '${wordData.word}' (ScheduledEndDelay: ${totalDelayForWordResetMs.toFixed(3)}ms)`);
                const resetTargets = getPhonemeTargets('_');
                modelRef.current?.updateMorphTargets(resetTargets);
            }, totalDelayForWordResetMs);
            newTimeoutIds.push(resetTimeoutId);

            // Növbəti söz üçün batch ofsetini yenilə
            currentBatchSequentialOffsetMs = effectiveSchedulingDelayForWordMs + wordDurationMs;
        }
        setTimeoutIds(newTimeoutIds);
    };

    React.useImperativeHandle(ref, () => ({
        proccessLipSyncData: proccessLipSyncData,
    }));

  const getPhonemeTargets = (phoneme: string | undefined): MorphTargetData[] => {
    if (!phoneme) return [{ morphTarget: "Merged_Open_Mouth", weight: "0" }, { morphTarget: "V_Wide", weight: "0.1" }];
    switch (phoneme) {
       case 'a': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.6" }, { morphTarget: "V_Wide", weight: "0.2" }];
       case 'ə': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.5" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'i': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.6" }];
       case 'l': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.3" }];
       case 'r': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.3" }];
       case 'n': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.3" }];
       case 'm': return [{ morphTarget: "V_Explosive", weight: "1" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'e': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.3" }, { morphTarget: "V_Wide", weight: "0.6" }];
       case 's': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.3" }];
       case 't': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.3" }];
       case 'd': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.3" }];
       case 'k': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }]; 
       case 'b': return [{ morphTarget: "V_Explosive", weight: "1" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'g': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.2" }]; 
       case 'y': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.2" }];
       case 'u': return [{ morphTarget: "V_Tight_O", weight: "1" }];
       case 'o': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.1" }, { morphTarget: "V_Tight_O", weight: "0.7" }];
       case 'ç': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.2" }];
       case 'z': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.2" }];
       case 'ş': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'q': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }]; 
       case 'x': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }]; 
       case 'v': return [{ morphTarget: "V_Dental_Lip", weight: "1" }];
       case 'j': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'ü': return [{ morphTarget: "V_Tight_O", weight: "1" }];
       case 'ö': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.1" }, { morphTarget: "V_Tight_O", weight: "0.7" }];
       case 'h': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'ğ': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.1" }]; 
       case 'c': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.2" }]; 
       case 'ı': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.6" }];
       case 'p': return [{ morphTarget: "V_Explosive", weight: "1" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case 'f': return [{ morphTarget: "V_Dental_Lip", weight: "1" }, { morphTarget: "V_Wide", weight: "0.1" }];
       case '_': return [
        { morphTarget: "Merged_Open_Mouth", weight: "0" }, 
        { morphTarget: "V_Lip_Open", weight: "0" }, 
        { morphTarget: "V_Tight_O", weight: "0" }, 
        { morphTarget: "V_Dental_Lip", weight: "0" }, 
        { morphTarget: "V_Explosive", weight: "0" }, 
        { morphTarget: "V_Wide", weight: "0.1" }
      ];
      default: return [
        { morphTarget: "Merged_Open_Mouth", weight: "0" }, 
        { morphTarget: "V_Lip_Open", weight: "0" }, 
        { morphTarget: "V_Tight_O", weight: "0" }, 
        { morphTarget: "V_Dental_Lip", weight: "0" }, 
        { morphTarget: "V_Explosive", weight: "0" }, 
        { morphTarget: "V_Wide", weight: "0.1" }
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
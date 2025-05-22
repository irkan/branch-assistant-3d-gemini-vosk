import React, { useRef, useEffect } from "react";
import { GladiaWordTimestamp } from "../speech/gladia/useGladiaRt";
import { AylaModelRef, Model, MorphTargetData } from "../character/Ayla";

export interface LipSyncRef {
    proccessLipSyncData: (data: GladiaWordTimestamp[]) => void;
}

const RESET_LAST_END_TIME_DELAY = 3000; // ms

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {

    const modelRef = useRef<AylaModelRef>(null);
    const activeTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
    const lastWordEndTimeRef = useRef<number>(0); // Son sözün mütləq bitmə zamanını saxlayır (saniyə cinsində)
    const resetLastEndTimeTimerRef = useRef<NodeJS.Timeout | null>(null); // lastWordEndTimeRef-i sıfırlamaq üçün taymer

    useEffect(() => {
        return () => {
            activeTimeoutsRef.current.forEach(clearTimeout);
            if (resetLastEndTimeTimerRef.current) {
                clearTimeout(resetLastEndTimeTimerRef.current);
            }
        };
    }, []);

    const proccessLipSyncData = (data: GladiaWordTimestamp[]) => {
        console.log("LipSync proccessLipSyncData with data: ", JSON.stringify(data, null, 2));

        activeTimeoutsRef.current.forEach(clearTimeout);
        activeTimeoutsRef.current = [];

        if (resetLastEndTimeTimerRef.current) {
            clearTimeout(resetLastEndTimeTimerRef.current);
            resetLastEndTimeTimerRef.current = null;
        }

        if (!data || data.length === 0) {
            console.log("LipSync: Empty data received, setting to neutral and resetting last end time.");
            const neutralTargets = getPhonemeTargets('_');
            modelRef.current?.updateMorphTargets(neutralTargets);
            lastWordEndTimeRef.current = 0; // Heç bir söz emal olunmadığı üçün sıfırla
            return;
        }

        let overallDelay = 0; // Bütün animasiyalar üçün ümumi başlanğıc gecikməsi (ms)
        const firstWordOfPacket = data[0];

        if (lastWordEndTimeRef.current > 0 && firstWordOfPacket.start_time > lastWordEndTimeRef.current) {
            const pauseBetweenPackets = (firstWordOfPacket.start_time - lastWordEndTimeRef.current) * 1000;
            overallDelay += pauseBetweenPackets;
            console.log(`LipSync: Pause between packets detected: ${pauseBetweenPackets.toFixed(2)}ms`);
        }

        let currentLastEndTime = lastWordEndTimeRef.current; // Bu paket daxilində son sözün bitmə zamanı

        for (let wordIndex = 0; wordIndex < data.length; wordIndex++) {
            const wordData = data[wordIndex];
            const wordText = wordData.word.trim();
            if (!wordText) continue;

            let wordStartDelay = overallDelay;
            if (wordIndex > 0) { // Əgər ilk söz deyilsə, əvvəlki sözlə arasındakı pauzanı hesablayırıq
                const prevWordEndTime = data[wordIndex - 1].end_time;
                if (wordData.start_time > prevWordEndTime) {
                    const pauseBetweenWords = (wordData.start_time - prevWordEndTime) * 1000;
                    wordStartDelay += pauseBetweenWords;
                     console.log(`  LipSync: Pause between "${data[wordIndex-1].word.trim()}" and "${wordText}": ${pauseBetweenWords.toFixed(2)}ms added to overallDelay. New overallDelay for this word: ${wordStartDelay.toFixed(2)}ms`);
                }
            } else { // Paketin ilk sözü üçün
                 // overallDelay artıq paketlər arası pauzanı (əgər varsa) ehtiva edir.
                 // Əgər lastWordEndTimeRef.current > wordData.start_time isə, bu, üst-üstə düşmə deməkdir.
                 // Bu halda, animasiyanı dərhal (və ya çox kiçik bir gecikmə ilə) başlatmaq istəyə bilərik.
                 // Hazırkı məntiqdə, əgər üst-üstə düşmə varsa, overallDelay olduğu kimi qalır (potensial olaraq mənfi və ya sıfır).
                 // Biz istəyirik ki, animasiya ən azı sıfırıncı saniyədə başlasın (əvvəlki `activeTimeoutsRef` təmizləndiyi üçün).
                 // Bu, bir az daha düşünülməlidir. Ən sadə halda, `overallDelay` `firstWordOfPacket.start_time * 1000`-dən başlamalıdır.
                 // Amma `lastWordEndTimeRef` ilə müqayisə daha doğrudur.
                 // Hələlik, `overallDelay` hesablamasını yuxarıdakı kimi saxlayaq.
                 console.log(`  LipSync: First word "${wordText}" in packet. Initial overallDelay for this word: ${wordStartDelay.toFixed(2)}ms`);
            }


            const wordDuration = (wordData.end_time - wordData.start_time) * 1000; // ms
            const chars = wordText.split('');
            const durationPerChar = (chars.length > 0 && wordDuration > 0) ? (wordDuration / chars.length) : (chars.length > 0 ? 50 : 0);

            console.log(`  Processing word: "${wordText}", Relative Start: ${wordStartDelay.toFixed(2)}ms, Duration: ${wordDuration.toFixed(2)}ms, Chars: ${chars.length}, Duration/Char: ${durationPerChar.toFixed(2)}ms`);

            for (let i = 0; i < chars.length; i++) {
                const char = chars[i].toLowerCase();
                const targets = getPhonemeTargets(char);
                const charDelay = wordStartDelay + (i * durationPerChar);

                const timeoutId = setTimeout(() => {
                    console.log(`    Animating char: '${char}' for "${wordText}" at ${new Date().toLocaleTimeString()}. Targets:`, JSON.stringify(targets));
                    modelRef.current?.updateMorphTargets(targets);
                }, charDelay);
                activeTimeoutsRef.current.push(timeoutId);
            }
            // Növbəti iterasiyada sözlər arası pauzanı düzgün hesablamaq üçün overallDelay-i cari sözün bitməsinə qədər artırırıq.
            // Bu, wordStartDelay + wordDuration olmalıdır.
            overallDelay = wordStartDelay + wordDuration; 
            currentLastEndTime = wordData.end_time; // Bu paketdəki son sözün bitmə zamanını yenilə
        }

        // Bütün animasiyalar cədvələ salındıqdan sonra son sözün bitmə zamanını qlobal olaraq yenilə
        if (data.length > 0) {
             lastWordEndTimeRef.current = currentLastEndTime; // saniyə cinsində
             console.log(`LipSync: Updated lastWordEndTimeRef to: ${lastWordEndTimeRef.current.toFixed(3)}s`);

            // Neytral poza üçün timeout, ən son hərfin animasiyasının bitməsindən sonra olmalıdır.
            const neutralPoseDelay = overallDelay + 100; // Son hərfdən 100ms sonra
            const finalTimeoutId = setTimeout(() => {
                console.log("All words processed. Setting to neutral pose.");
                const neutralTargets = getPhonemeTargets('_');
                modelRef.current?.updateMorphTargets(neutralTargets);
            }, neutralPoseDelay);
            activeTimeoutsRef.current.push(finalTimeoutId);

            // lastWordEndTimeRef-i sıfırlamaq üçün taymer qur
            resetLastEndTimeTimerRef.current = setTimeout(() => {
                console.log(`LipSync: Resetting lastWordEndTimeRef after ${RESET_LAST_END_TIME_DELAY}ms of inactivity.`);
                lastWordEndTimeRef.current = 0;
                resetLastEndTimeTimerRef.current = null;
            }, RESET_LAST_END_TIME_DELAY);
        }
    };

    React.useImperativeHandle(ref, () => ({
        proccessLipSyncData: proccessLipSyncData,
    }));

    const getPhonemeTargets = (phoneme: string | undefined): MorphTargetData[] => {
        if (!phoneme) return [];
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
import React, { useRef, useEffect } from "react";
import { GladiaWordTimestamp } from "../speech/gladia/useGladiaRt";
import { AylaModelRef, Model, MorphTargetData } from "../character/Ayla";

export interface LipSyncRef {
    proccessLipSyncData: (data: GladiaWordTimestamp[]) => void;
}

const RESET_LAST_PROCESSED_AUDIO_TIME_DELAY = 3000; // ms
const DEFAULT_CHAR_DURATION_IF_NO_WORD_DURATION = 75; // ms
const MIN_CALCULATED_CHAR_DURATION = 30; // ms

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {

    const modelRef = useRef<AylaModelRef>(null);
    const activeTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
    const lastProcessedAudioEndTimeRef = useRef<number>(0); 
    const resetLastProcessedAudioEndTimeTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            activeTimeoutsRef.current.forEach(clearTimeout);
            if (resetLastProcessedAudioEndTimeTimerRef.current) {
                clearTimeout(resetLastProcessedAudioEndTimeTimerRef.current);
            }
        };
    }, []);

    const proccessLipSyncData = (data: GladiaWordTimestamp[]) => {
        console.log("LipSync: proccessLipSyncData called. Received items: ", data.length);

        activeTimeoutsRef.current.forEach(clearTimeout);
        activeTimeoutsRef.current = [];

        if (resetLastProcessedAudioEndTimeTimerRef.current) {
            clearTimeout(resetLastProcessedAudioEndTimeTimerRef.current);
            resetLastProcessedAudioEndTimeTimerRef.current = null;
        }

        if (!data || data.length === 0) {
            console.log("LipSync: Empty data, setting to neutral and resetting last processed time.");
            const neutralTargets = getPhonemeTargets('_');
            modelRef.current?.updateMorphTargets(neutralTargets);
            lastProcessedAudioEndTimeRef.current = 0;
            return;
        }

        let animationScheduleTimeMs = 0; 
        const firstWordInPacketStartTime = typeof data[0].start === 'number' ? data[0].start : 0;

        if (lastProcessedAudioEndTimeRef.current > 0 && firstWordInPacketStartTime > lastProcessedAudioEndTimeRef.current) {
            const pauseBetweenPacketsMs = (firstWordInPacketStartTime - lastProcessedAudioEndTimeRef.current) * 1000;
            animationScheduleTimeMs = pauseBetweenPacketsMs;
            console.log(`LipSync: ---> Timeout (Pause Between Packets): ${pauseBetweenPacketsMs.toFixed(2)}ms. Animation schedule starts at ${animationScheduleTimeMs.toFixed(2)}ms.`);
        } else if (lastProcessedAudioEndTimeRef.current > 0 && firstWordInPacketStartTime <= lastProcessedAudioEndTimeRef.current) {
            console.log(`LipSync: New packet starts (${firstWordInPacketStartTime.toFixed(3)}s) at or before last processed audio end time (${lastProcessedAudioEndTimeRef.current.toFixed(3)}s). Starting animation schedule immediately (0ms).`);
        }

        let latestAudioEndTimeInCurrentPacket = 0;

        for (let wordIndex = 0; wordIndex < data.length; wordIndex++) {
            const wordData = data[wordIndex];
            let tempOriginalWordText = (wordData.word || "").trim(); // .replaceAll(" ", "_") silindi, boşluqlar filtrasiya ilə həll olunacaq
            if (wordIndex === data.length - 1) {
                tempOriginalWordText += "_"; 
                console.log(`  LipSync: Appended sentence-ending '_' to the last word. New tempOriginalWordText: "${tempOriginalWordText}"`);
            }
            const originalWordTextWithMaybeEndingUnderscore = tempOriginalWordText;
            const wordTextForAnimation = originalWordTextWithMaybeEndingUnderscore.replace(/[^a-zA-Z0-9əƏıİöÖüÜçÇşŞğĞ_]/g, '');

            const wordStartTime = typeof wordData.start === 'number' ? wordData.start : 0;
            const wordEndTime = typeof wordData.end === 'number' ? wordData.end : wordStartTime;

            if (wordStartTime > latestAudioEndTimeInCurrentPacket) {
                 latestAudioEndTimeInCurrentPacket = wordStartTime;
            }
            if (wordEndTime > latestAudioEndTimeInCurrentPacket) {
                latestAudioEndTimeInCurrentPacket = wordEndTime;
            }

            if (!wordTextForAnimation) {
                console.log(`  LipSync: Word "${originalWordTextWithMaybeEndingUnderscore}" has no animatable characters. Skipping.`);
                continue;
            }
            
            // Sözlər arası pauzanı hesabla və animationScheduleTimeMs-i yenilə
            if (wordIndex > 0) {
                const prevWordEndTime = typeof data[wordIndex - 1].end === 'number' ? data[wordIndex - 1].end : 0;
                if (wordStartTime > prevWordEndTime) {
                    const pauseBetweenWordsMs = (wordStartTime - prevWordEndTime) * 1000;
                    console.log(`  LipSync: ---> Timeout (Pause Between Words "${(data[wordIndex - 1].word || "").trim()}" and "${originalWordTextWithMaybeEndingUnderscore.replace(/_$/, '')}"): ${pauseBetweenWordsMs.toFixed(2)}ms`);
                    animationScheduleTimeMs += pauseBetweenWordsMs;
                }
            }
            // İlk söz üçün log (əgər paketlər arası pauza varsa, animationScheduleTimeMs onu göstərəcək)
            // console.log(`    Word "${originalWordTextWithMaybeEndingUnderscore}" (Word Index: ${wordIndex}): Animation schedule starts at ${animationScheduleTimeMs.toFixed(2)}ms.`);

            const wordDurationMs = Math.max(0, (wordEndTime - wordStartTime) * 1000);
            const chars = wordTextForAnimation.split('');
            let durationPerCharMs = DEFAULT_CHAR_DURATION_IF_NO_WORD_DURATION;

            if (chars.length > 0 && wordDurationMs > 0) {
                const calculatedDuration = wordDurationMs / chars.length;
                durationPerCharMs = Math.max(MIN_CALCULATED_CHAR_DURATION, calculatedDuration);
            } else if (chars.length > 0 && wordDurationMs <= 0) {
                 durationPerCharMs = DEFAULT_CHAR_DURATION_IF_NO_WORD_DURATION;
                 console.log(`      Word "${originalWordTextWithMaybeEndingUnderscore}" has ${wordDurationMs.toFixed(2)}ms audio duration. Using default char animation duration: ${durationPerCharMs}ms`);
            }
            
            console.log(`      Processing "${originalWordTextWithMaybeEndingUnderscore}" (Animates as: "${wordTextForAnimation}"). Scheduled at: ${animationScheduleTimeMs.toFixed(2)}ms, WordAudioDur: ${wordDurationMs.toFixed(2)}ms, Chars: ${chars.length}, AnimCharDur: ${durationPerCharMs.toFixed(2)}ms`);

            for (let i = 0; i < chars.length; i++) {
                
                const charScheduledTimeMs = animationScheduleTimeMs + (i * durationPerCharMs);

                const timeoutId = setTimeout(() => {
                    const char = chars[i].toLowerCase();
                    const targets = getPhonemeTargets(char);
                    console.log(`        Animating '${char}' for "${originalWordTextWithMaybeEndingUnderscore}" at ${new Date().toLocaleTimeString()}. Scheduled: ${charScheduledTimeMs.toFixed(2)}ms`);
                    modelRef.current?.updateMorphTargets(targets);
                }, charScheduledTimeMs);
                activeTimeoutsRef.current.push(timeoutId);
            }
            // Növbəti animasiya üçün cədvəl vaxtını artır
            // Hərflərin cəmi animasiya müddəti qədər artırırıq, çünki sözlər arası pauza ayrıca əlavə olunur.
            animationScheduleTimeMs += (chars.length * durationPerCharMs); 
        }

        if (latestAudioEndTimeInCurrentPacket > 0) {
            lastProcessedAudioEndTimeRef.current = latestAudioEndTimeInCurrentPacket;
            console.log(`LipSync: Updated lastProcessedAudioEndTimeRef to: ${lastProcessedAudioEndTimeRef.current.toFixed(3)}s for the processed packet.`);

            const neutralPoseDelayMs = animationScheduleTimeMs + 100; 
            const finalTimeoutId = setTimeout(() => {
                console.log(`LipSync: Packet processed. Setting to neutral pose. Scheduled at: ${neutralPoseDelayMs.toFixed(2)}ms.`);
                const neutralTargets = getPhonemeTargets('_');
                modelRef.current?.updateMorphTargets(neutralTargets);
            }, neutralPoseDelayMs);
            activeTimeoutsRef.current.push(finalTimeoutId);

            resetLastProcessedAudioEndTimeTimerRef.current = setTimeout(() => {
                console.log(`LipSync: Resetting lastProcessedAudioEndTimeRef after ${RESET_LAST_PROCESSED_AUDIO_TIME_DELAY}ms of inactivity.`);
                lastProcessedAudioEndTimeRef.current = 0;
                resetLastProcessedAudioEndTimeTimerRef.current = null;
            }, RESET_LAST_PROCESSED_AUDIO_TIME_DELAY);
        } else if (data.length > 0) {
             console.log("LipSync: Data had words, but none were animatable or had valid timings. Setting to neutral.");
             const neutralTargets = getPhonemeTargets('_');
             modelRef.current?.updateMorphTargets(neutralTargets);
        }
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
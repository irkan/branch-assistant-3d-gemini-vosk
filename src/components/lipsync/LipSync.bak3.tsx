import React, { useRef, useEffect, useState } from "react";
import { GladiaWordTimestamp } from "../speech/gladia/useGladiaRt";
import { AylaModelRef, Model, MorphTargetData } from "../character/Ayla";

export interface LipSyncRef {
    proccessLipSyncData: (data: GladiaWordTimestamp[]) => void;
    setAudioStreamer: (streamer: any) => void;
}

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {

    const modelRef = useRef<AylaModelRef>(null);
    const animationFrameId = useRef<number | null>(null);
    const phonemeQueue = useRef<Array<{phoneme: string, startTime: number, endTime: number}>>([]);
    const lastTime = useRef<number>(0);
    const lastMorphUpdate = useRef<number>(0);
    const animationStarted = useRef<number>(0);
    const frameSkipCounter = useRef<number>(0);
    const audioStreamer = useRef<any>(null);
    const audioStartTime = useRef<number>(0);
    const isAudioPlaying = useRef<boolean>(false);
    const debugInfo = useRef({
        lastProcessTime: 0,
        animationStartTime: 0,
        totalFrames: 0,
        lastQueueLength: 0
    });

    // Limitli sözləri emal etmək üçün köməkçi funksiya
    const processLimitedWords = (limitedData: GladiaWordTimestamp[], currentTime: number, audioStartTime: number) => {
        limitedData.forEach((wordData, wordIndex) => {
            const word = wordData.word.trim();
            if (!word) return;
            
            // Dinamik audio başlangıcına əsasən real vaxtları hesabla
            const wordStartTime = Math.max(audioStartTime + wordData.start, currentTime);
            const wordEndTime = Math.max(audioStartTime + wordData.end, currentTime + 0.1);
            
            const wordDuration = wordEndTime - wordStartTime;
            const chars = word.split('');
            const charDuration = wordDuration / chars.length;
            
            chars.forEach((char, index) => {
                const lowerChar = char.toLowerCase();
                const charStartTime = wordStartTime + (index * charDuration);
                const charEndTime = charStartTime + charDuration;
                
                phonemeQueue.current.push({
                    phoneme: lowerChar,
                    startTime: charStartTime,
                    endTime: charEndTime
                });
            });
            
            // Sözlər arasında kiçik fasilə
            if (wordIndex < limitedData.length - 1) {
                const nextWordData = limitedData[wordIndex + 1];
                const nextWordStartTime = Math.max(audioStartTime + nextWordData.start, currentTime);
                const gapDuration = nextWordData.start - wordData.end;
                
                if (gapDuration > 0.05) {
                    phonemeQueue.current.push({
                        phoneme: '_',
                        startTime: wordEndTime,
                        endTime: nextWordStartTime
                    });
                }
            }
        });
        
        // Son sözdən sonra ağızı bağla
        if (limitedData.length > 0) {
            const lastWord = limitedData[limitedData.length - 1];
            const lastWordEndTime = Math.max(audioStartTime + lastWord.end, currentTime + 0.1);
            const silenceEndTime = lastWordEndTime + 0.3;
            phonemeQueue.current.push({
                phoneme: '_',
                startTime: lastWordEndTime,
                endTime: silenceEndTime
            });
        }
    };

    const proccessLipSyncData = (data: GladiaWordTimestamp[]) => {
        console.log("------- LipSync: Processing new word data -------");
        console.log("Raw word timestamps:", JSON.stringify(data));
        
        // Təmizlə əvvəlki animasiya və sıranı
        if (animationFrameId.current) {
            console.log("LipSync: Cancelling previous animation frame:", animationFrameId.current);
            cancelAnimationFrame(animationFrameId.current);
            animationFrameId.current = null;
        }
        phonemeQueue.current = [];
        
        // Referansları sıfırla
        debugInfo.current.totalFrames = 0;
        lastMorphUpdate.current = 0;
        frameSkipCounter.current = 0;
        
        // Cari vaxtı götür
        const currentTime = performance.now() / 1000;
        console.log("LipSync: Current system time:", currentTime.toFixed(3) + "s");
        
        // Audio context timing istifadə et əgər mövcuddursa
        const firstWordStart = data[0]?.start || 0;
        let dynamicAudioStartTime: number;
        
        if (audioStreamer.current && audioStartTime.current > 0) {
            // Real audio context timing istifadə et
            dynamicAudioStartTime = audioStartTime.current - firstWordStart;
            console.log("LipSync: Using AudioContext timing. Audio starts at:", audioStartTime.current.toFixed(3) + "s");
            console.log("LipSync: First word starts at:", firstWordStart.toFixed(3) + "s (audio time)");
            console.log("LipSync: Calculated start time:", dynamicAudioStartTime.toFixed(3) + "s");
        } else {
            // Fallback - köhnə sistem
            dynamicAudioStartTime = currentTime - firstWordStart;
            console.log("LipSync: Using fallback timing:", dynamicAudioStartTime.toFixed(3) + "s");
        }
        
        // Debug üçün vaxtı qeyd et
        debugInfo.current = {
            lastProcessTime: currentTime,
            animationStartTime: currentTime,
            totalFrames: 0,
            lastQueueLength: 0
        };
        
        // Hər söz üçün
        data.forEach((wordData, wordIndex) => {
            const word = wordData.word.trim();
            if (!word) return;
            
            // Dinamik audio başlangıcına əsasən real vaxtları hesabla
            const wordStartTime = dynamicAudioStartTime + wordData.start;
            const wordEndTime = dynamicAudioStartTime + wordData.end;
            
            console.log(`LipSync: Processing word [${wordIndex}]: "${word}" (audio: ${wordData.start.toFixed(3)}s-${wordData.end.toFixed(3)}s, real: ${wordStartTime.toFixed(3)}s-${wordEndTime.toFixed(3)}s)`);
            
            // Əgər söz keçmişdədirsə, cari vaxtdan başlat
            const adjustedWordStartTime = Math.max(wordStartTime, currentTime);
            const adjustedWordEndTime = Math.max(wordEndTime, currentTime + 0.1);
            
            if (adjustedWordStartTime !== wordStartTime) {
                console.log(`LipSync: Adjusted word timing from ${wordStartTime.toFixed(3)}s to ${adjustedWordStartTime.toFixed(3)}s (past time fix)`);
            }
            
            const wordDuration = adjustedWordEndTime - adjustedWordStartTime;
            const chars = word.split('');
            
            // Hər hərf üçün vaxt payını hesabla
            const charDuration = wordDuration / chars.length;
            console.log(`LipSync: Word duration: ${wordDuration.toFixed(3)}s, chars: ${chars.length}, charDuration: ${charDuration.toFixed(3)}s`);
            
            chars.forEach((char, index) => {
                const lowerChar = char.toLowerCase();
                // Sözün içində hər hərf üçün vaxtı hesabla
                const charStartTime = adjustedWordStartTime + (index * charDuration);
                const charEndTime = charStartTime + charDuration;
                
                console.log(`LipSync: Char "${lowerChar}" scheduled from ${charStartTime.toFixed(3)}s to ${charEndTime.toFixed(3)}s (in ${(charStartTime - currentTime).toFixed(3)}s)`);
                
                // Sıraya əlavə et
                phonemeQueue.current.push({
                    phoneme: lowerChar,
                    startTime: charStartTime,
                    endTime: charEndTime
                });
            });
            
            // Sözlər arasında bir kiçik fasilə əlavə et
            if (wordIndex < data.length - 1) {
                const nextWordData = data[wordIndex + 1];
                const nextWordStartTime = dynamicAudioStartTime + nextWordData.start;
                const adjustedNextWordStartTime = Math.max(nextWordStartTime, currentTime);
                const gapDuration = nextWordData.start - wordData.end;
                
                console.log(`LipSync: Gap to next word: ${gapDuration.toFixed(3)}s`);
                
                if (gapDuration > 0.05) {
                    console.log(`LipSync: Adding gap phoneme from ${adjustedWordEndTime.toFixed(3)}s to ${adjustedNextWordStartTime.toFixed(3)}s`);
                    phonemeQueue.current.push({
                        phoneme: '_', // Bağlı ağız üçün boş fonema
                        startTime: adjustedWordEndTime,
                        endTime: adjustedNextWordStartTime
                    });
                }
            }
        });
        
        // Son sözdən sonra ağızı bağla
        if (data.length > 0) {
            const lastWord = data[data.length - 1];
            const lastWordEndTime = Math.max(dynamicAudioStartTime + lastWord.end, currentTime + 0.1);
            const silenceEndTime = lastWordEndTime + 0.3;
            console.log(`LipSync: Adding end silence from ${lastWordEndTime.toFixed(3)}s to ${silenceEndTime.toFixed(3)}s`);
            phonemeQueue.current.push({
                phoneme: '_',
                startTime: lastWordEndTime,
                endTime: silenceEndTime
            });
        }
        
        console.log(`LipSync: Total phonemes in queue: ${phonemeQueue.current.length}`);
        
        // Character sayına əsasən queue məhdudlaşdır (performans üçün)
        const totalCharacters = data.reduce((sum, word) => sum + word.word.trim().length, 0);
        console.log(`LipSync: Total characters in this batch: ${totalCharacters}`);
        
        if (totalCharacters > 1000) {
            console.log(`LipSync: Too many characters (${totalCharacters}), limiting to first 1000 characters`);
            // İlk 1000 character-ə uyğun sözləri saxla (daha məntiqli)
            let charCount = 0;
            const limitedData = [];
            for (let i = 0; i < data.length; i++) {
                const wordLength = data[i].word.trim().length;
                if (charCount + wordLength <= 1000) {
                    limitedData.push(data[i]);
                    charCount += wordLength;
                } else {
                    break;
                }
            }
            console.log(`LipSync: Limited to ${limitedData.length} words, ${charCount} characters`);
            // Queue-nu yenidən yarat limitli məlumatla
            phonemeQueue.current = [];
            processLimitedWords(limitedData, currentTime, dynamicAudioStartTime);
            return;
        }
        
        // Animasiya başlat
        lastTime.current = performance.now() / 1000;
        animationStarted.current = lastTime.current;
        lastMorphUpdate.current = lastTime.current;
        frameSkipCounter.current = 0;
        console.log("LipSync: Starting animation at time:", lastTime.current.toFixed(3) + "s");
        animateLipSync();
    };

    const animateLipSync = () => {
        const currentTime = performance.now() / 1000;
        const deltaTime = currentTime - lastTime.current;
        lastTime.current = currentTime;
        
        // Debug üçün frame skipping söndürülüb
        frameSkipCounter.current++;
        const shouldSkipFrame = false; // Heç bir frame-i atma (debug üçün)
        
        // Animasiya 60 saniyədən çox davam edərsə, təmizlə və dayandır
        if (currentTime - animationStarted.current > 60) {
            console.log("LipSync: Animation timeout, resetting...");
            phonemeQueue.current = [];
            const neutralTargets = getPhonemeTargets('_');
            modelRef.current?.updateMorphTargets(neutralTargets);
            animationFrameId.current = null;
            frameSkipCounter.current = 0;
            return;
        }
        
        // Debug üçün statistika
        debugInfo.current.totalFrames++;
        const elapsedSinceStart = currentTime - debugInfo.current.animationStartTime;
        
        // Hər 30 kadrda bir və ya növbə dəyişəndə log çıxar
        if (debugInfo.current.totalFrames % 30 === 0 || debugInfo.current.lastQueueLength !== phonemeQueue.current.length) {
            console.log(`LipSync: FRAME #${debugInfo.current.totalFrames}, elapsed: ${elapsedSinceStart.toFixed(2)}s, delta: ${(deltaTime * 1000).toFixed(1)}ms, queue: ${phonemeQueue.current.length}`);
            debugInfo.current.lastQueueLength = phonemeQueue.current.length;
        }
        
        // Keçmiş fonemleri sıradan çıxar
        let removedCount = 0;
        while (phonemeQueue.current.length > 0 && phonemeQueue.current[0].endTime < currentTime) {
            phonemeQueue.current.shift();
            removedCount++;
        }
        
        if (removedCount > 0) {
            console.log(`LipSync: QUEUE CHANGE - Removed ${removedCount} expired phonemes from queue`);
            
            // Hansı fonemlərin keçdiyini göstərmək üçün qalan fonemləri log et
            if (phonemeQueue.current.length > 0) {
                const nextPhonemes = phonemeQueue.current.slice(0, Math.min(5, phonemeQueue.current.length));
                console.log(`LipSync: QUEUE STATUS - Next phonemes: ${nextPhonemes.map(p => `"${p.phoneme}"`).join(", ")}`);
            }
        }
        
        // Cari fonem
        if (phonemeQueue.current.length > 0) {
            const currentPhoneme = phonemeQueue.current[0];
            const timeUntilEnd = currentPhoneme.endTime - currentTime;
            
            // Növbəti fonem (əgər varsa)
            const nextPhoneme = phonemeQueue.current.length > 1 ? phonemeQueue.current[1] : null;
            
            // Debug info - current phoneme details (hər dəfə göstər)
            console.log(`LipSync: ACTIVE PHONEME - "${currentPhoneme.phoneme}", remaining: ${timeUntilEnd.toFixed(3)}s`);
            if (nextPhoneme) {
                console.log(`LipSync: NEXT PHONEME - "${nextPhoneme.phoneme}", starts in: ${(nextPhoneme.startTime - currentTime).toFixed(3)}s`);
            }
            
            // Morph target yeniləməni throttle et - hər bir frame-də yenilə (ətraflı analiz üçün)
            const shouldUpdateMorph = true;
            
            if (shouldUpdateMorph) {
                lastMorphUpdate.current = currentTime;
                
                // Cari fonemin morph hədəflərini götür
                const currentTargets = getPhonemeTargets(currentPhoneme.phoneme);
                
                // Əgər növbəti fonem varsa və ona keçid başlayıbsa
                if (nextPhoneme && currentTime > currentPhoneme.endTime - 0.05) {
                    // Növbəti fonemin hədəflərini götür
                    const nextTargets = getPhonemeTargets(nextPhoneme.phoneme);
                    
                    // Keçid faktoru (0-1 arası)
                    const transitionProgress = Math.min(1, (currentTime - (currentPhoneme.endTime - 0.05)) / 0.05);
                    
                    console.log(`LipSync: BLEND PROGRESS - ${(transitionProgress * 100).toFixed(1)}% from "${currentPhoneme.phoneme}" to "${nextPhoneme.phoneme}"`)
                    
                    // Qarışıq hədəflər yarat
                    const blendedTargets: MorphTargetData[] = [];
                    
                    // Cari morph targetləri əlavə et
                    currentTargets.forEach(currentTarget => {
                        const nextTarget = nextTargets.find(nt => nt.morphTarget === currentTarget.morphTarget);
                        
                        if (nextTarget) {
                            // Keçid yarat
                            const currentWeight = parseFloat(currentTarget.weight);
                            const nextWeight = parseFloat(nextTarget.weight);
                            const blendedWeight = currentWeight + (nextWeight - currentWeight) * transitionProgress;
                            
                            blendedTargets.push({
                                morphTarget: currentTarget.morphTarget,
                                weight: blendedWeight.toString()
                            });
                        } else {
                            // Əgər növbəti targetdə yoxdursa, azalan ağırlıqla əlavə et
                            blendedTargets.push({
                                morphTarget: currentTarget.morphTarget,
                                weight: (parseFloat(currentTarget.weight) * (1 - transitionProgress)).toString()
                            });
                        }
                    });
                    
                    // Əlavə et növbəti morphtargetləri əgər cari target-də yoxdursa
                    nextTargets.forEach(nextTarget => {
                        const exists = currentTargets.some(ct => ct.morphTarget === nextTarget.morphTarget);
                        if (!exists) {
                            blendedTargets.push({
                                morphTarget: nextTarget.morphTarget,
                                weight: (parseFloat(nextTarget.weight) * transitionProgress).toString()
                            });
                        }
                    });
                    
                    // Morph hədəflərini yenilə və hər dəfə log göstər
                    console.log(`LipSync: MORPH UPDATE - Blend "${currentPhoneme.phoneme}" → "${nextPhoneme.phoneme}":`, 
                        JSON.stringify(blendedTargets.map(t => `${t.morphTarget}:${t.weight}`)));
                    
                    modelRef.current?.updateMorphTargets(blendedTargets);
                } else {
                    // Sadəcə cari hədəfləri istifadə et və hər dəfə log göstər
                    console.log(`LipSync: MORPH UPDATE - Phoneme "${currentPhoneme.phoneme}":`, 
                        JSON.stringify(currentTargets.map(t => `${t.morphTarget}:${t.weight}`)));
                    
                    modelRef.current?.updateMorphTargets(currentTargets);
                }
            }
        } else {
            // Sırada element yoxdursa, ağızı bağla (throttle ilə və frame skip)
            const shouldResetMouth = (currentTime - lastMorphUpdate.current >= 0.2) && !shouldSkipFrame;
            if (shouldResetMouth) {
                lastMorphUpdate.current = currentTime;
                const neutralTargets = getPhonemeTargets('_');
                console.log("LipSync: MORPH UPDATE - Neutral position:", 
                    JSON.stringify(neutralTargets.map(t => `${t.morphTarget}:${t.weight}`)));
                modelRef.current?.updateMorphTargets(neutralTargets);
            }
        }
        
        // Animasiyanı davam etdir
        if (phonemeQueue.current.length > 0) {
            animationFrameId.current = requestAnimationFrame(animateLipSync);
        } else {
            // Queue boş olduğunda audio vəziyyətini yoxla
            const timeSinceLastQueue = currentTime - animationStarted.current;
            const shouldStop = timeSinceLastQueue > 0.5 || !isAudioPlaying.current;
            
            if (shouldStop) {
                console.log("LipSync: Animation completed - no phonemes in queue or audio stopped");
                const neutralTargets = getPhonemeTargets('_');
                console.log("LipSync: MORPH UPDATE - Animation end (neutral):", 
                    JSON.stringify(neutralTargets.map(t => `${t.morphTarget}:${t.weight}`)));
                modelRef.current?.updateMorphTargets(neutralTargets);
                animationFrameId.current = null;
                frameSkipCounter.current = 0;
            } else {
                // Hələ gözlə, yeni məlumat gələ bilər və ya audio davam edir
                animationFrameId.current = requestAnimationFrame(animateLipSync);
            }
        }
    };

    // AudioStreamer callback-lərini təyin etmək üçün funksiya
    const setAudioStreamer = (streamer: any) => {
        audioStreamer.current = streamer;
        
        if (streamer) {
            // Audio başlama callback-i
            streamer.onAudioStart = (startTime: number) => {
                console.log("LipSync: Audio will start at:", startTime);
                audioStartTime.current = startTime;
            };
            
            // Audio progress callback-i  
            streamer.onAudioProgress = (currentTime: number, playing: boolean) => {
                isAudioPlaying.current = playing;
                
                // Əgər audio dayandısa və queue-da heç nə yoxdursa, lip sync-i də təmizlə
                if (!playing && phonemeQueue.current.length === 0) {
                    console.log("LipSync: Audio stopped, clearing lip sync");
                    if (animationFrameId.current) {
                        cancelAnimationFrame(animationFrameId.current);
                        animationFrameId.current = null;
                    }
                    
                    // Ağızı neutral vəziyyətə gətir
                    const neutralTargets = getPhonemeTargets('_');
                    modelRef.current?.updateMorphTargets(neutralTargets);
                }
            };
        }
    };

    React.useImperativeHandle(ref, () => ({
        proccessLipSyncData: proccessLipSyncData,
        setAudioStreamer: setAudioStreamer,
    }));

  const getPhonemeTargets = (phoneme: string | undefined): MorphTargetData[] => {
    if (!phoneme) return [{ morphTarget: "Merged_Open_Mouth", weight: "0" }];
    switch (phoneme) {
       case 'a': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.6" }];
       case 'ə': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.5" }];
       case 'i': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.6" }];
       case 'l': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'r': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'n': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'm': return [{ morphTarget: "V_Explosive", weight: "1" }];
       case 'e': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.3" }, { morphTarget: "V_Wide", weight: "0.6" }];
       case 's': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 't': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'd': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'k': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
       case 'b': return [{ morphTarget: "V_Explosive", weight: "1" }];
       case 'g': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
       case 'y': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'u': return [{ morphTarget: "V_Tight_O", weight: "1" }];
       case 'o': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.1" }, { morphTarget: "V_Tight_O", weight: "0.7" }];
       case 'ç': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'z': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'ş': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'q': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
       case 'x': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
       case 'v': return [{ morphTarget: "V_Dental_Lip", weight: "1" }];
       case 'j': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'ü': return [{ morphTarget: "V_Tight_O", weight: "1" }];
       case 'ö': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.1" }, { morphTarget: "V_Tight_O", weight: "0.7" }];
       case 'h': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
       case 'ğ': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
       case 'c': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }]; 
       case 'ı': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.6" }];
       case 'p': return [{ morphTarget: "V_Explosive", weight: "1" }];
       case 'f': return [{ morphTarget: "V_Dental_Lip", weight: "1" }];
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

    // Cleanup animation on unmount
    useEffect(() => {
        return () => {
            if (animationFrameId.current) {
                console.log("LipSync: Cleaning up animation on unmount");
                cancelAnimationFrame(animationFrameId.current);
                animationFrameId.current = null;
            }
            // Ağızı neutral vəziyyətə gətir
            if (modelRef.current) {
                const neutralTargets = getPhonemeTargets('_');
                modelRef.current.updateMorphTargets(neutralTargets);
            }
            // Bütün referansları təmizlə
            phonemeQueue.current = [];
            lastTime.current = 0;
            lastMorphUpdate.current = 0;
            animationStarted.current = 0;
            frameSkipCounter.current = 0;
        };
    }, []);

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
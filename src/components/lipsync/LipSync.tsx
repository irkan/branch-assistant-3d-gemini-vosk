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
    start: number;
    end: number;
}

export const LipSync = React.forwardRef<LipSyncRef>((props, ref) => {
    const modelRef = useRef<AylaModelRef>(null);
    const phonemeQueue = useRef<PhonemeItem[]>([]);
    const animationFrameId = useRef<number | null>(null);
    const isProcessing = useRef<boolean>(false);
    const timeoutId = useRef<NodeJS.Timeout | null>(null);
    const id = useRef<number>(0);
    const lastPhoneme = useRef<string>('_');
    const lastDataTimestamp = useRef<number>(Date.now());
    const inactivityTimeoutId = useRef<NodeJS.Timeout | null>(null);

    // Ağızı bağlamaq üçün 3 saniyəlik taymer başladır
    const startInactivityTimer = () => {
        // Əvvəlki taymeri təmizlə
        if (inactivityTimeoutId.current) {
            clearTimeout(inactivityTimeoutId.current);
            inactivityTimeoutId.current = null;
        }
        
        // Son məlumat vaxtını yenilə
        lastDataTimestamp.current = Date.now();
        
        // 3 saniyə sonra ağızı bağlamaq üçün taymer qur
        inactivityTimeoutId.current = setTimeout(() => {
            // Əgər növbə boşdursa və son fonem "_" deyilsə, ağızı bağla
            if (phonemeQueue.current.length === 0 && lastPhoneme.current !== '_') {
                console.log("3 seconds of inactivity timeout, closing mouth");
                
                // Ağızı bağlamaq üçün boş fonem əlavə et
                phonemeQueue.current.push({
                    id: id.current++,
                    phoneme: "_",
                    duration: 300, // 300ms müddəti
                    session: 0,
                    start: 0,
                    end: 0
                });
            }
        }, 3000);
    };

    // Növbəni avtomatik izləmək üçün watcher
    useEffect(() => {
        // İlkin taymeri başlat
        startInactivityTimer();
        
        // Asinxron işləyən funksiya
        const checkQueue = () => {
            // Əgər növbədə fonem varsa və emal prosesi işləmirsə
            if (phonemeQueue.current.length > 0 && !isProcessing.current) {
                isProcessing.current = true;
                processQueue();
            }
            
            // Əgər növbə boşdursa və son məlumatdan 3 saniyə keçibsə, ağızı bağla
            const currentTime = Date.now();
            if (phonemeQueue.current.length === 0 && 
                currentTime - lastDataTimestamp.current > 3000 && 
                lastPhoneme.current !== '_') {
                
                console.log("3 seconds of inactivity detected, closing mouth");
                
                // Ağızı bağlamaq üçün boş fonem əlavə et
                phonemeQueue.current.push({
                    id: id.current++,
                    phoneme: "_",
                    duration: 300, // 300ms müddəti
                    session: 0,
                    start: 0,
                    end: 0
                });
        
                // Son fonemi yenilə
                lastPhoneme.current = '_';
                
                // Vaxtı yenilə
                lastDataTimestamp.current = currentTime;
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
            if (inactivityTimeoutId.current) {
                clearTimeout(inactivityTimeoutId.current);
        }
        };
    }, []);

    // İki morph target dəsti arasında interpolasiya et
    const interpolateMorphTargets = (
        fromPhoneme: string,
        toPhoneme: string,
        progress: number
    ): MorphTargetData[] => {
        // Başlanğıc və hədəf morph target-lərini al
        const fromTargets = getPhonemeTargets(fromPhoneme);
        const toTargets = getPhonemeTargets(toPhoneme);
        
        // Bütün morph target adlarını topla
        const allMorphTargets = new Set<string>();
        fromTargets.forEach(item => allMorphTargets.add(item.morphTarget));
        toTargets.forEach(item => allMorphTargets.add(item.morphTarget));
        
        // Hər bir morph target üçün interpolasiya edilmiş dəyər hesabla
        const result: MorphTargetData[] = [];
        
        allMorphTargets.forEach(morphTarget => {
            const fromItem = fromTargets.find(item => item.morphTarget === morphTarget);
            const toItem = toTargets.find(item => item.morphTarget === morphTarget);
            
            const fromWeight = fromItem ? parseFloat(fromItem.weight) : 0;
            const toWeight = toItem ? parseFloat(toItem.weight) : 0;
            
            // Linear interpolasiya
            const interpolatedWeight = fromWeight + (toWeight - fromWeight) * progress;
            
            result.push({
                morphTarget,
                weight: interpolatedWeight.toString()
            });
        });
        
        return result;
    };

    const proccessLipSyncData = (data: GladiaWordTimestamp[], sequenceNumber: number = 0) => {
        // console.log(`LipSync: Processing new word data with sequence ${sequenceNumber}:`, data);
        const gapDuration = 35;
        
        // İnaktivlik taymerini yenidən başlat
        startInactivityTimer();
        
        // Növbədə element var və son elementin session ID-si gələn session ID-dən fərqlidirsə
        if (phonemeQueue.current.length > 0 && 
            phonemeQueue.current[phonemeQueue.current.length - 1].session !== sequenceNumber) {
            
            // console.log(`LipSync: Session changed from ${phonemeQueue.current[phonemeQueue.current.length - 1].session} to ${sequenceNumber}, clearing queue`);
            
            // Növbəni təmizlə
            phonemeQueue.current = [];
            
            // Əgər emal prosesi gedirsə, dayandır
            if (isProcessing.current && timeoutId.current) {
                clearTimeout(timeoutId.current);
                timeoutId.current = null;
                isProcessing.current = false;
            }
        }
        
        // Əgər birinci sozdurse ve növbədə element varsa, sözlər arası boşluq əlavə et
        if (data.length > 0 && data[0] && phonemeQueue.current.length > 0) {
            // Boşluq üçün "_" fonem əlavə et
            const start = phonemeQueue.current[phonemeQueue.current.length - 1].end;
            const end = data[0].start;
            const charDuration = Math.round((end-start) * 1000)-gapDuration;
            phonemeQueue.current.push({
                id: id.current++,
                phoneme: '_',
                duration: charDuration,
                session: sequenceNumber,
                start: start,
                end: end
            });
            
            // console.log(`PHONEME: char="_", ID: ${id.current}, duration=${Math.round((end-start) * 1000)}, seq=${sequenceNumber}, start=${start}, end=${end}`);
        }
        
        // Hər söz üçün analiz et
        data.forEach((wordData, wordIndex) => {
            const word = wordData.word.toLowerCase().trim().replace(/[^a-zA-Z0-9əƏıİöÖüÜçÇşŞğĞ]/g, '');
            if (!word) return;
            
            // Əgər birinci sozdurse ve növbədə element varsa, sözlər arası boşluq əlavə et
            if (wordIndex==0 && phonemeQueue.current.length > 0) {
                // Boşluq üçün "_" fonem əlavə et
                const start = phonemeQueue.current[phonemeQueue.current.length - 1].end;
                const end = wordData.start;
                const charDuration = Math.round((end-start) * 1000)-gapDuration;
                phonemeQueue.current.push({
                    id: id.current++,
                    phoneme: '_',
                    duration: charDuration,
                    session: sequenceNumber,
                    start: start,
                    end: end
                });
                
                // console.log(`PHONEME: char="_", ID: ${id.current}, duration=${Math.round((end-start) * 1000)}, seq=${sequenceNumber}, start=${start}, end=${end}`);
            }
            
            // Sözün müddətini hesabla
            let wordDuration = wordData.end - wordData.start;
 
            // Əgər növbəti söz varsa, sözlər arası boşluq əlavə et
            if (wordIndex < data.length-1) {
                const nextWordData = data[wordIndex + 1];
                wordDuration = wordDuration + (nextWordData.start - wordData.end);
            }   
            
            // Sözü hərflərə parçala
            const chars = word.split('');
            
            // Hər hərf üçün vaxt hesabla - bütün hərflər üçün eyni müddət
            const originalChars = chars.length;
            const charDuration = Math.round((wordDuration / originalChars) * 1000)-gapDuration;
            
            // console.log(`Word "${word}" has ${originalChars} chars, each with duration: ${charDuration}ms`);
            
            // Sait səsləri və samit səsləri müəyyən et
            const vowels = ['a', 'e', 'ə', 'i', 'ı', 'o', 'ö', 'u', 'ü'];
            const consonantsToRemove = ['r', 'n', 's', 't', 'd', 'k', 'g', 'y', 'ç', 'z', 'ş', 'q', 'x', 'j', 'h', 'ğ', 'c', 'l'];
            
            // Sözü hərflərə ayır və yalnız istədiyimiz hərfləri saxla
            const filteredChars: {char: string, duration: number, originalIndex: number}[] = [];
            
            // Səslərin emal edilib-edilmədiyini izləmək üçün
            const processedIndices = new Set<number>();
            
            // Əvvəlcə sait səsləri taparaq onları və ətrafındakıları emal et
            for (let i = 0; i < chars.length; i++) {
                if (processedIndices.has(i)) continue; // Bu indeks artıq emal edilib
                
                const char = chars[i].toLowerCase();
                
                // Əgər saitdirsə
                if (vowels.includes(char)) {
                    processedIndices.add(i); // Saiti emal edilmiş kimi qeyd et
                    
                    // Hər sait öz müddətinə sahibdir
                    let vowelDuration = charDuration;
                    let consonantsBefore = [];
                    let consonantsAfter = [];
                    
                    // Saitdən əvvəlki 1 samiti yoxla
                    if (i > 0 && !processedIndices.has(i-1)) {
                        const prevChar = chars[i-1].toLowerCase();
                        if (consonantsToRemove.includes(prevChar)) {
                            consonantsBefore.push(i-1);
                            vowelDuration += charDuration; // Əvvəlki samitin müddətini əlavə et
                            processedIndices.add(i-1); // Bu samiti emal edilmiş kimi qeyd et
                        }
                    }
                    
                    // Saitdən sonrakı 2 səsi yoxla
                    for (let j = 1; j <= 2; j++) {
                        if (i+j < chars.length && !processedIndices.has(i+j)) {
                            const nextChar = chars[i+j].toLowerCase();
                            
                            // Əgər samitdirsə
                            if (consonantsToRemove.includes(nextChar)) {
                                // Əgər bu sonrakı sait deyilsə və ya sonuncu samitdirsə
                                if (j === 2 || !vowels.includes(chars[i+j+1]?.toLowerCase())) {
                                    consonantsAfter.push(i+j);
                                    vowelDuration += charDuration; // Sonrakı samitin müddətini əlavə et
                                    processedIndices.add(i+j); // Bu samiti emal edilmiş kimi qeyd et
                                }
                            } 
                            // Əgər saitdirsə, sonrakı samitləri yoxlamağı dayandır
                            else if (vowels.includes(nextChar)) {
                                break;
                            }
                        }
                    }
                    
                    // Sait və onun hesablanmış müddətini filteredChars-a əlavə et
                    filteredChars.push({char: char, duration: vowelDuration, originalIndex: i});
                }
            }
            
            // İndi də emal edilməmiş hərfləri əlavə et
            for (let i = 0; i < chars.length; i++) {
                if (!processedIndices.has(i)) {
                    const char = chars[i].toLowerCase();
                    
                    // Əgər emal edilməmiş samitdirsə və silinməməlidirsə, əlavə et
                    if (!consonantsToRemove.includes(char)) {
                        filteredChars.push({char: char, duration: charDuration, originalIndex: i});
                        processedIndices.add(i);
                }
            }
            }
            
            // Filteredchars-ı sözün orijinal sırasına görə sırala
            filteredChars.sort((a, b) => a.originalIndex - b.originalIndex);
            
            // Debug məqsədilə, çıxışı yoxla
            // console.log("Original word:", word);
            // console.log("Filtered chars:", filteredChars.map(c => c.char).join(""));

            // Filteredchars-ı istifadə edərək fonemləri əlavə et

            let start = wordData.start;
            let end = wordData.end;

            filteredChars.forEach(({char, duration}) => {
                // Queue-yə əlavə et
                end = (start+duration/1000);
            phonemeQueue.current.push({
                    id: id.current++,
                    phoneme: char,
                    duration: duration,
                    session: sequenceNumber,
                    start: start,
                    end: end
                });
                
                // console.log(`PHONEME: char="${char}", ID: ${id.current}, duration=${duration.toFixed(3)}, seq=${sequenceNumber}, start=${start}, end=${end}`);
            
                start = end;
            }); 
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
            const phonemeDuration = phoneme.duration;
            const transitionDuration = Math.min(Math.max(phonemeDuration / 3, 25), 75);
            
            // Transition mərhələsini başlat
            applyTransition(lastPhoneme.current, phoneme.phoneme, transitionDuration);
            
            // Sonra qalan müddət üçün tam morph target tətbiq et
            setTimeout(() => {
                const targets = getPhonemeTargets(phoneme.phoneme);
                modelRef.current?.updateMorphTargets(targets);
                
                // Cari fonemi yadda saxla
                lastPhoneme.current = phoneme.phoneme;
            }, transitionDuration);
            
            console.log(`PROCESSED: char="${phoneme.phoneme}", ID: ${phoneme.id}, duration=${phoneme.duration.toFixed(3)}, seq=${phoneme.session}, transition: ${transitionDuration.toFixed(0)}ms`);
        }
        
        // Növbəti addım üçün müddəti hesabla
        if (phonemeQueue.current.length > 0) {
            timeoutId.current = setTimeout(() => {
                processQueue();
            }, phoneme?.duration || 88); // Default to 88ms if duration is undefined
        } else {
            console.log("QUEUE_EMPTY");
            isProcessing.current = false;
        }
    };
    
    // Transition funksiyası
    const applyTransition = (fromPhoneme: string, toPhoneme: string, duration: number) => {
        // Neçə addımda keçid etmək lazımdır
        const steps = 10; // 10 addımda keçid
        const stepDuration = duration / steps;
        
        // Hər addım üçün
        for (let i = 1; i <= steps; i++) {
            const progress = i / steps; // 0.1, 0.2, ..., 1.0
            
            setTimeout(() => {
                // Cari progress üçün interpolasiya edilmiş morph target-ləri hesabla
                const interpolatedTargets = interpolateMorphTargets(fromPhoneme, toPhoneme, progress);
                
                // Tətbiq et
                modelRef.current?.updateMorphTargets(interpolatedTargets);
            }, stepDuration * i);
        }
    };

    React.useImperativeHandle(ref, () => ({
        proccessLipSyncData: proccessLipSyncData,
    }));

    const getPhonemeTargets = (phoneme: string | undefined): MorphTargetData[] => {
        if (!phoneme) return [{ morphTarget: "Merged_Open_Mouth", weight: "0" }];
        switch (phoneme) {
            case 'a': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.4" }];
            case 'ə': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.5" }];
            case 'i': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }, { morphTarget: "V_Wide", weight: "0.5" }];
            //case 'l': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
            //case 'r': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
            //case 'n': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.2" }];
            case 'm': return [{ morphTarget: "V_Explosive", weight: "1" }];
            case 'e': return [{ morphTarget: "Merged_Open_Mouth", weight: "0.3" }, { morphTarget: "V_Wide", weight: "0.4" }];
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
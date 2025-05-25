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
        // console.log(`LipSync: Processing new word data with sequence ${sequenceNumber}:`, data);
        const gapDuration = 35;
        
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
import React, { useState, useEffect, useRef, useCallback } from 'react';

const LIPSINC_CHAR_INTERVAL = 150; // Hər bir hərf üçün interval (ms)

interface LipSyncProps {
  transcriptionData: {
    transcript: string;
    isFinal: boolean;
  } | null;
}

const LipSync: React.FC<LipSyncProps> = ({ transcriptionData }) => {
  const charQueueRef = useRef<string[]>([]); // Göstəriləcək simvolların aktiv növbəsi
  const processedQueueRef = useRef<string[]>([]); // Artıq göstərilmiş simvolların növbəsi
  const lastDataRef = useRef<LipSyncProps['transcriptionData']>(null);
  const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearAnimationInterval = useCallback(() => {
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }
  }, []);

  const startCharAnimation = useCallback(() => {
    clearAnimationInterval(); 

    if (charQueueRef.current.length > 0) { // Aktiv növbədə simvol varsa
      animationIntervalRef.current = setInterval(() => {
        if (charQueueRef.current.length > 0) {
          const charToLog = charQueueRef.current.shift(); // Əvvəldən götür və sil
          if (charToLog) { // undefined olmaması üçün yoxlama
            processedQueueRef.current.push(charToLog); // İşlənmişlər növbəsinə at
            console.log(
              `👄 [Pull] '${charToLog}'`, 
              {
                activeQueue: [...charQueueRef.current],
                activeQueueSize: charQueueRef.current.length,
                processedQueue: [...processedQueueRef.current],
                processedQueueSize: processedQueueRef.current.length
              }
            );
          }
        } else {
          clearAnimationInterval();
          if (lastDataRef.current?.isFinal && processedQueueRef.current.length > 0) {
            console.log(`🏁 --- [LipSync] Son transkript üçün bütün hərflər göstərildi (${processedQueueRef.current.join('')}) ---`);
          }
        }
      }, LIPSINC_CHAR_INTERVAL);
    } else {
      if (lastDataRef.current?.isFinal && processedQueueRef.current.length > 0) {
         console.log(`🏁 --- [LipSync] Son transkript üçün bütün hərflər göstərildi (aktiv növbə boş idi): ${processedQueueRef.current.join('')} ---`);
      }
    }
  }, [clearAnimationInterval]);

  const updateTranscriptQueue = useCallback((data: LipSyncProps['transcriptionData']) => {
    console.log('[Push] updateTranscriptQueue çağırıldı, data:', data);
    if (!data) {
      charQueueRef.current = [];
      processedQueueRef.current = []; 
      lastDataRef.current = null;
      clearAnimationInterval();
      console.log('[Push] Data yoxdur, bütün növbələr təmizləndi.', 
        {
          activeQueue: [...charQueueRef.current],
          activeQueueSize: charQueueRef.current.length,
          processedQueue: [...processedQueueRef.current],
          processedQueueSize: processedQueueRef.current.length
        }
      );
      return;
    }

    const { transcript: newText, isFinal: newIsFinal } = data;
    const newChars = newText.split('');
    const oldDataWasFinal = lastDataRef.current?.isFinal;
    let updateReason = '';

    if (newIsFinal) {
      updateReason = 'Final transkript alındı';
      processedQueueRef.current = []; 
      charQueueRef.current = [];
      newChars.forEach(char => charQueueRef.current.push(char));
    } else {
      if (oldDataWasFinal === true || !lastDataRef.current) {
        updateReason = 'Yeni qismən cümlə başlanır (əvvəlki final idi və ya ilk data)';
        processedQueueRef.current = []; 
        charQueueRef.current = [];
        newChars.forEach(char => charQueueRef.current.push(char));
      } else {
        const currentAnimatedPrefix = processedQueueRef.current.join('');
        if (newText.startsWith(currentAnimatedPrefix)) {
          updateReason = 'Qismən cümlə dəqiqləşdirilir/davam etdirilir';
          charQueueRef.current = []; // Aktiv növbəni sıfırla
          const remainingNewChars = newText.substring(currentAnimatedPrefix.length).split('');
          remainingNewChars.forEach(char => charQueueRef.current.push(char));
        } else {
          updateReason = 'Qismən cümlə uyğun deyil, tamamilə yenilənir';
          processedQueueRef.current = []; 
          charQueueRef.current = [];
          newChars.forEach(char => charQueueRef.current.push(char));
        }
      }
    }
    console.log(
      `[Push] Növbələr yeniləndi. Səbəb: ${updateReason}`,
      {
        activeQueue: [...charQueueRef.current],
        activeQueueSize: charQueueRef.current.length,
        processedQueue: [...processedQueueRef.current],
        processedQueueSize: processedQueueRef.current.length,
        newText
      }
    );
    lastDataRef.current = data;
    startCharAnimation();

  }, [startCharAnimation, clearAnimationInterval]);

  useEffect(() => {
    updateTranscriptQueue(transcriptionData);
    
    return () => {
      clearAnimationInterval();
    };
  }, [transcriptionData, updateTranscriptQueue, clearAnimationInterval]);

  return null; 
};

export default LipSync;


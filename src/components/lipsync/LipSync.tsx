import React, { useEffect, useRef, useCallback } from 'react';

interface WordInfo {
  word: string;
  startTime: string;
  endTime: string;
}

interface LipSyncProps {
  transcriptionData: {
    transcript: string;
    isFinal: boolean;
    words?: WordInfo[];
  } | null;
}

const LIPSINC_INTERVAL_MS = 100; // Intervalı sabit olaraq təyin edirik

const LipSync: React.FC<LipSyncProps> = ({ transcriptionData }) => {
  const simpleCharQueueRef = useRef<string[]>([]); // Gələn simvollar üçün növbə
  const processedCharQueueRef = useRef<string[]>([]); // İşlənmiş simvollar üçün növbə
  const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearAnimationInterval = useCallback(() => {
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
      console.log('Animasiya intervalı təmizləndi.');
    }
  }, []);

  // METOD 2: Növbədəki simvolları emal edən və animasiyanı idarə edən funksiya
  const processQueuedCharacters = useCallback(() => {
    clearAnimationInterval(); // Potensial çoxsaylı intervalların qarşısını almaq üçün əvvəlcə təmizləyirik

    if (simpleCharQueueRef.current.length === 0) {
      console.log("Animasiya üçün 'simpleCharQueueRef' boşdur. Başladılmır.");
      return;
    }

    console.log('Simvol emalı animasiyası başladılır...');
    animationIntervalRef.current = setInterval(() => {
      if (simpleCharQueueRef.current.length > 0) {
        const charToProcess = simpleCharQueueRef.current.shift(); 
        if (charToProcess) {
          processedCharQueueRef.current.push(charToProcess); 
          console.log(
            `👄 [Animasiya] Simvol köçürüldü: '${charToProcess}'`, 
            {
              qalanAktivQueue: [...simpleCharQueueRef.current],
              qalanAktivQueueSize: simpleCharQueueRef.current.length,
              islenmisQueue: [...processedCharQueueRef.current],
              islenmisQueueSize: processedCharQueueRef.current.length
            }
          );
        }
      } else {
        console.log("🏁 'simpleCharQueueRef' boşaldı, animasiya dayandırılır.");
        clearAnimationInterval();
      }
    }, LIPSINC_INTERVAL_MS);
  }, [clearAnimationInterval]);

  // METOD 1: Yeni transkript məlumatını qəbul edən və simpleCharQueueRef-ə əlavə edən funksiya
  const ingestTranscriptData = useCallback((data: LipSyncProps['transcriptionData']) => {
    if (data && data.transcript) {
      const newChars = data.transcript.split('');
      newChars.forEach(char => {
        simpleCharQueueRef.current.push(char);
      });
      console.log("👄 [Növbə Güncəlləndi] 'simpleCharQueueRef' mövcud simvollar:", [...simpleCharQueueRef.current]);
      
      // Əgər animasiya intervalı aktiv deyilsə və növbədə simvol varsa, animasiyanı başlat
      if (simpleCharQueueRef.current.length > 0) {
        processQueuedCharacters();
      }
    } else if (!data) {
      // Transkript datası null gələrsə
      console.log('Transkript datası yoxdur. Hər iki növbə təmizlənir və animasiya dayandırılır.');
      simpleCharQueueRef.current = [];
      processedCharQueueRef.current = [];
      clearAnimationInterval();
    }
  }, [processQueuedCharacters, clearAnimationInterval]); // processQueuedCharacters və clearAnimationInterval dependensiyalara əlavə edildi

  useEffect(() => {
    console.log('LipSync tərəfindən alınan transcriptionData:', transcriptionData);
    ingestTranscriptData(transcriptionData); // Birinci metodu çağırırıq

    // Komponent unmount olduqda intervalı təmizlə
    return () => {
      clearAnimationInterval();
    };
  }, [transcriptionData, ingestTranscriptData, clearAnimationInterval]);

  return null; 
};

export default LipSync;


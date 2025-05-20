import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import LipSync from '../lipsync/LipSync'; // LipSync komponentini import edirik

interface WordInfo {
  word: string;
  startTime: string;
  endTime: string;
}

interface SpeechStreamerResponse {
  result?: {
    word: string;
    start: number;
    end: number;
    conf: number;
  }[];
  text?: string;
  partial?: string;
  type?: string;
  transcript?: string;
  words?: WordInfo[];
  isFinal?: boolean;
}

export interface SpeechStreamerRef {
  sendAudio: (audioData: ArrayBuffer) => void;
  isConnected: () => boolean;
}

const SpeechStreamerComponent = forwardRef<SpeechStreamerRef, {}>((props, ref) => {
  const [transcript, setTranscript] = useState('');
  const [visemes, setVisemes] = useState<SpeechStreamerResponse['result']>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const processingRef = useRef(false);

  // LipSync komponentinə ötürmək üçün yeni state
  const [latestTranscriptionForLipSync, setLatestTranscriptionForLipSync] = useState<{
    transcript: string;
    isFinal: boolean;
    words?: WordInfo[];
  } | null>(null);

  const connectToSpeechStreamer = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('SpeechStreamer serverinə artıq qoşulub');
      return;
    }

    try {
      console.log('SpeechStreamer serverinə qoşulmağa cəhd edilir...');
      const ws = new WebSocket('ws://localhost:3001');
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('SpeechStreamer serverinə qoşuldu');
        setIsConnected(true);
        processAudioQueue();
      };

      ws.onmessage = (event) => {
        try {
          const data: SpeechStreamerResponse = JSON.parse(event.data);
          
          // Add a detailed log for transcription type messages
          if (data.type === 'transcription') {
            console.log('RAW TRANSCRIPTION DATA:', JSON.stringify(data, null, 2));
          }

          if (data.result) {
            console.log('✅ SpeechStreamer Tanınmış mətn (Köhnə format):', data.text);
            console.log('📊 SpeechStreamer Viseme məlumatları (Köhnə format):', data.result);
            setVisemes(data.result);
            setTranscript(data.text || '');
            setLatestTranscriptionForLipSync(null); // Köhnə formatda lipsync məlumatı yoxdur

          } else if (data.partial) {
            console.log('🔄 SpeechStreamer Qismən tanınma (Köhnə format):', data.partial);
            setTranscript(data.partial || '');
            // Köhnə formatdakı qismən nəticəni də LipSync-ə göndərə bilərik (isFinal: false ilə)
            setLatestTranscriptionForLipSync({
              transcript: data.partial || "",
              isFinal: false,
              words: data.words,
            });

          } else if (data.type === 'transcription' && typeof data.transcript === 'string') {
            console.log('📩 SpeechStreamer SpeechStreamer cavabı (Yeni Format):', data);
            setTranscript(data.transcript || ''); // Ümumi transkripti yeniləyirik
            setLatestTranscriptionForLipSync({
              transcript: data.transcript || "",
              isFinal: !!data.isFinal,
              words: data.words,
            });
          } else {
            console.log('📩 SpeechStreamer SpeechStreamer cavabı (Format təyin edilmədi və ya fərqli köhnə format):', data);
            setLatestTranscriptionForLipSync(null); // Tanınmayan formatda lipsync məlumatı yoxdur
          }
        } catch (error) {
          console.error('SpeechStreamer cavabının təhlili zamanı xəta:', error);
          setLatestTranscriptionForLipSync(null);
        }
      };

      ws.onclose = (event) => {
        console.log(`SpeechStreamer serverindən bağlantı kəsildi (${event.code}). Yenidən qoşulmağa çalışılır...`);
        setIsConnected(false);
        
        // Yenidən qoşulma
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectToSpeechStreamer();
            reconnectTimeoutRef.current = null;
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket xətası:', error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error('SpeechStreamer qoşulma xətası:', error);
      setIsConnected(false);
    }
  };

  // Audio məlumatlar növbəsini işləmək
  const processAudioQueue = () => {
    if (processingRef.current) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    
    processingRef.current = true;
    
    const processNext = () => {
      if (audioQueueRef.current.length === 0) {
        processingRef.current = false;
        return;
      }
      
      const audioData = audioQueueRef.current.shift();
      if (audioData && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        try {
          socketRef.current.send(audioData);
          setTimeout(processNext, 10); // Növbəti məlumatı emal etmək üçün kiçik gecikmə
        } catch (error) {
          console.error('Audio göndərmə xətası:', error);
          processingRef.current = false;
        }
      } else {
        processingRef.current = false;
      }
    };
    
    processNext();
  };

  // Ref vasitəsilə metodları təqdim etmək
  useImperativeHandle(ref, () => ({
    sendAudio: (audioData: ArrayBuffer) => {
      if (!isConnected) {
        if (socketRef.current?.readyState !== WebSocket.OPEN) {
          console.log('SpeechStreamer serverinə qoşulmağa çalışılır...');
          connectToSpeechStreamer();
        }
      }
      
      // Audio datanı növbəyə əlavə et
      audioQueueRef.current.push(audioData);
      
      // Növbəni emal etməyə başla
      if (!processingRef.current) {
        processAudioQueue();
      }
    },
    isConnected: () => isConnected
  }));

  // İlk yükləmə zamanı WebSocket bağlantısını yarat
  useEffect(() => {
    connectToSpeechStreamer();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []); // Boş dependency array, yalnız mount və unmount zamanı işləyir

  return (
      <LipSync transcriptionData={latestTranscriptionForLipSync} />
  );
});

export default SpeechStreamerComponent;
export type { SpeechStreamerResponse };

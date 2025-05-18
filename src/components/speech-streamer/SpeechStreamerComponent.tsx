import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

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
  words?: any[];
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

  // WebSocket bağlantısı yaratmaq
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
        
        // Növbədə olan bütün audio məlumatlarını göndər
        processAudioQueue();
      };

      ws.onmessage = (event) => {
        try {
          const data: SpeechStreamerResponse = JSON.parse(event.data);
          
          if (data.result) {
            console.log('✅ SpeechStreamer Tanınmış mətn:', data.text);
            console.log('📊 SpeechStreamer Viseme məlumatları:', data.result);
            setVisemes(data.result);
            setTranscript(data.text || '');
          } else if (data.partial) {
            console.log('🔄 SpeechStreamer Qismən tanınma:', data.partial);
          } else {
            console.log('📩 SpeechStreamer SpeechStreamer cavabı:', data);  
          }
        } catch (error) {
          console.error('SpeechStreamer cavabının təhlili zamanı xəta:', error);
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
  }, []);

  return (
    <div>
      {/* İstəyə görə tanınma nəticələrini göstərmək üçün UI elementləri */}
      <div style={{ display: 'none' }}>
        <div>SpeechStreamer bağlantısı: {isConnected ? 'Aktiv ✅' : 'Qırılıb ❌'}</div>
        {transcript && <div>Tanınmış mətn: {transcript}</div>}
      </div>
    </div>
  );
});

export default SpeechStreamerComponent;
export type { SpeechStreamerResponse };

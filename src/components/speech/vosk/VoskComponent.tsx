import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

interface VoskResponse {
  result?: {
    word: string;
    start: number;
    end: number;
    conf: number;
  }[];
  text?: string;
  partial?: string;
}

export interface VoskRef {
  sendAudio: (audioData: ArrayBuffer) => void;
  isConnected: () => boolean;
}

const VoskComponent = forwardRef<VoskRef, {}>((props, ref) => {
  const [transcript, setTranscript] = useState('');
  const [visemes, setVisemes] = useState<VoskResponse['result']>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const processingRef = useRef(false);

  // WebSocket bağlantısı yaratmaq
  const connectToVosk = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('Vosk serverinə artıq qoşulub');
      return;
    }

    try {
      console.log('Vosk serverinə qoşulmağa cəhd edilir...');
      const ws = new WebSocket('ws://localhost:2700');
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('Vosk serverinə qoşuldu');
        setIsConnected(true);
        
        // Növbədə olan bütün audio məlumatlarını göndər
        processAudioQueue();
      };

      ws.onmessage = (event) => {
        try {
          const data: VoskResponse = JSON.parse(event.data);
          
          if (data.result) {
            console.log('✅ Tanınmış mətn:', data.text);
            console.log('📊 Viseme məlumatları:', data.result);
            setVisemes(data.result);
            setTranscript(data.text || '');
          } else if (data.partial) {
            console.log('🔄 Qismən tanınma:', data.partial);
          } else {
            console.log('📩 Vosk cavabı:', data);
          }
        } catch (error) {
          console.error('Vosk cavabının təhlili zamanı xəta:', error);
        }
      };

      ws.onclose = (event) => {
        console.log(`Vosk serverindən bağlantı kəsildi (${event.code}). Yenidən qoşulmağa çalışılır...`);
        setIsConnected(false);
        
        // Yenidən qoşulma
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectToVosk();
            reconnectTimeoutRef.current = null;
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket xətası:', error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error('Vosk qoşulma xətası:', error);
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
          console.log('Vosk serverinə qoşulmağa çalışılır...');
          connectToVosk();
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
    connectToVosk();

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
        <div>Vosk bağlantısı: {isConnected ? 'Aktiv ✅' : 'Qırılıb ❌'}</div>
        {transcript && <div>Tanınmış mətn: {transcript}</div>}
      </div>
    </div>
  );
});

export default VoskComponent;
export type { VoskResponse };

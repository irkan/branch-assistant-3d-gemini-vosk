import { useRef, useEffect, useCallback, useState } from 'react';

// Bu interfeysi export et
export interface SpeechStreamerProcessorHandle {
  sendAudio: (audioData: ArrayBuffer) => void;
  startStream: () => void; 
  stopStream: () => void;  
  isConnected: () => boolean;
  setLanguage: (languageCode: string) => void; 
}

const SPEECH_STREAMER_WEBSOCKET_PORT = 3001;
const DEFAULT_SAMPLE_RATE = 16000;

const useSpeechStreamerProcessor = (
  // Parametr sırasını düzəlt: əvvəlcə initialLanguageCode, sonra callbacks
  initialLanguageCode: string = 'az-AZ',
  callbacks: {
    onTranscription?: (text: string, isFinal: boolean) => void;
    onError?: (error: string) => void;
    onConnected?: (status: boolean) => void;
  }
): SpeechStreamerProcessorHandle => {
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState(initialLanguageCode);

  const { onTranscription, onError, onConnected } = callbacks;

  const connectWebSocket = useCallback(() => {
    const wsUrl = `ws://localhost:${SPEECH_STREAMER_WEBSOCKET_PORT}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      setIsConnected(true);
      if (onConnected) onConnected(true);
      wsRef.current?.send(JSON.stringify({ config: { sample_rate: DEFAULT_SAMPLE_RATE } }));
      audioQueueRef.current.forEach(audioData => wsRef.current?.send(audioData));
      audioQueueRef.current = [];
    };

    wsRef.current.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data as string);
        if (result.text && onTranscription) {
          onTranscription(result.text, true);
        } else if (result.partial && onTranscription) {
          onTranscription(result.partial, false);
        }
      } catch (e) {
        console.error("useSpeechStreamerProcessor: Error parsing SpeechStreamer message", e);
        if (onError) onError("Error parsing server message");
      }
    };

    wsRef.current.onclose = () => {
      setIsConnected(false);
      if (onConnected) onConnected(false);
      // setTimeout(connectWebSocket, 3000); // Avtomatik yenidən qoşulmanı şərhə saldım
    };

    wsRef.current.onerror = (errorEvent) => {
      console.error('useSpeechStreamerProcessor: SpeechStreamer WebSocket error:', errorEvent);
      setIsConnected(false);
      if (onConnected) onConnected(false);
      if (onError) onError("WebSocket connection error");
    };
  }, [onTranscription, onError, onConnected]); // currentLanguage-i çıxartdım, çünki SpeechStreamer-a birbaşa təsir etmir

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null; 
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  const sendAudio = (audioData: ArrayBuffer) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioData);
    } else {
      audioQueueRef.current.push(audioData);
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connectWebSocket();
      }
    }
  };

  const startStream = () => { /* SpeechStreamer üçün xüsusi əmr yoxdur */ };
  const stopStream = () => { /* SpeechStreamer üçün xüsusi əmr yoxdur */ };

  const setLanguageInternal = (languageCode: string) => {
    setCurrentLanguage(languageCode);
    // Qeyd: Bu, yalnız daxili state-i yeniləyir. SpeechStreamer üçün dil serverdəki modelə görədir.
  };

  return {
    sendAudio,
    startStream,
    stopStream,
    isConnected: () => isConnected,
    setLanguage: setLanguageInternal,
  };
};

export default useSpeechStreamerProcessor;
import { useRef, useEffect } from 'react';

interface VoskProcessorHandle {
  processAudio: (audioData: ArrayBuffer) => void;
  startProcessing: () => void;
  stopProcessing: () => void;
  isConnected: boolean;
}

const useVoskProcessor = (
  wsUrl: string,
  callbacks: {
    onFinalResult?: (text: string) => void;
    onPartialResult?: (text: string) => void;
  },
  options: { sampleRate?: number; autoStart?: boolean } = {}
): VoskProcessorHandle => {
  const wsRef = useRef<WebSocket | null>(null);
  const isProcessingRef = useRef(options.autoStart || false);
  const isConnectedRef = useRef(false);

  const { onFinalResult, onPartialResult } = callbacks;
  const { sampleRate = 16000, autoStart = false } = options;

  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('Vosk WebSocket connected');
        isConnectedRef.current = true;
        wsRef.current?.send(JSON.stringify({ config: { sample_rate: sampleRate } }));
        if (autoStart) {
          isProcessingRef.current = true;
        }
      };

      wsRef.current.onmessage = (event) => {
        const result = JSON.parse(event.data);
        if (result.text && onFinalResult) {
          onFinalResult(result.text);
        } else if (result.partial && onPartialResult) {
          onPartialResult(result.partial);
        }
      };

      wsRef.current.onclose = () => {
        console.log('Vosk WebSocket disconnected');
        isConnectedRef.current = false;
        isProcessingRef.current = false;
        setTimeout(() => connectWebSocket(), 3000);
      };

      wsRef.current.onerror = (error) => {
        console.error('Vosk WebSocket error:', error);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsUrl, sampleRate, autoStart, onFinalResult, onPartialResult]);

  const processAudio = (audioData: ArrayBuffer) => {
    if (!isConnectedRef.current || !isProcessingRef.current || !wsRef.current) return;

    try {
      const int16Array = new Int16Array(audioData);
      wsRef.current.send(int16Array);
    } catch (error) {
      console.error('Audio processing error:', error);
    }
  };

  const startProcessing = () => {
    isProcessingRef.current = true;
  };

  const stopProcessing = () => {
    isProcessingRef.current = false;
  };

  return {
    processAudio,
    startProcessing,
    stopProcessing,
    isConnected: isConnectedRef.current,
  };
};

export default useVoskProcessor;
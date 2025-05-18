import React, { useEffect, useRef } from 'react';

interface SpeechStreamerAudioProcessorProps {
  wsUrl: string;
  sampleRate?: number;
  onFinalResult?: (text: string) => void;
  onPartialResult?: (text: string) => void;
  autoStart?: boolean;
}

const SpeechStreamerAudioProcessor: React.FC<SpeechStreamerAudioProcessorProps> = ({
  wsUrl,
  sampleRate = 16000,
  onFinalResult,
  onPartialResult,
  autoStart = false,
}) => {
  const wsRef = useRef<WebSocket | null>(null);
  const isProcessingRef = useRef(false);
  const isConnectedRef = useRef(false);

  // Initialize WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('SpeechStreamer WebSocket connected');
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
        console.log('SpeechStreamer WebSocket disconnected');
        isConnectedRef.current = false;
        isProcessingRef.current = false;
        setTimeout(() => connectWebSocket(), 3000);
      };

      wsRef.current.onerror = (error) => {
        console.error('SpeechStreamer WebSocket error:', error);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsUrl, sampleRate, autoStart, onFinalResult, onPartialResult]);

  // Process audio data from external source
  const processAudio = (audioData: ArrayBuffer) => {
    if (!isConnectedRef.current || !isProcessingRef.current || !wsRef.current) return;

    try {
      const int16Array = new Int16Array(audioData);
      wsRef.current.send(int16Array);
    } catch (error) {
      console.error('Audio processing error:', error);
    }
  };

  // Start processing
  const startProcessing = () => {
    isProcessingRef.current = true;
  };

  // Stop processing
  const stopProcessing = () => {
    isProcessingRef.current = false;
  };

  // Expose functions via ref if needed
  return null;
};

export default SpeechStreamerAudioProcessor;
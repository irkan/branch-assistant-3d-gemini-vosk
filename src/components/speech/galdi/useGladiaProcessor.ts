import { useRef, useEffect, useState, useCallback } from 'react';
import { StreamingConfig, InitiateResponse, StreamingAudioFormat } from '../../../lib/gladia/live/types'; // Assuming types are accessible

// Read Gladia Key - In a real app, this should be handled securely, perhaps from environment variables or a config service.
const GLADIA_KEY = process.env.REACT_APP_GLADIA_API_KEY || "YOUR_GLADIA_KEY";
const GLADIA_API_URL = "https://api.gladia.io";
const RECONNECT_DELAY_MS = 5000; // 5 seconds for reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5; // Maximum number of reconnection attempts

if (typeof GLADIA_KEY !== "string") {
  throw new Error("set REACT_APP_GLADIA_API_KEY in .env");
}

export interface GladiaProcessorHandle {
  sendAudio: (audioData: ArrayBuffer) => void;
  startProcessing: () => void;
  stopProcessing: () => void;
  isConnected: () => boolean;
  transcript: string;
  // Add other relevant state or callbacks if needed, e.g., for partial results, errors, etc.
}

const useGladiaProcessor = (
  callbacks: {
    onFinalResult?: (text: string) => void;
    onPartialResult?: (text: string) => void; // Gladia might have different event types
    onError?: (error: any) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
  },
  options: {
    sampleRate?: number;
    autoStart?: boolean;
    bufferSize?: number; // Size of audio chunks to send in ms, e.g., 100ms
    streamingConfig?: Partial<StreamingConfig>; // Allow overriding default config
    audioFormat?: Partial<StreamingAudioFormat>;
  } = {}
): GladiaProcessorHandle => {
  const wsRef = useRef<WebSocket | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]); // Buffer for audio data before sending
  const isProcessingRef = useRef(options.autoStart || false);
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState(''); // Store the latest transcript

  const { onFinalResult, onPartialResult, onError, onConnect, onDisconnect } = callbacks;
  const {
    sampleRate = 16000,
    autoStart = false,
    bufferSize = 1600, // Corresponds to 100ms of audio at 16kHz, 16-bit mono (16000 * 0.1 * 2 bytes / sample)
    streamingConfig: userStreamingConfig,
    audioFormat: userAudioFormat,
  } = options;

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false); // Prevents multiple concurrent connection attempts
  const isUnmountingRef = useRef(false); // Tracks if the component is unmounting

  const audioFormatBase: StreamingAudioFormat = {
    encoding: "wav/pcm", // Or other supported formats
    bit_depth: 16,
    sample_rate: sampleRate as 8000 | 16000 | 32000 | 44100 | 48000, // Ensure this matches Gladia's allowed values
    channels: 1,
    ...userAudioFormat,
  };

  const gladiaConfig: StreamingConfig = {
    language_config: {
      languages: ["az", "en", "tr", "ru"], // Default languages
      code_switching: true,
    },
    realtime_processing: {
      words_accurate_timestamps: true, // Example, adjust as needed
    },
    // model: "solaria-1", // Example, you might want to configure this
    ...userStreamingConfig,
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };
  
  const cleanupWebSocket = () => {
    if (wsRef.current) {
      console.log("Cleaning up existing WebSocket instance.");
      // Remove all event listeners to prevent them from firing on a closed/stale socket
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;

      if (wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "stop_recording" }));
        } catch (e) {
            console.warn("Error sending stop_recording on cleanup (socket might be closing):", e);
        }
        wsRef.current.close(1000, "Client disconnecting and cleaning up");
      } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
         wsRef.current.close(1000, "Client disconnecting during connection attempt");
      }
      wsRef.current = null;
    }
  };

  const connectWebSocket = useCallback(async () => {
    if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) || isUnmountingRef.current) {
      console.log('Connection attempt skipped: already connecting, connected, or unmounting.');
      return;
    }

    isConnectingRef.current = true;
    cleanupWebSocket(); // Clean up any old instance before creating a new one
    clearReconnectTimer();

    console.log('Initializing Gladia live session...');
    try {
      const response = await fetch(`${GLADIA_API_URL}/v2/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GLADIA-KEY": GLADIA_KEY },
        body: JSON.stringify({ ...audioFormatBase, ...gladiaConfig }),
      });

      if (isUnmountingRef.current) { // Check again in case of unmount during fetch
        console.log("Unmounted during session initialization fetch. Aborting connection.");
        isConnectingRef.current = false;
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gladia session initialization failed: ${response.status} - ${errorText}`);
        if (onError) onError(new Error(`Gladia init failed: ${errorText}`));
        setIsConnected(false);
        if (onDisconnect) onDisconnect();
        isConnectingRef.current = false;
        if (response.status === 429 && !isUnmountingRef.current) { // Too Many Requests
          console.warn("Max concurrent sessions reached. Will not attempt to reconnect immediately.");
          // Optionally, you could schedule a much later retry or notify the user.
        } else if (!isUnmountingRef.current) {
          scheduleReconnect();
        }
        return;
      }

      const initiateResponse: InitiateResponse = await response.json();
      console.log('Gladia session initialized, connecting to WebSocket:', initiateResponse.url);

      wsRef.current = new WebSocket(initiateResponse.url);
      wsRef.current.onopen = () => {
        if (isUnmountingRef.current) {
            console.log("WebSocket opened but component is unmounting. Closing.");
            wsRef.current?.close(1000, "Component unmounted during onopen");
            return;
        }
        console.log('Gladia WebSocket connected');
        setIsConnected(true);
        isConnectingRef.current = false;
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
        if (onConnect) onConnect();
        if (autoStart || isProcessingRef.current) { // If autoStart or was processing before disconnect
          isProcessingRef.current = true;
        }
      };

      wsRef.current.onmessage = (event) => {
        if (isUnmountingRef.current) return;
        const message = JSON.parse(event.data.toString());
        if (message.type === "transcription" && message.transcription) {
          setTranscript(prev => prev + message.transcription + " ");
          if (onPartialResult && message.is_partial) onPartialResult(message.transcription);
          else if (onFinalResult) onFinalResult(message.transcription); // Simplified: treat non-partial as final
        } else if (message.type === "error") {
          console.error('Gladia WebSocket error message:', message.message);
          if (onError) onError(new Error(message.message));
        }
      };

      wsRef.current.onclose = (event) => {
        if (isUnmountingRef.current) {
            console.log("WebSocket closed because component is unmounting.");
            return;
        }
        console.log(`Gladia WebSocket disconnected (code: ${event.code}, reason: ${event.reason})`);
        setIsConnected(false);
        isConnectingRef.current = false; // No longer actively trying to connect with this instance
        // isProcessingRef.current = false; // debatable, user might want to resume
        if (onDisconnect) onDisconnect();
        if (event.code !== 1000 && event.code !== 1005) { // 1000 is normal, 1005 is no status rcvd (often component unmount)
          console.warn('Gladia WebSocket closed unexpectedly. Attempting to reconnect...');
          scheduleReconnect();
        } else {
          console.log("Gladia WebSocket closed normally or due to unmount, no reconnect scheduled.");
        }
      };

      wsRef.current.onerror = (errorEvent) => {
        if (isUnmountingRef.current) return;
        console.error('Gladia WebSocket error event:', errorEvent);
        if (onError) onError(new Error("Gladia WebSocket error occurred."));
        // onclose will usually follow, triggering reconnect logic if appropriate
      };

    } catch (error) {
      if (isUnmountingRef.current) return;
      console.error('Error during Gladia connection setup:', error);
      if (onError) onError(error);
      setIsConnected(false);
      isConnectingRef.current = false;
      if (onDisconnect) onDisconnect();
      scheduleReconnect();
    }
  }, [GLADIA_KEY, audioFormatBase, gladiaConfig, autoStart, onConnect, onDisconnect, onError, onFinalResult, onPartialResult]); // Removed isProcessingRef as it's mutable

  const scheduleReconnect = () => {
    if (isUnmountingRef.current || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log("Max reconnect attempts reached or component unmounting. Will not reconnect.");
      reconnectAttemptsRef.current = 0; // Reset for future manual attempts if any
      return;
    }
    reconnectAttemptsRef.current++;
    const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current -1), 30000); // Exponential backoff up to 30s
    console.log(`Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay / 1000}s...`);
    clearReconnectTimer(); // Clear any existing timer
    reconnectTimeoutRef.current = setTimeout(() => {
      if (!isUnmountingRef.current) {
          connectWebSocket();
      }
    }, delay);
  };

  useEffect(() => {
    isUnmountingRef.current = false;
    if (autoStart) { // Connect on mount if autoStart is true
        console.log("AutoStart is true, initiating connection.");
        connectWebSocket();
    }

    return () => {
      console.log("useGladiaProcessor unmounting. Cleaning up...");
      isUnmountingRef.current = true;
      clearReconnectTimer();
      cleanupWebSocket();
    };
  }, [connectWebSocket, autoStart]); // connectWebSocket is memoized, autoStart is a prop

  // Convert ArrayBuffer (typically from browser microphone) to Float32Array, then to Int16 PCM
  // and then to Buffer for Gladia.
  // Gladia expects raw audio chunks.
  const processAndSendAudio = (audioData: ArrayBuffer) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isProcessingRef.current) {
      // console.log("Gladia WS not open or not processing, buffering audio chunk.");
      // Optionally buffer audio here if not connected/processing, then send on connect/start
      return;
    }

    try {
        // Assuming audioData is already in the correct format (e.g., PCM16) based on `audioFormatBase`
        // If it's raw float32 from WebAudio API, conversion is needed.
        // For simplicity, let's assume it's PCM s16le ArrayBuffer.
        // This is a common output from many WebRTC/MediaRecorder setups when configured for PCM.
        // If not, you need a conversion step here: Float32 -> Int16
        // Example (if data is Float32Array):
        // const pcm16 = new Int16Array(audioData.length);
        // for (let i = 0; i < audioData.length; i++) {
        //   pcm16[i] = Math.max(-1, Math.min(1, audioData[i])) * 0x7FFF;
        // }
        // wsRef.current.send(pcm16.buffer);

        wsRef.current.send(audioData);

    } catch (error) {
      console.error('Gladia audio processing/sending error:', error);
      if (onError) onError(error);
    }
  };


  const sendAudio = (audioData: ArrayBuffer) => {
    if (!isProcessingRef.current) {
        // console.log("Not processing, discarding audio data for Gladia.");
        return;
    }
    // For simplicity, directly send. Real-world might involve more sophisticated buffering.
    processAndSendAudio(audioData);
  };

  const startProcessing = () => {
    console.log("startProcessing called.");
    isProcessingRef.current = true;
    if (!isConnected && !isConnectingRef.current && !isUnmountingRef.current) {
      console.log("Not connected, initiating connection from startProcessing.");
      reconnectAttemptsRef.current = 0; // Reset attempts
      connectWebSocket();
    } else if (isConnected) {
        console.log("Already connected, processing will resume/continue.");
    }
  };

  const stopProcessing = () => {
    console.log("stopProcessing called.");
    isProcessingRef.current = false;
    // No need to send stop_recording here, cleanupWebSocket handles it on close/unmount.
    // If you specifically want to stop Gladia from processing further but keep connection open,
    // you might need a specific API message if Gladia supports it.
  };

  return {
    sendAudio,
    startProcessing,
    stopProcessing,
    isConnected: () => isConnected,
    transcript, // Expose transcript directly
  };
};

export default useGladiaProcessor;

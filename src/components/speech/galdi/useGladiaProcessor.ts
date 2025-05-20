import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { StreamingConfig, InitiateResponse, StreamingAudioFormat } from '../../../lib/gladia/live/types'; // Assuming types are accessible

console.log("--- SCRIPT LOADED: useGladiaProcessor.ts ---"); // Log for script loading

// Read Gladia Key - In a real app, this should be handled securely, perhaps from environment variables or a config service.
const GLADIA_KEY_VALUE = process.env.REACT_APP_GLADIA_API_KEY || "YOUR_GLADIA_KEY_DEFAULT";
console.log("--- useGladiaProcessor: Initial GLADIA_KEY_VALUE Check (at module scope):", GLADIA_KEY_VALUE);
if (GLADIA_KEY_VALUE === "YOUR_GLADIA_KEY_DEFAULT") {
    console.warn("--- useGladiaProcessor: WARNING! Gladia API Key is using the default placeholder. Please set REACT_APP_GLADIA_KEY in your .env file.");
}

const GLADIA_API_URL = "https://api.gladia.io";
const RECONNECT_DELAY_MS = 5000; // 5 seconds for reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5; // Maximum number of reconnection attempts

if (typeof GLADIA_KEY_VALUE !== "string") {
  throw new Error("set REACT_APP_GLADIA_KEY in .env");
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
  console.log("--- HOOK ENTRY: useGladiaProcessor() called ---"); // Log for hook entry

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

  console.log("--- useGladiaProcessor: Options received:", { sampleRate, autoStart, userStreamingConfig, userAudioFormat });

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false); // Prevents multiple concurrent connection attempts
  const isUnmountingRef = useRef(false); // Tracks if the component is unmounting

  const audioFormatBase = useMemo((): StreamingAudioFormat => {
    console.log("--- useGladiaProcessor: Recalculating audioFormatBase ---");
    return {
      encoding: "wav/pcm",
      bit_depth: 16,
      sample_rate: sampleRate as 8000 | 16000 | 32000 | 44100 | 48000,
      channels: 1,
      ...(userAudioFormat || {}),
    };
  }, [sampleRate, userAudioFormat]);

  const gladiaConfig = useMemo((): StreamingConfig => {
    console.log("--- useGladiaProcessor: Recalculating gladiaConfig ---");
    return {
      language_config: { languages: ["az", "en", "tr", "ru"], code_switching: true },
      realtime_processing: { words_accurate_timestamps: true },
      ...(userStreamingConfig || {}),
    };
  }, [userStreamingConfig]);

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };
  
  const cleanupWebSocket = () => {
    console.log("--- FN CALL: cleanupWebSocket() ---");
    if (wsRef.current) {
      console.log("--- cleanupWebSocket: Cleaning up existing WebSocket instance. Current state:", wsRef.current.readyState);
      // Remove all event listeners to prevent them from firing on a closed/stale socket
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;

      if (wsRef.current.readyState === WebSocket.OPEN) {
        try {
          console.log("--- cleanupWebSocket: Sending stop_recording (OPEN state) ---");
          wsRef.current.send(JSON.stringify({ type: "stop_recording" }));
          wsRef.current.close(1000, "Client disconnecting and cleaning up (OPEN state)");
        } catch (e) {
            console.warn("--- cleanupWebSocket: Error sending stop_recording (OPEN state):", e);
            wsRef.current.close(1000, "Client disconnecting and cleaning up (OPEN state, error on send)");
        }
      } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
         console.log("--- cleanupWebSocket: Closing WebSocket in CONNECTING state ---");
         wsRef.current.close(1000, "Client disconnecting during connection attempt (CONNECTING state)");
      } else {
        console.log("--- cleanupWebSocket: WebSocket not OPEN or CONNECTING, just nullifying ref. State:", wsRef.current.readyState);
      }
      wsRef.current = null;
    }
  };

  const connectWebSocket = useCallback(async () => {
    console.log("--- FN CALL: connectWebSocket() attempt ---");
    if (isUnmountingRef.current) {
        console.log("--- connectWebSocket: SKIPPED - component is unmounting.");
        return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('--- connectWebSocket: SKIPPED - already connected.');
      return;
    }
    if (isConnectingRef.current) {
        console.log("--- connectWebSocket: SKIPPED - a connection attempt is already in progress.");
        return;
    }

    console.log("--- connectWebSocket: Proceeding with new connection attempt ---");
    isConnectingRef.current = true;
    
    if (wsRef.current) {
        console.warn("--- connectWebSocket: Found an existing wsRef.current before new attempt. This should ideally be cleaned up by previous lifecycle. State:", wsRef.current.readyState);
        cleanupWebSocket(); // Ensure any very old instance is gone, though this might be redundant if lifecycle is perfect
    }
        
    clearReconnectTimer();

    console.log(`--- connectWebSocket: Initializing Gladia live session... API Key being used: ${GLADIA_KEY_VALUE.substring(0,5)}...`);
    try {
      const response = await fetch(`${GLADIA_API_URL}/v2/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GLADIA-KEY": GLADIA_KEY_VALUE },
        body: JSON.stringify({ ...audioFormatBase, ...gladiaConfig }),
      });

      if (isUnmountingRef.current) {
        console.log("--- connectWebSocket: Unmounted during session initialization fetch. Aborting connection.");
        isConnectingRef.current = false;
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`--- connectWebSocket: Gladia session initialization FAILED: ${response.status} - ${errorText}`);
        if (onError) onError(new Error(`Gladia init failed: ${errorText}`));
        setIsConnected(false);
        if (onDisconnect) onDisconnect();
        isConnectingRef.current = false;
        if (response.status === 429 && !isUnmountingRef.current) {
          console.warn("--- connectWebSocket: Max concurrent sessions (429). Will NOT attempt to reconnect immediately.");
        } else if (!isUnmountingRef.current) {
          scheduleReconnect();
        }
        return;
      }

      const initiateResponse: InitiateResponse = await response.json();
      console.log('--- connectWebSocket: Gladia session initialized, connecting to WebSocket URL:', initiateResponse.url ? initiateResponse.url.split('=')[0]+'=TOKEN_HIDDEN' : 'NO_URL_RECEIVED');

      if (!initiateResponse.url) {
        console.error("--- connectWebSocket: CRITICAL - No WebSocket URL received from Gladia /v2/live response.");
        isConnectingRef.current = false;
        scheduleReconnect();
        return;
      }

      wsRef.current = new WebSocket(initiateResponse.url);
      console.log("--- connectWebSocket: WebSocket instance created, attaching handlers. Current state (should be CONNECTING):", wsRef.current.readyState);

      wsRef.current.onopen = () => {
        if (isUnmountingRef.current) {
            console.log("--- WS_ONOPEN: WebSocket opened but component is unmounting. Closing.");
            wsRef.current?.close(1000, "Component unmounted during onopen");
            // isConnectingRef should be false if onclose is triggered by this, or needs manual set.
            return;
        }
        console.log('--- WS_ONOPEN: Gladia WebSocket connected successfully!');
        setIsConnected(true);
        isConnectingRef.current = false;
        reconnectAttemptsRef.current = 0;
        if (onConnect) onConnect();
        if (autoStart || isProcessingRef.current) {
          isProcessingRef.current = true;
        }
      };

      wsRef.current.onmessage = (event) => {
        if (isUnmountingRef.current) return;
        const message = JSON.parse(event.data.toString());
        // console.log("--- WS_ONMESSAGE: Received:", message); // Can be too verbose
        if (message.type === "transcription" && message.transcription) {
          setTranscript(prev => prev + message.transcription + " ");
          if (onPartialResult && message.is_partial) onPartialResult(message.transcription);
          else if (onFinalResult) onFinalResult(message.transcription);
        } else if (message.type === "error") {
          console.error('--- WS_ONMESSAGE: Gladia WebSocket error message:', message.message);
          if (onError) onError(new Error(message.message));
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(`--- WS_ONCLOSE: Gladia WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'N/A'}, wasClean: ${event.wasClean}) ---`);
        if (isUnmountingRef.current && event.code !== 1000) {
            console.log("--- WS_ONCLOSE: WebSocket closed while component unmounting (non-1000 code). isConnectingRef was:", isConnectingRef.current);
        } else if (isUnmountingRef.current) {
            console.log("--- WS_ONCLOSE: WebSocket closed cleanly during unmount.");
        }

        setIsConnected(false);
        isConnectingRef.current = false; 
        if (onDisconnect) onDisconnect();
        
        if (!isUnmountingRef.current && event.code !== 1000) { 
          console.warn('--- WS_ONCLOSE: Gladia WebSocket closed unexpectedly. Attempting to reconnect...');
          scheduleReconnect();
        } else {
          console.log("--- WS_ONCLOSE: WebSocket closed normally or due to unmount, no automatic reconnect scheduled.");
        }
      };

      wsRef.current.onerror = (errorEvent) => {
        console.error('--- WS_ONERROR: Gladia WebSocket error event:', errorEvent.type, errorEvent);
        if (isUnmountingRef.current) return;
        if (onError) onError(new Error("Gladia WebSocket error event occurred."));
        // onclose will usually follow and handle isConnectingRef and reconnection logic
      };

    } catch (error) {
      console.error('--- connectWebSocket: CRITICAL ERROR during connection setup (outside fetch/response handling):', error);
      if (isUnmountingRef.current) return;
      if (onError) onError(error);
      setIsConnected(false);
      isConnectingRef.current = false;
      if (onDisconnect) onDisconnect();
      scheduleReconnect();
    }
  }, [ GLADIA_KEY_VALUE, audioFormatBase, gladiaConfig, autoStart, onConnect, onDisconnect, onError, onFinalResult, onPartialResult]);

  const scheduleReconnect = () => {
    if (isUnmountingRef.current || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log("--- scheduleReconnect: Max reconnect attempts reached or component unmounting. Will not reconnect.");
      reconnectAttemptsRef.current = 0; 
      return;
    }
    reconnectAttemptsRef.current++;
    const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current -1), 30000);
    console.log(`--- scheduleReconnect: Scheduling reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`);
    clearReconnectTimer(); 
    reconnectTimeoutRef.current = setTimeout(() => {
      if (!isUnmountingRef.current) {
          console.log("--- scheduleReconnect: Timeout reached, attempting connectWebSocket() ---");
          connectWebSocket();
      }
    }, delay);
  };

  useEffect(() => {
    console.log("--- EFFECT: Main useEffect running. autoStart:", autoStart, "isUnmountingRef:", isUnmountingRef.current );
    isUnmountingRef.current = false;
    if (autoStart) {
        console.log("--- EFFECT: autoStart is true, calling connectWebSocket() ---");
        connectWebSocket();
    }

    return () => {
      console.log("--- EFFECT CLEANUP: useGladiaProcessor unmounting/re-running. Cleaning up... ---");
      isUnmountingRef.current = true;
      clearReconnectTimer();
      cleanupWebSocket();
      console.log("--- EFFECT CLEANUP: Cleanup complete. ---");
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
    // console.log("--- FN CALL: sendAudio() ---"); // Can be too verbose
    if (!isProcessingRef.current) {
        // console.log("--- sendAudio: Not processing, discarding audio.");
        return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(audioData);
      } catch (error) {
        console.error('--- sendAudio: Gladia audio sending error:', error);
        if (onError) onError(error);
      }
    } else {
      console.warn("--- sendAudio: WebSocket NOT OPEN, cannot send audio. Current state:", wsRef.current?.readyState, "isConnectingRef:", isConnectingRef.current);
      if (!isConnected && !isConnectingRef.current && !isUnmountingRef.current) {
        console.log("--- sendAudio: Attempting to reconnect as WebSocket is not open for sending audio.");
        reconnectAttemptsRef.current = 0; 
        connectWebSocket();
      }
    }
  };

  const startProcessing = () => {
    console.log("--- FN CALL: startProcessing() ---");
    isProcessingRef.current = true;
    if (!isConnected && !isConnectingRef.current && !isUnmountingRef.current) {
      console.log("--- startProcessing: Not connected, calling connectWebSocket() ---");
      reconnectAttemptsRef.current = 0; 
      connectWebSocket();
    } else if (isConnected) {
        console.log("--- startProcessing: Already connected, processing will resume/continue.");
    }
  };

  const stopProcessing = () => {
    console.log("--- FN CALL: stopProcessing() ---");
    isProcessingRef.current = false;
    // No need to send stop_recording here, cleanupWebSocket handles it on close/unmount.
    // If you specifically want to stop Gladia from processing further but keep connection open,
    // you might need a specific API message if Gladia supports it.
  };

  console.log("--- HOOK END: useGladiaProcessor() returning handle ---");
  return {
    sendAudio,
    startProcessing,
    stopProcessing,
    isConnected: () => isConnected,
    transcript, // Expose transcript directly
  };
};

export default useGladiaProcessor;

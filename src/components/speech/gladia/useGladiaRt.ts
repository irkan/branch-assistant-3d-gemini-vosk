import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { StreamingConfig, InitiateResponse, StreamingAudioFormat } from '../../../lib/gladia/live/types'; // Adjust path if necessary

// Ensure this matches your .env file
const GLADIA_API_KEY = process.env.REACT_APP_GLADIA_API_KEY || "YOUR_GLADIA_API_KEY_DEFAULT"; 
const GLADIA_API_URL = "https://api.gladia.io";

const DEFAULT_SAMPLE_RATE = 16000;
const RECONNECT_DELAY_BASE_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

if (GLADIA_API_KEY === "YOUR_GLADIA_API_KEY_DEFAULT") {
    console.warn("GladiaRt: WARNING! Gladia API Key is using the default placeholder. Please set REACT_APP_GLADIA_API_KEY in your .env file for the component to work.");
}

//console.log("GladiaRt Hook Loaded. API Key Starts With:", GLADIA_API_KEY.substring(0, 5));


export interface GladiaRtCallbacks {
    onTranscript?: (transcript: string, isFinal: boolean) => void;
    onError?: (error: Error) => void;
    onConnected?: () => void;
    onDisconnected?: (reason?: string) => void;
    onSessionId?: (sessionId: string) => void;
}

export interface GladiaRtOptions {
    sampleRate?: number;
    autoStart?: boolean;
    streamingConfig?: Partial<StreamingConfig>;
    audioFormat?: Partial<StreamingAudioFormat>;
}

export interface GladiaRtHandle {
    sendAudio: (audioData: ArrayBuffer) => void;
    startSession: () => void;
    stopSession: (graceful?: boolean) => void;
    isConnected: boolean;
    currentTranscript: string;
}

const useGladiaRt = (
    callbacks: GladiaRtCallbacks,
    options: GladiaRtOptions = {}
): GladiaRtHandle => {
    const {
        onTranscript,
        onError,
        onConnected,
        onDisconnected,
        onSessionId
    } = callbacks;

    const {
        sampleRate = DEFAULT_SAMPLE_RATE,
        autoStart = true,
        streamingConfig: userStreamingConfig,
        audioFormat: userAudioFormat,
    } = options;

    const socketRef = useRef<WebSocket | null>(null);
    const webSocketUrlRef = useRef<string | null>(null); // To store the WebSocket URL for reconnections
    const sessionIdRef = useRef<string | null>(null);
    
    const [isConnected, setIsConnected] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState("");

    const isSessionExplicitlyStoppedRef = useRef(false);
    const isConnectingRef = useRef(false); // Prevents multiple concurrent connection attempts
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const componentMountedRef = useRef(true);


    const baseAudioFormat = useMemo((): StreamingAudioFormat => ({
        encoding: "wav/pcm",
        bit_depth: 16,
        sample_rate: sampleRate as 8000 | 16000 | 32000 | 44100 | 48000,
        channels: 1,
        ...userAudioFormat,
    }), [sampleRate, userAudioFormat]);

    const finalStreamingConfig = useMemo((): StreamingConfig => ({
        language_config: { 
            languages: ["az"], 
            code_switching: true 
        }, // Default, can be overridden
        realtime_processing: { 
            words_accurate_timestamps: true
         }, // Default
        ...userStreamingConfig,
    }), [userStreamingConfig]);
    
    const clearReconnectTimer = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);

    const closeExistingSocket = useCallback((code?: number, reason?: string) => {
        if (socketRef.current) {
            //console.log(`GladiaRt: Closing existing WebSocket (state: ${socketRef.current.readyState}). Code: ${code}, Reason: ${reason}`);
            // Prevent onclose handler from triggering reconnection if this is a deliberate close
            if (socketRef.current.onclose) {
                const originalOnClose = socketRef.current.onclose;
                socketRef.current.onclose = (event) => {
                    //console.log("GladiaRt: Deliberate socket close, original onclose temporarily bypassed for this event.");
                    // @ts-ignore
                    originalOnClose.call(socketRef.current, event); // Call original but reconnection might be skipped based on flags
                };
            }
            socketRef.current.close(code, reason);
            socketRef.current = null;
        }
    }, []);


    const connectWebSocket = useCallback(() => {
        if (!webSocketUrlRef.current || isConnectingRef.current || !componentMountedRef.current) {
            //console.log(`GladiaRt: WebSocket connection skipped. URL: ${!!webSocketUrlRef.current}, Connecting: ${isConnectingRef.current}, Mounted: ${componentMountedRef.current}`);
            if (!webSocketUrlRef.current && componentMountedRef.current && !isSessionExplicitlyStoppedRef.current) {
                //console.log("GladiaRt: No WebSocket URL, attempting to initiate session again.");
                // This implies the initial session failed or URL was lost. Try re-initiating.
                // Be cautious with this to avoid loops if /live also fails repeatedly.
                // initiateSession(); // Let's be careful here, might be better to let reconnect handle it if URL was never set
            }
            return;
        }
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            //console.log("GladiaRt: WebSocket already open.");
            return;
        }

        //console.log("GladiaRt: Attempting to connect to WebSocket:", webSocketUrlRef.current.split('=')[0] + '=TOKEN_HIDDEN' + "");
        isConnectingRef.current = true;
        
        // Clean up any old socket before creating a new one
        closeExistingSocket(1000, "Preparing for new connection attempt");

        const ws = new WebSocket(webSocketUrlRef.current);
        socketRef.current = ws;

        ws.onopen = () => {
            if (!componentMountedRef.current) {
                //console.log("GladiaRt: WS opened, but component unmounted. Closing.");
                ws.close(1000, "Component unmounted");
                return;
            }
            //console.log("GladiaRt: WebSocket connected successfully!");
            setIsConnected(true);
            isConnectingRef.current = false;
            reconnectAttemptsRef.current = 0;
            clearReconnectTimer();
            if (onConnected) onConnected();
        };

        ws.onmessage = (event) => {
            if (!componentMountedRef.current) return;
            try {
                const message = JSON.parse(event.data.toString());
                // //console.log("GladiaRt: WS Message:", message); // DEBUG
                if (message.type === 'transcript') {
                    const text = message.data?.utterance?.text || message.transcription || ''; // Adapt to actual structure
                    const isFinal = message.data?.is_final !== undefined ? message.data.is_final : (message.type === 'transcript' && !message.is_partial); // Heuristic for final
                    
                    if(text){
                        setCurrentTranscript(prev => isFinal ? prev + text + " " : text);
                        if (onTranscript) onTranscript(text, isFinal);
                    }
                } else if (message.error) { // Or message.type === 'error'
                     console.error("GladiaRt: Error message from WebSocket:", message.error);
                     if(onError) onError(new Error(message.error.message || message.error));
                }
            } catch (e) {
                console.error("GladiaRt: Error parsing WebSocket message:", e, event.data);
                if(onError) onError(e as Error);
            }
        };

        ws.onclose = (event) => {
            //console.log(`GladiaRt: WebSocket disconnected. Code: ${event.code}, Reason: '${event.reason}', Clean: ${event.wasClean}`);
            isConnectingRef.current = false;
            if (socketRef.current === ws) { // Ensure this onclose is for the current socket instance
                socketRef.current = null;
                setIsConnected(false);
            }
            if (onDisconnected) onDisconnected(event.reason);

            if (componentMountedRef.current && !isSessionExplicitlyStoppedRef.current && event.code !== 1000) {
                if (event.code === 4408) { // Timeout due to no audio
                    //console.log("GladiaRt: WS closed due to inactivity (4408). Initiating new session.");
                    webSocketUrlRef.current = null; // Force new session
                    reconnectAttemptsRef.current = 0; // Reset attempts for new session logic
                    initiateSession();
                } else {
                    //console.log("GladiaRt: WS closed unexpectedly, scheduling reconnect.");
                    scheduleReconnect();
                }
            } else {
                //console.log("GladiaRt: WS closed (expected or unmounted), no reconnect scheduled.");
            }
        };

        ws.onerror = (event) => {
            console.error("GladiaRt: WebSocket error event:", event);
            isConnectingRef.current = false; // To allow reconnect attempts via onclose
            // onError callback is tricky here as onclose will also fire.
            // Could call onError(new Error("WebSocket connection error")) but might be redundant.
            // Let onclose handle the reconnection logic.
        };
    }, [onConnected, onDisconnected, onError, onTranscript, closeExistingSocket]);


    const initiateSession = useCallback(async () => {
        if (isConnectingRef.current || (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) || !componentMountedRef.current) {
            //console.log(`GladiaRt: Session initiation skipped. Connecting: ${isConnectingRef.current}, SocketOpen: ${socketRef.current?.readyState === WebSocket.OPEN}, Mounted: ${componentMountedRef.current}`);
            return;
        }
        if(GLADIA_API_KEY === "YOUR_GLADIA_API_KEY_DEFAULT"){
            console.error("GladiaRt: Cannot initiate session. API Key is default placeholder.");
            if(onError) onError(new Error("Gladia API Key is not configured."));
            return;
        }

        //console.log("GladiaRt: Initiating new Gladia session...");
        isConnectingRef.current = true;
        isSessionExplicitlyStoppedRef.current = false; // New session attempt means we want it active
        setCurrentTranscript(""); // Reset transcript for new session

        try {
            const response = await fetch(`${GLADIA_API_URL}/v2/live`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Gladia-Key': GLADIA_API_KEY,
                },
                body: JSON.stringify({
                    ...baseAudioFormat,
                    ...finalStreamingConfig
                }),
            });

            if (!componentMountedRef.current) {
                //console.log("GladiaRt: Unmounted during session fetch. Aborting.");
                isConnectingRef.current = false;
                return;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`GladiaRt: Session initiation failed. Status: ${response.status}, Message: ${errorText}`);
                isConnectingRef.current = false;
                if (onError) onError(new Error(`Gladia session init failed: ${errorText}`));
                if (response.status === 401) { // Unauthorized
                    console.error("GladiaRt: Authorization error (401). Check API Key. No reconnect will be scheduled.");
                    clearReconnectTimer(); 
                } else if (response.status === 429) { // Too many requests
                    console.warn("GladiaRt: Max concurrent sessions (429). No immediate reconnect.");
                    // Potentially schedule a much later retry or inform user
                } else if (componentMountedRef.current && !isSessionExplicitlyStoppedRef.current) {
                    scheduleReconnect(); // Schedule reconnect for other server errors
                }
                return;
            }

            const sessionData = await response.json() as InitiateResponse;
            //console.log("GladiaRt: Session initiated. Session ID:", sessionData.id, "WebSocket URL:", sessionData.url ? sessionData.url.split('=')[0]+'=TOKEN_HIDDEN' : 'NO_URL_RECEIVED' + "");
            
            if (!sessionData.url) {
                 console.error("GladiaRt: CRITICAL - No WebSocket URL in session response.");
                 isConnectingRef.current = false;
                 if (componentMountedRef.current && !isSessionExplicitlyStoppedRef.current) scheduleReconnect();
                 return;
            }
            
            webSocketUrlRef.current = sessionData.url;
            sessionIdRef.current = sessionData.id;
            if(onSessionId) onSessionId(sessionData.id);
            
            reconnectAttemptsRef.current = 0; // Reset for new session URL
            isConnectingRef.current = false; // Done with HTTP part
            connectWebSocket(); // Now connect to the WebSocket

        } catch (error) {
            if (!componentMountedRef.current) return;
            console.error("GladiaRt: Error during session initiation fetch:", error, "---");
            isConnectingRef.current = false;
            if (onError) onError(error as Error);
            if (componentMountedRef.current && !isSessionExplicitlyStoppedRef.current) {
                scheduleReconnect();
            }
        }
    }, [GLADIA_API_KEY, baseAudioFormat, finalStreamingConfig, onError, onSessionId, connectWebSocket]);


    const scheduleReconnect = useCallback(() => {
        if (!componentMountedRef.current || isSessionExplicitlyStoppedRef.current || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            if(reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS){
                console.warn("GladiaRt: Max reconnect attempts reached. Giving up.");
                if(onError) onError(new Error("Max reconnection attempts reached."));
            }
            reconnectAttemptsRef.current = 0;
            return;
        }

        reconnectAttemptsRef.current++;
        const delay = Math.min(RECONNECT_DELAY_BASE_MS * Math.pow(2, reconnectAttemptsRef.current - 1), 30000); // Exponential backoff up to 30s

        //console.log(`GladiaRt: Scheduling reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`);
        
        clearReconnectTimer();
        reconnectTimeoutRef.current = setTimeout(() => {
            if (componentMountedRef.current && !isSessionExplicitlyStoppedRef.current) {
                //console.log("GladiaRt: Reconnect timer fired.");
                // Strategy: Try existing URL for the first 2 attempts. Then force new session.
                if (webSocketUrlRef.current && reconnectAttemptsRef.current <= 2) {
                    //console.log("GladiaRt: Attempting WebSocket reconnect using existing URL.");
                    connectWebSocket();
                } else {
                    //console.log("GladiaRt: Reached attempt limit for existing URL or no URL, attempting to initiate new session.");
                    webSocketUrlRef.current = null; // Ensure new session is fetched
                    // Optionally reset reconnectAttemptsRef here if new session is a full reset of attempts, or let it continue counting.
                    // For now, let it continue, so total attempts (mix of reconnect and re-initiate) are capped.
                    initiateSession();
                }
            }
        }, delay);
    }, [connectWebSocket, initiateSession, onError, clearReconnectTimer]);


    const startSession = useCallback(() => {
        //console.log("GladiaRt: startSession() called.");
        if (!componentMountedRef.current) {
            console.warn("GladiaRt: startSession called but component not mounted.")
            return;
        };
        isSessionExplicitlyStoppedRef.current = false; // User wants it active
        if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
            if (!isConnectingRef.current) {
                 // If no URL, initiateSession will handle it. If URL exists, connectWebSocket will use it.
                if (webSocketUrlRef.current) {
                    //console.log("GladiaRt: startSession - WebSocket URL exists, attempting connectWebSocket.");
                    connectWebSocket();
                } else {
                    //console.log("GladiaRt: startSession - No WebSocket URL, attempting initiateSession.");
                    initiateSession();
                }
            } else {
                //console.log("GladiaRt: startSession - Connection attempt already in progress.");
            }
        } else {
            //console.log(`GladiaRt: startSession - Session/Socket seems active (state: ${socketRef.current?.readyState}).`);
        }
    }, [initiateSession, connectWebSocket]);


    const stopSession = useCallback((graceful = true) => {
        //console.log(`GladiaRt: stopSession(${graceful}) called.`);
        isSessionExplicitlyStoppedRef.current = true;
        clearReconnectTimer();
        
        if (socketRef.current) {
            if (socketRef.current.readyState === WebSocket.OPEN) {
                if (graceful) {
                    //console.log("GladiaRt: Sending stop_recording message.");
                    try {
                        socketRef.current.send(JSON.stringify({ type: "stop_recording" }));
                    } catch(e) {
                        console.error("GladiaRt: Error sending stop_recording:", e, "---");
                    }
                }
            }
            // closeExistingSocket will handle different states.
            // The '1000' code indicates a normal closure.
            closeExistingSocket(1000, "Session explicitly stopped by client");
        }
        webSocketUrlRef.current = null; // Clear URL as session is stopped.
        sessionIdRef.current = null;
        setIsConnected(false); // Reflect disconnected state immediately
        //console.log("GladiaRt: Session stopped. WebSocket closed and URL cleared.");
    }, [clearReconnectTimer, closeExistingSocket]);


    const sendAudio = useCallback((audioData: ArrayBuffer) => {
        if (!componentMountedRef.current) return;

        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            try {
                // //console.log("GladiaRt: Sending audio chunk"); // DEBUG
                socketRef.current.send(audioData);
            } catch (error) {
                console.error("GladiaRt: Error sending audio:", error, "---");
                if (onError) onError(error as Error);
                // Optionally, attempt to reconnect or re-initiate if send fails due to socket issue
                // scheduleReconnect(); // Could be too aggressive
            }
        } else {
            console.warn(`GladiaRt: Cannot send audio. WebSocket not open. State: ${socketRef.current?.readyState}, isConnecting: ${isConnectingRef.current}, isExplicitlyStopped: ${isSessionExplicitlyStoppedRef.current}`);
            // If not connecting and not explicitly stopped, try to start/reconnect
            if(!isConnectingRef.current && !isSessionExplicitlyStoppedRef.current && componentMountedRef.current){
                //console.log("GladiaRt: Attempting to start session due to sendAudio on closed/non-existent socket");
                startSession();
            }
        }
    }, [onError, startSession]);

    useEffect(() => {
        componentMountedRef.current = true;
        //console.log("GladiaRt: Hook mounted. autoStart:", autoStart, "---");
        if (autoStart) {
            startSession();
        }
        return () => {
            //console.log("GladiaRt: Hook unmounting. Cleaning up...");
            componentMountedRef.current = false;
            stopSession(true); // Graceful stop on unmount
        };
    }, [autoStart, startSession, stopSession]); // Add stopSession to dependencies

    return {
        sendAudio,
        startSession,
        stopSession,
        isConnected,
        currentTranscript,
    };
};

export default useGladiaRt; 
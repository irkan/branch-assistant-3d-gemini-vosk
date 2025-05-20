import React, { forwardRef, useImperativeHandle, useEffect, useCallback } from 'react';
import useGladiaRt, {
    GladiaRtCallbacks,
    GladiaRtOptions,
    GladiaRtHandle as HookHandle
} from './useGladiaRt';

export interface GladiaRtComponentProps extends GladiaRtOptions, GladiaRtCallbacks {
    // Additional component-specific props can be added here
    showDebugInfo?: boolean; 
    style?: React.CSSProperties;
    className?: string;
}

export interface GladiaRtRef {
    sendAudio: (audioData: ArrayBuffer) => void;
    start: () => void; // Renaming for consistency with other components if needed
    stop: (graceful?: boolean) => void; // Renaming
    isConnected: () => boolean;
    getTranscript: () => string;
}

const GladiaRtComponent = forwardRef<GladiaRtRef, GladiaRtComponentProps>((
    {
        // Callbacks for the hook
        onTranscript,
        onError,
        onConnected,
        onDisconnected,
        onSessionId,
        // Options for the hook
        sampleRate,
        autoStart = true, // Default autoStart to true for the component
        streamingConfig,
        audioFormat,
        // Component-specific props
        showDebugInfo = false,
        style,
        className,
    },
    ref
) => {

    const handleTranscript = useCallback((transcript: string, isFinal: boolean) => {
        if (showDebugInfo) {
            console.log(`GladiaRtComponent: Transcript (${isFinal ? 'Final' : 'Partial'}): ${transcript}`);
        }
        if (onTranscript) onTranscript(transcript, isFinal);
    }, [onTranscript, showDebugInfo]);

    const handleError = useCallback((error: Error) => {
        if (showDebugInfo) {
            console.error("GladiaRtComponent: Error reported:", error);
        }
        if (onError) onError(error);
    }, [onError, showDebugInfo]);

    const handleConnected = useCallback(() => {
        if (showDebugInfo) {
            console.log("GladiaRtComponent: Connected!");
        }
        if (onConnected) onConnected();
    }, [onConnected, showDebugInfo]);

    const handleDisconnected = useCallback((reason?: string) => {
        if (showDebugInfo) {
            console.log(`GladiaRtComponent: Disconnected. Reason: ${reason || 'N/A'}`);
        }
        if (onDisconnected) onDisconnected(reason);
    }, [onDisconnected, showDebugInfo]);

    const handleSessionId = useCallback((sessionId: string) => {
        if (showDebugInfo) {
            console.log(`GladiaRtComponent: Session ID received: ${sessionId}`);
        }
        if (onSessionId) onSessionId(sessionId);
    },[onSessionId, showDebugInfo]);

    const gladiaHook = useGladiaRt(
        {
            onTranscript: handleTranscript,
            onError: handleError,
            onConnected: handleConnected,
            onDisconnected: handleDisconnected,
            onSessionId: handleSessionId,
        },
        {
            sampleRate,
            autoStart, // Pass autoStart from props to the hook
            streamingConfig,
            audioFormat,
        }
    );

    useImperativeHandle(ref, () => ({
        sendAudio: gladiaHook.sendAudio,
        start: gladiaHook.startSession, 
        stop: gladiaHook.stopSession,
        isConnected: () => gladiaHook.isConnected, // Hook provides a boolean state
        getTranscript: () => gladiaHook.currentTranscript,
    }));

    // This component itself might not render much, or just debug info.
    return (<></>);
});

GladiaRtComponent.displayName = 'GladiaRtComponent';

export default GladiaRtComponent; 
import React, { forwardRef, useImperativeHandle, useEffect, useCallback, useRef } from 'react';
import { LipSyncRef } from '../../lipsync/LipSync';

import useGladiaRt, {
    GladiaRtCallbacks,
    GladiaRtOptions,
    GladiaRtHandle as HookHandle,
    GladiaWordTimestamp
} from './useGladiaRt';

export interface GladiaRtComponentProps extends GladiaRtOptions, GladiaRtCallbacks {
    // Additional component-specific props can be added here
    showDebugInfo?: boolean; 
    style?: React.CSSProperties;
    className?: string;
    lipSyncRef: React.RefObject<LipSyncRef>;
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
        lipSyncRef,
    },
    ref
) => {
    // Sequence nömrəsi və son yenilənmə vaxtını izləmək üçün ref-lər
    const sequenceNumber = useRef<number>(0);
    const lastSequenceUpdateTime = useRef<number>(Date.now());

    const handleTranscript = useCallback((transcript: string, isFinal: boolean, words?: GladiaWordTimestamp[]) => {
        if (showDebugInfo) {
            console.log(`GladiaRtComponent: Transcript (${isFinal ? 'Final' : 'Partial'}): ${transcript}`);
            if (words && words.length > 0) {
                console.log("GladiaRtComponent: Word Timestamps (JSON):", JSON.stringify(words, null, 2));
                
                if (lipSyncRef && lipSyncRef.current) {
                    // İndiki vaxtı yoxla
                    const currentTime = Date.now();
                    
                    // Əgər son yeniləmədən 2 saniyə keçibsə, sequence nömrəsini artır
                    if (currentTime - lastSequenceUpdateTime.current > 4000) {
                        sequenceNumber.current += 1;
                        lastSequenceUpdateTime.current = currentTime;
                        console.log(`GladiaRtComponent: Sequence number updated to ${sequenceNumber.current}`);
                    } else {
                        lastSequenceUpdateTime.current = currentTime;
                        console.log(`GladiaRtComponent: Sequence number not updated, current time: ${currentTime}, last sequence update time: ${lastSequenceUpdateTime.current}`);
                    }
                    
                    // LipSync-ə sözləri və sequence nömrəsini göndər
                    lipSyncRef.current.proccessLipSyncData(words, sequenceNumber.current);
                    console.log(`GladiaRtComponent: Sent data to LipSync with sequence ${sequenceNumber.current}`);
                } else {
                    console.warn("GladiaRtComponent: lipSyncRef is not available to process lip sync data.");
                }
            }
        }
        if (onTranscript) onTranscript(transcript, isFinal, words);
    }, [onTranscript, showDebugInfo, lipSyncRef]);

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
    return null;
});

GladiaRtComponent.displayName = 'GladiaRtComponent';

export default GladiaRtComponent; 
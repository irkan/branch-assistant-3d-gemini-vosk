import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import useGladiaProcessor from './useGladiaProcessor';
import { StreamingConfig, StreamingAudioFormat } from '../../../lib/gladia/live/types';

// Define the shape of the props for GladiaComponent
export interface GladiaComponentProps {
  // Props to configure the useGladiaProcessor hook
  sampleRate?: number;
  autoStart?: boolean;
  streamingConfig?: Partial<StreamingConfig>;
  audioFormat?: Partial<StreamingAudioFormat>;

  // Callbacks for speech events
  onFinalResult?: (text: string) => void;
  onPartialResult?: (text: string) => void; // If Gladia supports this
  onError?: (error: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;

  // Styling or other UI related props
  style?: React.CSSProperties;
  className?: string;
  showDebugInfo?: boolean; // To control visibility of debug text
}

// Define the methods exposed by the GladiaComponent ref
export interface GladiaRef {
  sendAudio: (audioData: ArrayBuffer) => void;
  start: () => void;
  stop: () => void;
  isConnected: () => boolean;
  getTranscript: () => string;
}

const GladiaComponent = forwardRef<GladiaRef, GladiaComponentProps>((
  {
    sampleRate,
    autoStart = true, // Default to autoStart like VoskComponent
    streamingConfig,
    audioFormat,
    onFinalResult,
    onPartialResult,
    onError,
    onConnect,
    onDisconnect,
    style,
    className,
    showDebugInfo = false, // Default to not showing debug info
  },
  ref
) => {
  const [internalTranscript, setInternalTranscript] = useState('');
  const [isConnectedState, setIsConnectedState] = useState(false);

  const handleFinalResult = useCallback((text: string) => {
    setInternalTranscript(prev => prev + text + ' '); // Accumulate transcript
    if (onFinalResult) {
      onFinalResult(text);
    }
  }, [onFinalResult]);

  const handlePartialResult = useCallback((text: string) => {
    // Placeholder: If you want to display partial results differently
    // setInternalTranscript(text); // Or append to a different state for partials
    if (onPartialResult) {
      onPartialResult(text);
    }
  }, [onPartialResult]);

  const handleConnect = useCallback(() => {
    setIsConnectedState(true);
    if (onConnect) onConnect();
  }, [onConnect]);

  const handleDisconnect = useCallback(() => {
    setIsConnectedState(false);
    if (onDisconnect) onDisconnect();
  }, [onDisconnect]);

  const handleError = useCallback((error: any) => {
    console.error("GladiaComponent Error:", error);
    if (onError) onError(error);
  }, [onError]);

  const gladiaProcessor = useGladiaProcessor(
    {
      onFinalResult: handleFinalResult,
      onPartialResult: handlePartialResult, // Pass down partial result handler
      onError: handleError,
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
    },
    {
      sampleRate,
      autoStart,
      streamingConfig,
      audioFormat,
    }
  );

  useImperativeHandle(ref, () => ({
    sendAudio: gladiaProcessor.sendAudio,
    start: gladiaProcessor.startProcessing,
    stop: gladiaProcessor.stopProcessing,
    isConnected: gladiaProcessor.isConnected,
    getTranscript: () => gladiaProcessor.transcript, // Or internalTranscript if preferred
  }));

  // Optional: Effect to log connection status changes or transcript updates for debugging
  useEffect(() => {
    if (showDebugInfo) {
      console.log('Gladia Connection Status:', gladiaProcessor.isConnected());
    }
  }, [gladiaProcessor.isConnected(), showDebugInfo]);

  useEffect(() => {
    if (showDebugInfo && gladiaProcessor.transcript) {
      console.log('Gladia Transcript Updated:', gladiaProcessor.transcript);
    }
  }, [gladiaProcessor.transcript, showDebugInfo]);

  // This component can render some UI if needed, e.g., status indicators
  // For now, similar to VoskComponent, it can be mostly non-visual or have optional debug UI.
  return (
    <div style={style} className={className}>
      {showDebugInfo && (
        <div style={{ display: 'none' }}> {/* Hidden by default like VoskComponent */}
          <div>Gladia bağlantısı: {gladiaProcessor.isConnected() ? 'Aktiv ✅' : 'Qırılıb ❌'}</div>
          {gladiaProcessor.transcript && <div>Tanınmış mətn (Gladia): {gladiaProcessor.transcript}</div>}
        </div>
      )}
    </div>
  );
});

GladiaComponent.displayName = 'GladiaComponent';

export default GladiaComponent;

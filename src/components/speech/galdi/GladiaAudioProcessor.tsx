import React, { useEffect, useImperativeHandle, forwardRef } from 'react';
import useGladiaProcessor, { GladiaProcessorHandle as InternalGladiaProcessorHandle } from './useGladiaProcessor';
import { StreamingConfig, StreamingAudioFormat } from '../../../lib/gladia/live/types';

export interface GladiaAudioProcessorProps {
  onFinalResult?: (text: string) => void;
  onPartialResult?: (text: string) => void;
  onError?: (error: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  sampleRate?: number;
  autoStart?: boolean;
  streamingConfig?: Partial<StreamingConfig>;
  audioFormat?: Partial<StreamingAudioFormat>;
  // Add any other props you might need to pass to the hook or for the component itself
}

// This ref handle type should match what you want to expose from this component specifically
export interface GladiaAudioProcessorRef {
  sendAudio: (audioData: ArrayBuffer) => void;
  start: () => void;
  stop: () => void;
  isConnected: () => boolean;
  getTranscript: () => string;
}

const GladiaAudioProcessor = forwardRef<GladiaAudioProcessorRef, GladiaAudioProcessorProps>((
  {
    onFinalResult,
    onPartialResult,
    onError,
    onConnect,
    onDisconnect,
    sampleRate,
    autoStart,
    streamingConfig,
    audioFormat,
  },
  ref
) => {
  const gladiaProcessor = useGladiaProcessor(
    {
      onFinalResult,
      onPartialResult,
      onError,
      onConnect,
      onDisconnect,
    },
    {
      sampleRate,
      autoStart,
      streamingConfig,
      audioFormat
    }
  );

  useImperativeHandle(ref, () => ({
    sendAudio: gladiaProcessor.sendAudio,
    start: gladiaProcessor.startProcessing,
    stop: gladiaProcessor.stopProcessing,
    isConnected: gladiaProcessor.isConnected,
    getTranscript: () => gladiaProcessor.transcript, // Expose transcript via a method
  }));

  // This component doesn't render anything itself, it's a utility wrapper.
  return null;
});

GladiaAudioProcessor.displayName = 'GladiaAudioProcessor';

export default GladiaAudioProcessor;

import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';

// Web Speech API type definitions
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
  interpretation: any;
}

interface SpeechRecognitionError extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionError) => void) | null;
}

interface LipSyncProps {
  onTranscript?: (text: string) => void;
  enabled?: boolean;
}

export interface LipSyncRef {
  start: () => void;
  stop: () => void;
}

const LipSync = forwardRef<LipSyncRef, LipSyncProps>(({ onTranscript, enabled = false }, ref) => {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);

  const initializeRecognition = () => {
    if (!('webkitSpeechRecognition' in window)) {
      console.error('Web Speech API is not supported in this browser.');
      return null;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = 'az-AZ'; // Azerbaijani language
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');
      
      const resultTime = new Date().toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });
      console.log(`[${resultTime}] Səs tanıma nəticəsi:`, transcript);
      
      if (onTranscript) {
        onTranscript(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionError) => {
      const errorTime = new Date().toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });
      console.error(`[${errorTime}] Səs tanıma xətası:`, event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Səs tanıma dayandıqda avtomatik olaraq yenidən başlat
      if (recognitionRef.current && enabled) {
        const restartTime = new Date().toLocaleTimeString('en-US', { 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3
        });
        console.log(`[${restartTime}] Səs tanıma yenidən başladılır...`);
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch (error) {
          console.error('Səs tanımanı yenidən başlatmaq mümkün olmadı:', error);
        }
      }
    };

    return recognition;
  };

  const start = () => {
    if (!enabled) {
      console.log('Səs tanıma deaktivdir');
      return;
    }

    if (!recognitionRef.current) {
      const recognition = initializeRecognition();
      if (recognition) {
        try {
          const startTime = new Date().toLocaleTimeString('en-US', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
          });
          console.log(`[${startTime}] Səs tanıma başladı`);
          recognition.start();
          setIsListening(true);
        } catch (error) {
          console.error('Səs tanımanı başlatmaq mümkün olmadı:', error);
        }
      }
    } else if (!isListening) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        console.error('Səs tanımanı başlatmaq mümkün olmadı:', error);
      }
    }
  };

  const stop = () => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
        setIsListening(false);
      } catch (error) {
        console.error('Səs tanımanı dayandırmaq mümkün olmadı:', error);
      }
    }
  };

  useImperativeHandle(ref, () => ({
    start,
    stop
  }));

  // enabled prop-u dəyişdikdə səs tanımanı yenidən başlat və ya dayandır
  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }
  }, [enabled]);

  return null;
});

export default LipSync; 
export { default as LipSync } from './LipSync'; 
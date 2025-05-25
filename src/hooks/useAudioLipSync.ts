import { useRef, useEffect } from 'react';
import { AudioStreamer } from '../lib/audio-streamer';
import { LipSyncRef } from './../components/lipsync/LipSync';
import { GladiaWordTimestamp } from '../components/speech/gladia/useGladiaRt';

export const useAudioLipSync = (audioContext: AudioContext) => {
    const audioStreamer = useRef<AudioStreamer | null>(null);
    const lipSyncRef = useRef<LipSyncRef | null>(null);

    // AudioStreamer yarad
    useEffect(() => {
        if (audioContext) {
            audioStreamer.current = new AudioStreamer(audioContext);
            console.log('useAudioLipSync: AudioStreamer created');
        }

        return () => {
            if (audioStreamer.current) {
                audioStreamer.current.stop();
                console.log('useAudioLipSync: AudioStreamer stopped');
            }
        };
    }, [audioContext]);

    // LipSync referansını qeyd et
    const setLipSyncRef = (ref: LipSyncRef) => {
        lipSyncRef.current = ref;
        
        // AudioStreamer ilə LipSync-i bağla
        if (ref && audioStreamer.current) {
            //ref.setAudioStreamer(audioStreamer.current);
            console.log('useAudioLipSync: LipSync connected to AudioStreamer');
        }
    };

    // Audio chunk əlavə et
    const addAudioChunk = (chunk: Uint8Array) => {
        if (audioStreamer.current) {
            audioStreamer.current.addPCM16(chunk);
        }
    };

    // Lip sync məlumatları əlavə et
    const addLipSyncData = (data: GladiaWordTimestamp[]) => {
        if (lipSyncRef.current) {
            lipSyncRef.current.proccessLipSyncData(data);
        }
    };

    // Audio oynatmanı başlat
    const startAudio = async () => {
        if (audioStreamer.current) {
            await audioStreamer.current.resume();
            console.log('useAudioLipSync: Audio playback started');
        }
    };

    // Audio oynatmanı dayandır
    const stopAudio = () => {
        if (audioStreamer.current) {
            audioStreamer.current.stop();
            console.log('useAudioLipSync: Audio playback stopped');
        }
    };

    // Audio stream tamamlandı
    const completeAudio = () => {
        if (audioStreamer.current) {
            audioStreamer.current.complete();
            console.log('useAudioLipSync: Audio stream completed');
        }
    };

    // Volume təyin et
    const setVolume = (volume: number) => {
        if (audioStreamer.current) {
            audioStreamer.current.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        }
    };

    return {
        setLipSyncRef,
        addAudioChunk,
        addLipSyncData,
        startAudio,
        stopAudio,
        completeAudio,
        setVolume,
        audioStreamer: audioStreamer.current,
        isPlaying: audioStreamer.current?.isPlaying || false
    };
}; 
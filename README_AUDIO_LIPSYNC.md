# Audio və LipSync İnteqrasiyası

Bu sistem AudioStreamer və LipSync komponentlərini real audio playback ilə sinxronlaşdırır.

## 🎯 Üstünlüklər

1. **Real Audio Sinxronizasiyası**: AudioContext timing istifadə edir
2. **Avtomatik Cleanup**: Audio dayandıqda lip sync də təmizlənir  
3. **Performans Optimallaşdırması**: Frame skipping və throttling
4. **Character Limit**: 1000 hərf limiti ilə uzun danışıqlara dəstək

## 🚀 İstifadə

### 1. Hook İstifadəsi (Tövsiyə edilir)

```tsx
import { useAudioLipSync } from '../hooks/useAudioLipSync';
import { LipSync, LipSyncRef } from '../components/lipsync/LipSync';

const MyComponent = () => {
    const audioContext = new AudioContext();
    const lipSyncRef = useRef<LipSyncRef>(null);
    
    const {
        setLipSyncRef,
        addAudioChunk,
        addLipSyncData,
        startAudio,
        stopAudio,
        isPlaying
    } = useAudioLipSync(audioContext);

    useEffect(() => {
        if (lipSyncRef.current) {
            setLipSyncRef(lipSyncRef.current);
        }
    }, [setLipSyncRef]);

    // Audio chunk əlavə et (streaming audio üçün)
    const handleAudioChunk = (chunk: Uint8Array) => {
        addAudioChunk(chunk);
    };

    // Lip sync məlumatları əlavə et
    const handleLipSyncData = (data: GladiaWordTimestamp[]) => {
        addLipSyncData(data);
    };

    return (
        <div>
            <LipSync ref={lipSyncRef} />
            <button onClick={startAudio}>Start</button>
            <button onClick={stopAudio}>Stop</button>
        </div>
    );
};
```

### 2. Manual İstifadə

```tsx
import { AudioStreamer } from '../lib/audio-streamer';
import { LipSync, LipSyncRef } from '../components/lipsync/LipSync';

const MyComponent = () => {
    const audioContext = new AudioContext();
    const audioStreamer = new AudioStreamer(audioContext);
    const lipSyncRef = useRef<LipSyncRef>(null);

    useEffect(() => {
        // LipSync-i AudioStreamer ilə bağla
        if (lipSyncRef.current) {
            lipSyncRef.current.setAudioStreamer(audioStreamer);
        }
    }, []);

    // Audio streaming
    const handleAudioChunk = (chunk: Uint8Array) => {
        audioStreamer.addPCM16(chunk);
    };

    // Lip sync
    const handleLipSyncData = (data: GladiaWordTimestamp[]) => {
        lipSyncRef.current?.proccessLipSyncData(data);
    };

    return <LipSync ref={lipSyncRef} />;
};
```

## 🔧 Əsas Xüsusiyyətlər

### AudioStreamer Callback-ləri

```typescript
audioStreamer.onAudioStart = (startTime: number) => {
    console.log("Audio başladı:", startTime);
};

audioStreamer.onAudioProgress = (currentTime: number, isPlaying: boolean) => {
    console.log("Audio vəziyyəti:", { currentTime, isPlaying });
};

audioStreamer.onComplete = () => {
    console.log("Audio tamamlandı");
};
```

### LipSync Performans Optimallaşdırması

- **Character Limit**: 120 hərf limitə əsasən queue məhdudlaşdırır (ilk 120 hərf götürülür)
- **Frame Skipping**: Hər 2-ci frame skip olunur (50% performans artışı)
- **Throttling**: 30fps-ə məhdudlaşdırılıb
- **Timeout**: 15 saniyədən uzun animasiyalar avtomatik dayandırılır

### Audio Timing Sistemi

```typescript
// AudioContext real timing istifadə edir
const audioStartTime = audioContext.currentTime + delay;

// LipSync bu timing-ə uyğunlaşır
const wordStartTime = audioStartTime + wordTimestamp.start;
```

## 📊 Debug Logları

Sistem ətraflı debug məlumatları təqdim edir:

```
LipSync: Using AudioContext timing. Audio starts at: 67.100s
LipSync: Total characters in this batch: 25  
LipSync: Animation frame #60, elapsed: 1.23s, queue: 15
LipSync: Audio stopped, clearing lip sync
```

## ⚠️ Diqqət Ediləcək Məqamlar

1. **AudioContext Activation**: İstifadəçi tərəfindən user interaction tələb olunur
2. **Character Limit**: 120+ hərf olduqda avtomatik kəsilir (ilk 120 hərf saxlanır)
3. **Audio Delay**: AudioStreamer-də 0.5s delay var
4. **Memory Management**: Avtomatik cleanup və referans təmizliyi

## 🎭 Yanaşma 2: AudioStreamer-də LipSync (Alternativ)

AudioStreamer sinifına birbaşa lip sync əlavə etmək də mümkündür:

```typescript
// AudioStreamer-ə əlavə etmək üçün:
export class AudioStreamer {
    public lipSyncQueue: LipSyncData[] = [];
    public onMorphTargetUpdate: (targets: MorphTargetData[]) => void = () => {};

    addLipSyncData(data: GladiaWordTimestamp[]) {
        // Morph target-ləri audio scheduling ilə birlikdə schedule et
    }
}
```

Lakin **Yanaşma 1 (Callback-based)** daha modulyar və test edilə biləndir.

## 🏁 Nəticə

Bu sistem:
✅ Real audio timing ilə sinxronlaşır  
✅ Performansı optimallaşdırır  
✅ Avtomatik cleanup təmin edir  
✅ Character sayına əsasən məhdudlaşdır  
✅ Memory leak-ləri önləyir  

İstifadə etmək üçün `useAudioLipSync` hook-unu tövsiyə edirik. 
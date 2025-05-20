/**
 * Copyright 2024 Google LLC
 * ... (lisenziya mətni) ...
 */

import {
    createWorketFromSrc, // Əgər kodunuzda 'createWorketFromSrc' yazılıbsa, belə saxlayın
    registeredWorklets,
  } from "./audioworklet-registry"; // Bu faylın mövcud olduğundan əmin olun
  
  export class AudioStreamer {
    public audioQueue: Float32Array[] = [];
    private isPlaying: boolean = false;
    private sampleRate: number = 24000; // Bu, sizin PCM datanızın sample rate-i ilə eyni olmalıdır!
                                        // Əgər 16kHz-dirsə, bunu 16000 edin.
    private bufferSize: number = 7680;
    private processingBuffer: Float32Array = new Float32Array(0);
    private scheduledTime: number = 0;
    public gainNode: GainNode;
    // private source: AudioBufferSourceNode; // Hər buffer üçün yeni source yaradılır
    private isStreamComplete: boolean = false;
    private checkInterval: number | null = null;
    private initialBufferTime: number = 0.1;
    private endOfQueueAudioSource: AudioBufferSourceNode | null = null;
  
    // === LIP SYNC ÜÇÜN ƏLAVƏLƏR ===
    private analyserNode: AnalyserNode;
    private analysisDataArray: Uint8Array;
    private animationFrameId: number | null = null;
    private currentRms: number = 0;
    private smoothingFactor: number = 0.75; // 0.0 (kəskin) - 1.0 (çox yumşaq)
    // === LIP SYNC ÜÇÜN ƏLAVƏLƏR SONU ===

        // === AMPLİTUD ANALİZİ FUNKSİYALARI ===
    // AudioStreamer klassınızın içində, yuxarı hissədə bu dəyişənləri əlavə edin:
    private lastLoggedRms: number = -1; // Son loglanmış RMS dəyəri
    private logThreshold: number = 0.01; // Yalnız bu qədər dəyişiklik olduqda logla
    private lastLogTime: number = 0;    // Son loglama vaxtı
    private logInterval: number = 500;  // Hər 250 ms-dən bir logla (saniyədə 4 dəfə)
  
    public onComplete = () => {
      console.log("[AudioStreamer] onComplete çağırıldı.");
    };
  
    constructor(public context: AudioContext, inputSampleRate?: number) { // inputSampleRate əlavə etdim
      if (inputSampleRate) {
        this.sampleRate = inputSampleRate;
        console.log(`[AudioStreamer] Constructor: sampleRate ${this.sampleRate} olaraq təyin edildi.`);
      } else {
        console.warn(`[AudioStreamer] Constructor: inputSampleRate verilmədi, default ${this.sampleRate} istifadə olunur.`);
      }
  
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination); // GainNode-u birbaşa destination-a qoşuruq
  
      // === LIP SYNC ÜÇÜN ANALYSERNODE QURAŞDIRILMASI ===
      this.analyserNode = this.context.createAnalyser();
      this.analyserNode.fftSize = 256; // Yaxşı performans/dəqiqlik balansı
      this.analysisDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
  
      // Audio graph-ı dəyişirik:
      // Original: SourceNode(s) -> gainNode -> destination
      // Yeni: SourceNode(s) -> analyserNode -> gainNode -> destination
      // Bu o deməkdir ki, scheduleNextBuffer-də source-u analyserNode-a qoşacağıq,
      // və analyserNode-u gainNode-a qoşacağıq.
      this.analyserNode.connect(this.gainNode); // AnalyserNode-un çıxışını gainNode-a veririk
      // === LIP SYNC ÜÇÜN ANALYSERNODE QURAŞDIRILMASI SONU ===
  
  
      this.addPCM16 = this.addPCM16.bind(this);
      this.scheduleNextBuffer = this.scheduleNextBuffer.bind(this);
      // Analiz üçün metodları da bağlayaq
      this._startAmplitudeAnalysis = this._startAmplitudeAnalysis.bind(this);
      this._stopAmplitudeAnalysis = this._stopAmplitudeAnalysis.bind(this);
    }
  
    async addWorklet<T extends (d: any) => void>(
      workletName: string,
      workletSrc: string,
      handler: T,
    ): Promise<this> {
      let workletsRecord = registeredWorklets.get(this.context);
      if (workletsRecord && workletsRecord[workletName]) {
        workletsRecord[workletName].handlers.push(handler);
        return Promise.resolve(this);
      }
  
      if (!workletsRecord) {
        registeredWorklets.set(this.context, {});
        workletsRecord = registeredWorklets.get(this.context)!;
      }
  
      workletsRecord[workletName] = { handlers: [handler] };
  
      const src = createWorketFromSrc(workletName, workletSrc); // Orijinal adla saxlayırıq
      await this.context.audioWorklet.addModule(src);
      const worklet = new AudioWorkletNode(this.context, workletName);
  
      workletsRecord[workletName].node = worklet;
      return this;
    }
  
    addPCM16(chunk: Uint8Array) {
      // console.log(`[AudioStreamer] addPCM16 çağırıldı, chunk ölçüsü: ${chunk.byteLength}`);
      const float32Array = new Float32Array(chunk.length / 2);
      const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  
      for (let i = 0; i < float32Array.length; i++) {
        try {
          const int16 = dataView.getInt16(i * 2, true);
          float32Array[i] = int16 / 32768.0;
        } catch (e) {
          console.error("[AudioStreamer] PCM çevirmə xətası:", e);
        }
      }
  
      const newBuffer = new Float32Array(
        this.processingBuffer.length + float32Array.length,
      );
      newBuffer.set(this.processingBuffer);
      newBuffer.set(float32Array, this.processingBuffer.length);
      this.processingBuffer = newBuffer;
  
      while (this.processingBuffer.length >= this.bufferSize) {
        const buffer = this.processingBuffer.slice(0, this.bufferSize);
        this.audioQueue.push(buffer);
        this.processingBuffer = this.processingBuffer.slice(this.bufferSize);
      }
  
      if (!this.isPlaying && this.audioQueue.length > 0) {
        console.log("[AudioStreamer] Oynatmağa başlanır...");
        this.isPlaying = true;
        this.scheduledTime = this.context.currentTime + this.initialBufferTime;
        this.scheduleNextBuffer();
        this._startAmplitudeAnalysis(); // Amplitud analizini başlat
      } else if (this.isPlaying) {
        // Əgər artıq çalınırsa və yeni data gəlibsə, scheduleNextBuffer-in
        // timeout-u bunu idarə etməlidir. Zərurət olarsa, dərhal çağırıla bilər.
        // this.scheduleNextBuffer();
      }
    }
  
    private createAudioBuffer(audioData: Float32Array): AudioBuffer {
      const audioBuffer = this.context.createBuffer(
        1,
        audioData.length,
        this.sampleRate,
      );
      audioBuffer.getChannelData(0).set(audioData);
      return audioBuffer;
    }
  
    private scheduleNextBuffer() {
      const SCHEDULE_AHEAD_TIME = 0.2;
  
      while (
        this.audioQueue.length > 0 &&
        this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
      ) {
        const audioData = this.audioQueue.shift()!;
        if (!audioData) continue;
  
        const audioBuffer = this.createAudioBuffer(audioData);
        const source = this.context.createBufferSource();
        source.buffer = audioBuffer;
  
        // === SOURCE-U ANALYSERNODE-A QOŞURUQ ===
        source.connect(this.analyserNode);
        // AnalyserNode artıq constructor-da gainNode-a qoşulub.
        // GainNode da destination-a qoşulub.
        // Beləliklə, axın: source -> analyserNode -> gainNode -> destination
  
        // Worklet-lərin qoşulması (mövcud kodunuz)
        // Diqqət: Əgər worklet-lər də səs çıxarırsa, onların hara qoşulduğuna baxın.
        // Eyni səsi iki dəfə destination-a göndərməmək üçün.
        const worklets = registeredWorklets.get(this.context);
        if (worklets) {
          Object.entries(worklets).forEach(([workletName, graph]) => {
            const { node, handlers } = graph;
            if (node) {
              // Əgər worklet-lər ana səsi emal edirsə:
              // source.connect(node); node.connect(this.gainNode); (və ya this.analyserNode-dan sonra)
              // Əgər paralel bir iş görürsə və öz çıxışı varsa:
              source.connect(node); // Sizin orijinal kodunuzdakı kimi
              node.port.onmessage = function (ev: MessageEvent) {
                handlers.forEach((handler) => {
                  handler.call(node.port, ev);
                });
              };
              node.connect(this.context.destination); // Bu, ana səsdən əlavə bir çıxışdır
              console.log(`[AudioStreamer] Worklet ${workletName} source-a və destination-a qoşuldu.`);
            }
          });
        }
  
        if (this.audioQueue.length === 0) {
          if (this.endOfQueueAudioSource) {
            this.endOfQueueAudioSource.onended = null;
          }
          this.endOfQueueAudioSource = source;
          source.onended = () => {
            if (
              !this.audioQueue.length &&
              this.endOfQueueAudioSource === source
            ) {
              this.endOfQueueAudioSource = null;
              console.log("[AudioStreamer] Son buffer çalınıb bitdi.");
              if(this.isStreamComplete && this.processingBuffer.length === 0) {
                console.log("[AudioStreamer] Stream tamamlandı və processingBuffer boşdur. onComplete çağırılır.");
                this.onComplete();
                this.isPlaying = false;
                this._stopAmplitudeAnalysis();
              }
            }
          };
        }
  
        const startTime = Math.max(this.scheduledTime, this.context.currentTime);
        source.start(startTime);
        this.scheduledTime = startTime + audioBuffer.duration;
      }
  
      if (this.audioQueue.length === 0 && this.processingBuffer.length === 0) {
        if (this.isStreamComplete) {
          // onended bunu idarə etməlidir
          // this.isPlaying = false;
          // this._stopAmplitudeAnalysis();
          if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
          }
        } else {
          if (!this.checkInterval) {
            this.checkInterval = window.setInterval(() => {
              if (
                this.audioQueue.length > 0 ||
                (this.processingBuffer.length > 0 && !this.isStreamComplete) ||
                (this.isStreamComplete && this.processingBuffer.length >= this.bufferSize)
              ) {
                if (this.isStreamComplete && this.processingBuffer.length > 0 && this.audioQueue.length === 0) {
                    this.audioQueue.push(this.processingBuffer.slice(0));
                    this.processingBuffer = new Float32Array(0);
                }
                this.scheduleNextBuffer();
              } else if (this.isStreamComplete && this.processingBuffer.length === 0 && this.audioQueue.length === 0) {
                  if (this.checkInterval) {
                      clearInterval(this.checkInterval);
                      this.checkInterval = null;
                  }
              }
            }, 100) as unknown as number;
          }
        }
      } else {
        const timeUntilNextSchedule = Math.max(0, (this.scheduledTime - this.context.currentTime - SCHEDULE_AHEAD_TIME / 2) * 1000);
        setTimeout(
          this.scheduleNextBuffer,
          timeUntilNextSchedule
        );
      }
    }
  


// ... mövcud kodunuz ...

private _startAmplitudeAnalysis() {
    if (this.animationFrameId !== null) return;

    console.log("[AudioStreamer] Amplitud analizi başladılır...");
    const analyse = () => {
      if (!this.isPlaying || !this.analyserNode) {
        this._stopAmplitudeAnalysis();
        return;
      }

      this.analyserNode.getByteTimeDomainData(this.analysisDataArray);

      let sumSquares = 0.0;
      for (const amplitude of this.analysisDataArray) {
        const normalizedSample = (amplitude / 128.0) - 1.0;
        sumSquares += normalizedSample * normalizedSample;
      }
      const rms = Math.sqrt(sumSquares / this.analysisDataArray.length);

      // Yumşaltma (mövcud kodunuzdakı kimi)
      this.currentRms = this.currentRms * this.smoothingFactor + rms * (1 - this.smoothingFactor);

      // === LOGLAMANI İDARƏ ETMƏK ===
      const currentTime = performance.now(); // Və ya Date.now()

      // Seçim 1: Yalnız dəyər əhəmiyyətli dərəcədə dəyişdikdə logla
      // if (Math.abs(this.currentRms - this.lastLoggedRms) > this.logThreshold) {
      //   console.log(`[LipSync RMS Changed]: ${this.currentRms.toFixed(4)} (Raw: ${rms.toFixed(4)})`);
      //   this.lastLoggedRms = this.currentRms;
      // }

      // Seçim 2: Müəyyən intervalda logla (daha çox tövsiyə olunur)
      // _startAmplitudeAnalysis metodunun içindəki loglama hissəsi:
      if (currentTime - this.lastLogTime > this.logInterval) {
        const mouthOpenness = this.getMouthOpennessForLog(this.currentRms);
        console.log(
          `[Interval Log | Smoothed RMS]: ${this.currentRms.toFixed(4)} | Ağız (0-1): ${mouthOpenness.toFixed(3)}`
        );
        this.lastLogTime = currentTime;
      }
      // === LOGLAMANI İDARƏ ETMƏK SONU ===


      // Lip sync üçün lazım olan dəyər this.currentRms-dir.
      // Bu dəyəri 3D xarakterinizin ağız blendshape-inə ötürməlisiniz.
      // Məsələn, bir callback vasitəsilə və ya bir state dəyişənini yeniləyərək.
      // if (this.onRmsUpdate) { // Əgər belə bir callback varsa
      //   this.onRmsUpdate(this.currentRms);
      // }

      this.animationFrameId = requestAnimationFrame(analyse);
    };
    this.animationFrameId = requestAnimationFrame(analyse);
}

// (Opsional) Mapping funksiyasını test üçün klass daxilinə əlavə edə bilərsiniz
// AudioStreamer klassınızın içinə bu metodu əlavə edin:
// AudioStreamer klassınızın içindəki getMouthOpennessForLog metodu:
private getMouthOpennessForLog(smoothedRms: number): number {
    const SILENCE_THRESHOLD = 0.018;      // Yeni loglara görə bir az dəyişdirilmişdir. Test edin!
    const MAX_RMS_FOR_FULL_OPEN = 0.32;   // Yeni loglara görə bir az dəyişdirilmişdir. Test edin!

    const range = MAX_RMS_FOR_FULL_OPEN - SILENCE_THRESHOLD;
    if (range <= 0) { // Korunma
        console.warn("MAX_RMS_FOR_FULL_OPEN SILENCE_THRESHOLD-dan kiçik və ya bərabər olmamalıdır!");
        return smoothedRms > SILENCE_THRESHOLD ? 1.0 : 0.0; // Sadə bir fallback
    }

    const MOUTH_SENSITIVITY = 1.0 / range;

    if (smoothedRms < SILENCE_THRESHOLD) {
        return 0.0; // Ağız bağlı
    }
    let openness = (smoothedRms - SILENCE_THRESHOLD) * MOUTH_SENSITIVITY;
    return Math.max(0.0, Math.min(1.0, openness)); // Dəyəri 0-1 aralığında saxla
}
  
    private _stopAmplitudeAnalysis() {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        console.log("[AudioStreamer] Amplitud analizi dayandırıldı.");
      }
      this.currentRms = 0;
    }
    // === AMPLİTUD ANALİZİ FUNKSİYALARI SONU ===
  
    stop() {
      console.log("[AudioStreamer] stop() çağırıldı.");
      this.isPlaying = false;
      this.isStreamComplete = true;
      this._stopAmplitudeAnalysis();
  
      this.audioQueue = [];
      this.processingBuffer = new Float32Array(0);
  
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
  
      if (this.gainNode && this.context) {
          this.gainNode.gain.cancelScheduledValues(this.context.currentTime);
          this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.context.currentTime);
          this.gainNode.gain.linearRampToValueAtTime(
          0,
          this.context.currentTime + 0.1,
          );
      }
  
  
      // Orijinal kodunuzdakı gainNode-un yenidən yaradılması hissəsi:
      // Bu, analyserNode-un gainNode ilə bağlantısını poza bilər.
      // Əgər bu hissə qalırsa, resume-da və ya başqa yerdə analyserNode-u
      // yeni gainNode-a yenidən qoşmaq lazım gələcək.
      // Mən bu hissəni şərhə alıram, çünki adətən gain-i sıfırlamaq kifayətdir.
      /*
      setTimeout(() => {
        this.gainNode.disconnect();
        this.gainNode = this.context.createGain();
        this.gainNode.connect(this.context.destination);
        // Əgər yuxarıdakı komment açılarsa, bu sətir də lazımdır:
        // if(this.analyserNode) this.analyserNode.connect(this.gainNode);
        console.log("[AudioStreamer] GainNode yenidən yaradıldı (stop içində).");
      }, 200);
      */
    }
  
    async resume() {
      console.log("[AudioStreamer] resume() çağırıldı.");
      if (this.context.state === "suspended") {
        console.log("[AudioStreamer] AudioContext suspended, resume edilir...");
        await this.context.resume();
        console.log("[AudioStreamer] AudioContext resumed.");
      }
      this.isStreamComplete = false;
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
  
      if (this.gainNode && this.context) {
          this.gainNode.gain.cancelScheduledValues(this.context.currentTime);
          this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.context.currentTime);
          this.gainNode.gain.linearRampToValueAtTime(1, this.context.currentTime + 0.1);
      }
  
      // Əgər audioQueue-da data varsa və ya isPlaying false idisə, analizə başla
      if ((this.audioQueue.length > 0 || this.processingBuffer.length > 0) && !this.isPlaying) {
          console.log("[AudioStreamer] resume: Oynatma və analiz üçün data var, başladılır...");
          this.isPlaying = true; // Əgər false idisə, true et
          this.scheduleNextBuffer(); // Qalmış bufferləri planla
          this._startAmplitudeAnalysis();
      } else if (this.isPlaying && this.animationFrameId === null) {
          // Əgər oynayırdı amma analiz dayanıbsa (məsələn stop() sonrası), yenidən başlat
          console.log("[AudioStreamer] resume: Oynayır amma analiz dayanıb, analiz yenidən başladılır...");
          this._startAmplitudeAnalysis();
      }
    }
  
    complete() {
      console.log("[AudioStreamer] complete() çağırıldı.");
      this.isStreamComplete = true;
      if (this.processingBuffer.length > 0) {
        console.log(`[AudioStreamer] complete: processingBuffer-də qalıq ${this.processingBuffer.length} bayt var, audioQueue-ya əlavə edilir.`);
        this.audioQueue.push(this.processingBuffer.slice(0));
        this.processingBuffer = new Float32Array(0);
        if (this.isPlaying) {
          this.scheduleNextBuffer();
        } else if (this.audioQueue.length > 0){
          console.log("[AudioStreamer] complete: Oynamırdı amma indi audioQueue-da data var, oynatmağa başlanır...");
          this.isPlaying = true;
          this.scheduledTime = this.context.currentTime + this.initialBufferTime;
          this.scheduleNextBuffer();
          this._startAmplitudeAnalysis();
        }
      } else if (this.audioQueue.length === 0) {
          console.log("[AudioStreamer] complete: processingBuffer və audioQueue boşdur. onComplete çağırılır.");
          this.onComplete();
          this.isPlaying = false;
          this._stopAmplitudeAnalysis();
      }
      // Əgər audioQueue boş deyilsə, son source-un onended hadisəsi onComplete-i çağıracaq.
    }
  }
  
  // === AudioStreamer-i Test Etmək Üçün Sadə Kod (Brauzer Konsolunda İşə Salına Bilər) ===
  // Bu hissə sizin əsas tətbiqinizdə AudioStreamer-i necə istifadə edəcəyinizi göstərir.
  // Birbaşa bu fayla daxil etməyə bilərsiniz, ayrı bir test faylında istifadə edin.
  /*
  async function testAudioStreamer() {
    console.log("AudioStreamer testi başladılır...");
  
    // 1. AudioContext yarat
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      console.log("AudioContext suspended. Davam etmək üçün istifadəçi interaksiyası lazımdır.");
      // Adətən bir düyməyə klikləmə ilə audioCtx.resume() çağırılar.
      // Bu test üçün birbaşa resume etməyə çalışaq, brauzer bloklaya bilər.
      await audioCtx.resume().catch(e => console.error("AudioContext resume xətası:", e));
      if (audioCtx.state === 'suspended') {
          console.error("AudioContext hələ də suspended. Test davam edə bilmir.");
          alert("AudioContext başlatıla bilmədi. Səhifə ilə əlaqə qurun (məs. klikləyin) və konsola baxın.");
          return;
      }
    }
    console.log("AudioContext vəziyyəti:", audioCtx.state);
  
  
    // 2. AudioStreamer instansiyası yarat (PCM datanız 16kHz-dirsə, 16000 verin)
    const streamer = new AudioStreamer(audioCtx, 16000); // Buradakı 16000 sizin PCM sample rate-iniz olmalıdır.
  
    // 3. Test üçün PCM16 datası yarat (Uint8Array)
    function generatePCM16Chunk(durationSeconds, sampleRate, peakAmplitude = 0.5) {
      const numSamples = durationSeconds * sampleRate;
      const buffer = new ArrayBuffer(numSamples * 2); // Hər sample 2 bayt
      const dataView = new DataView(buffer);
      for (let i = 0; i < numSamples; i++) {
        // Sadə bir sinus dalğası
        const time = i / sampleRate;
        const value = Math.sin(2 * Math.PI * 440 * time) * peakAmplitude * 32767; // 440Hz A notu
        dataView.setInt16(i * 2, Math.round(value), true); // true = littleEndian
      }
      return new Uint8Array(buffer);
    }
  
    // 4. AudioStreamer-ə datanı hissə-hissə göndər
    // AudioStreamer-in daxili bufferSize (7680 float32 nümunə) üçün
    // 7680 * (16000 / 24000) = 5120 PCM16 nümunəsi (16kHz üçün)
    // və ya 7680 PCM16 nümunəsi (24kHz üçün) lazımdır.
    // Sadəlik üçün, hər chunk 1 saniyəlik data olsun.
    const chunk1 = generatePCM16Chunk(1, streamer.sampleRate, 0.3); // 1 saniyəlik, 30% amplitud
    const chunk2 = generatePCM16Chunk(1, streamer.sampleRate, 0.8); // 1 saniyəlik, 80% amplitud
    const chunk3 = generatePCM16Chunk(0.5, streamer.sampleRate, 0.5); // 0.5 saniyəlik, 50% amplitud
  
    console.log(`Chunk 1 ölçüsü: ${chunk1.byteLength} bayt`);
    console.log(`Chunk 2 ölçüsü: ${chunk2.byteLength} bayt`);
    console.log(`Chunk 3 ölçüsü: ${chunk3.byteLength} bayt`);
  
    // Streamer-i başlatmaq (resume) vacibdir
    await streamer.resume();
    console.log("Streamer.resume() çağırıldı.");
  
    // Chunk-ları göndərmək
    setTimeout(() => {
      console.log("Chunk 1 göndərilir...");
      streamer.addPCM16(chunk1);
    }, 500); // İlk chunk-ı bir az gecikmə ilə göndər
  
    setTimeout(() => {
      console.log("Chunk 2 göndərilir...");
      streamer.addPCM16(chunk2);
    }, 2000); // İkinci chunk
  
    setTimeout(() => {
      console.log("Chunk 3 göndərilir...");
      streamer.addPCM16(chunk3);
      console.log("Bütün chunk-lar göndərildi. Streamer.complete() çağırılır.");
      streamer.complete(); // Axının bitdiyini bildir
    }, 3500); // Üçüncü chunk və tamamlama
  
    // Testi dayandırmaq üçün
    // setTimeout(() => {
    //   console.log("Streamer.stop() çağırılır...");
    //   streamer.stop();
    // }, 5000);
  }
  
  // Test funksiyasını çağırmaq üçün (brauzer konsolunda və ya bir düymə ilə):
  // testAudioStreamer();
  // Və ya bir düymə yaradıb ona kliklədikdə çağırmaq daha yaxşıdır:
  // document.addEventListener('DOMContentLoaded', () => {
  //   const testButton = document.createElement('button');
  //   testButton.textContent = "AudioStreamer Testini Başlat";
  //   testButton.onclick = () => {
  //       testAudioStreamer().catch(console.error);
  //       testButton.disabled = true;
  //   };
  //   document.body.appendChild(testButton);
  // });
  */
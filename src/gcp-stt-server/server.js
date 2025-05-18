require('dotenv-flow').config(); // .env fayllarını yükləmək üçün əlavə edildi

// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const speechClient = new speech.SpeechClient({
    apiKey: process.env.REACT_APP_GEMINI_API_KEY // dotenv-flow ilə yüklənmiş dəyişəndən oxuyur
});

console.log("Node.js WebSocket serveri (avtomatik axın idarəetməsi ilə) başladılır...");

const AUTO_STOP_TIMEOUT_MS = 2000; // 2 saniyə

wss.on('connection', (ws) => {
    console.log('Yeni WebSocket bağlantısı quruldu.');
    let recognizeStream = null;
    let stopStreamTimer = null;

    const requestConfig = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'az-AZ',
        enableWordTimeOffsets: true,
        // model: 'default', 
        // enableAutomaticPunctuation: true,
    };

    const streamingRequest = {
        config: requestConfig,
        interimResults: true,
    };

    function startStream() {
        if (recognizeStream) {
            console.log("Axın artıq aktivdir, yenidən başlamağa ehtiyac yoxdur.");
            return;
        }
        console.log('Audio axını avtomatik olaraq başladılır...');
        recognizeStream = speechClient
            .streamingRecognize(streamingRequest)
            .on('error', (err) => {
                console.error('Google Speech API (streaming) xətası:', err);
                ws.send(JSON.stringify({ type: 'error', message: `Google API Error: ${err.message}` }));
                clearStream(); // Xəta baş verdikdə axını təmizlə
            })
            .on('data', (data) => {
                const transcript = data.results[0] && data.results[0].alternatives[0]
                    ? data.results[0].alternatives[0].transcript
                    : '';
                const isFinal = data.results[0] && data.results[0].isFinal;
                
                let words = [];
                if (data.results[0] && data.results[0].alternatives[0] && data.results[0].alternatives[0].words) {
                    words = data.results[0].alternatives[0].words.map(wordInfo => ({
                        word: wordInfo.word,
                        startTime: `${wordInfo.startTime.seconds || 0}.${(wordInfo.startTime.nanos || 0).toString().padStart(9, '0').slice(0,3)}s`,
                        endTime: `${wordInfo.endTime.seconds || 0}.${(wordInfo.endTime.nanos || 0).toString().padStart(9, '0').slice(0,3)}s`,
                    }));
                }

                ws.send(JSON.stringify({
                    type: 'transcription',
                    transcript: transcript,
                    words: words,
                    isFinal: isFinal,
                }));

                // Əgər nəticə yekundursa və axın hələ də aktivdirsə, avtomatik dayandırma taymerini sıfırla
                // Çünki yekun nəticədən sonra yeni audio gələ bilər (fərqli bir cümlə üçün)
                // Amma əgər klient artıq audio göndərməyi dayandırıbsa, taymer öz işini görəcək.
                if (isFinal && recognizeStream) {
                    resetStopStreamTimer();
                }
            });
        console.log("Google Cloud Speech API-yə yeni streamingRecognize axını başladıldı.");
        resetStopStreamTimer(); // Axın başlayanda taymeri quraşdır
    }

    function stopStream() {
        if (recognizeStream) {
            console.log(`${AUTO_STOP_TIMEOUT_MS}ms ərzində data gəlmədiyi üçün və ya bağlanış siqnalı ilə axın avtomatik dayandırılır.`);
            recognizeStream.end();
            // recognizeStream = null; // .end() hadisəsi bunu idarə edəcək və ya 'finish' eventində ediləcək
        }
    }
    
    function clearStream() {
        if (stopStreamTimer) {
            clearTimeout(stopStreamTimer);
            stopStreamTimer = null;
        }
        if (recognizeStream) {
            // Hər hansı qalıq listener-ləri təmizləmək üçün
            recognizeStream.removeAllListeners();
            // Əgər .end() hələ çağırılmayıbsa (məsələn, error-dan sonra)
            if (!recognizeStream.destroyed) {
                 recognizeStream.end();
            }
            recognizeStream = null;
            console.log("RecognizeStream və taymer təmizləndi.");
        }
    }


    function resetStopStreamTimer() {
        if (stopStreamTimer) {
            clearTimeout(stopStreamTimer);
        }
        stopStreamTimer = setTimeout(() => {
            console.log(`${AUTO_STOP_TIMEOUT_MS}ms ərzində yeni audio data alınmadı.`);
            stopStream();
        }, AUTO_STOP_TIMEOUT_MS);
    }

    ws.on('message', (message) => {
        if (Buffer.isBuffer(message)) {
            // console.log(`Binary audio data (Buffer) alındı. Ölçü: ${message.length} bytes.`);
            if (!recognizeStream) {
                startStream(); // Axın yoxdursa, başlat
            }
            
            if (recognizeStream) {
                recognizeStream.write(message);
                resetStopStreamTimer(); // Audio gəldikcə taymeri sıfırla
            } else {
                // Bu hal çox baş verməməlidir, çünki yuxarıda startStream çağırılır
                console.warn("Audio data alındı, amma recognizeStream aktiv deyil və başlatıla bilmədi.");
            }

        } else if (typeof message === 'string') {
            console.log("String mesaj alındı (emal olunmur):", message);
            // Əvvəlki 'startStream', 'stopStream' tipli mesajları burada idarə edə bilərsiniz
            // Lakin tələbə görə, onlar indi avtomatikdir.
            // Məsələn, klientdən gələn 'stopStream' mesajını hələ də qəbul etmək istəsəniz:
            // try {
            //     const parsedMessage = JSON.parse(message);
            //     if (parsedMessage.type === 'forceStopStream') {
            //         console.log('Klientdən "forceStopStream" siqnalı alındı.');
            //         stopStream();
            //         clearStream(); // Taymeri də ləğv et
            //     }
            // } catch(e) {
            //     console.warn("String mesaj JSON formatında deyil:", message);
            // }
        }
    });

    ws.on('close', () => {
        console.log('WebSocket bağlantısı bağlandı.');
        stopStream(); // Klient bağlandıqda axını dayandır
        clearStream(); // Bütün resursları təmizlə
    });

    ws.on('error', (err) => {
        console.error('WebSocket xətası:', err);
        stopStream(); // Xəta baş verdikdə axını dayandır
        clearStream(); // Bütün resursları təmizlə
    });

    // recognizeStream üçün 'finish' və 'end' hadisələrini də izləyə bilərik
    // Bu, stream-in Google tərəfindən və ya .end() ilə düzgün bağlandığını təsdiqləmək üçündür
    // Ancaq 'error' və 'data' hadisələri ilə birlikdə ws 'close' və 'error' əsas halları əhatə edir.
    // Əgər recognizeStream-i birbaşa idarə ediriksə, onun `finish` event-ini dinləmək yaxşı praktikadır:
    // recognizeStream.on('finish', () => {
    //     console.log("Google Speech API axını 'finish' hadisəsi ilə bitdi.");
    //     clearStream();
    // });
    // Ancaq recognizeStream hər dəfə yenidən yaradıldığı üçün bu event listener-i
    // startStream funksiyası daxilində, stream yaradılandan sonra əlavə etmək daha doğru olar.
    // Redaktə: `startStream` funksiyasına `recognizeStream.on('end', ...)` və `recognizeStream.on('finish', ...)` əlavə edə bilərik.
    // Lakin sadəlik üçün hələlik `clearStream` funksiyası əksər təmizləmə işlərini görür.
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`WebSocket serveri (avtomatik axın) http://localhost:${PORT} ünvanında işləyir.`);
});
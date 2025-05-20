/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { useEffect, useRef, useState, memo } from "react";
import vegaEmbed from "vega-embed";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { ToolCall, ServerContent } from "../../multimodal-live-types";
import VoskComponent, { VoskRef } from '../speech/vosk/VoskComponent';
import SpeechRecognitionComponent, { SpeechRecognitionRef } from '../speech/speech-recognition/SpeechRecognitionComponent';
import SpeechStreamerComponent, { SpeechStreamerRef } from '../speech/speech-streamer/SpeechStreamerComponent';
import GladiaComponent, { GladiaRef } from '../speech/galdi/GladiaComponent';

const declaration: FunctionDeclaration = {
  name: "render_altair",
  description: "Altair qrafikini JSON formatda göstər .",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      json_graph: {
        type: SchemaType.STRING,
        description:
          "JSON STRING representation of the graph to render. Must be a string, not a json object",
      },
    },
    required: ["json_graph"],
  },
};

function AltairComponent() {
  const [jsonString, setJSONString] = useState<string>("");
  const { client, setConfig } = useLiveAPIContext();
  const voskRef = useRef<VoskRef>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionRef>(null);
  const speechStreamerRef = useRef<SpeechStreamerRef>(null);
  const gladiaRef = useRef<GladiaRef>(null);

  useEffect(() => {
    setConfig({
      model: "models/gemini-2.0-flash-live-001",
      generationConfig: {
        responseModalities: "audio",
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: 'Sən Azərbaycan Beynəlxalq Bankının virtual asistentisən. Adın Ayladır.',
          },
        ],
      },
      tools: [
        // there is a free-tier quota for search
        { googleSearch: {} },
        { functionDeclarations: [declaration] },
      ],
    });
  }, [setConfig]);

  useEffect(() => {
    const onToolCall = (toolCall: ToolCall) => {
      console.log(`got toolcall`, toolCall);
      const fc = toolCall.functionCalls.find(
        (fc) => fc.name === declaration.name,
      );
      if (fc) {
        const str = (fc.args as any).json_graph;
        setJSONString(str);
      }
      // send data for the response of your tool call
      // in this case Im just saying it was successful
      if (toolCall.functionCalls.length) {
        setTimeout(
          () =>
            client.sendToolResponse({
              functionResponses: toolCall.functionCalls.map((fc) => ({
                response: { output: { success: true } },
                id: fc.id,
              })),
            }),
          200,
        );
      }
    };
    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client]);

  useEffect(() => {
    const onAudio = (data: ArrayBuffer) => {

      if (speechStreamerRef.current && !speechStreamerRef.current.isConnected()) {
        speechStreamerRef.current.sendAudio(data);
      }

      if (voskRef.current && !voskRef.current.isConnected()) {
        voskRef.current.sendAudio(data);
      }

      if (gladiaRef.current) {
        gladiaRef.current.sendAudio(data);
      }
    };

    const onContent = (content: ServerContent) => {
      console.log("Raw content received:", content);
      
      if ('modelTurn' in content && content.modelTurn.parts) {
        console.log("ModelTurn parts:", content.modelTurn.parts);
        
        content.modelTurn.parts.forEach(part => {
          console.log("Part:", part);
          if ('text' in part && part.text) {
            console.log("Səsləndirilən mətn:", part.text);
            // Bu mətn viseme/lipsync üçün istifadə edilə bilər
          }
        });
      }
      
      // Check for output transcription
      if ('output_transcription' in content) {
        console.log("Transcription:", content.output_transcription.text);
        // Bu transkripsiya viseme/lipsync üçün istifadə edilə bilər
      }
    };

    client.on("audio", onAudio);
    client.on("content", onContent);
    
    return () => {
      client.off("audio", onAudio);
      client.off("content", onContent);
    };
  }, [client]);

  const embedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedRef.current && jsonString) {
      vegaEmbed(embedRef.current, JSON.parse(jsonString));
    }
  }, [embedRef, jsonString]);
  return <> <div className="vega-embed" ref={embedRef} />
  <VoskComponent ref={voskRef} />
  <SpeechRecognitionComponent ref={speechRecognitionRef} />
  <SpeechStreamerComponent ref={speechStreamerRef} />
  <GladiaComponent ref={gladiaRef} showDebugInfo={true} />
  </>;
}

export const Altair = memo(AltairComponent);

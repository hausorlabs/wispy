/**
 * ElevenLabs Integration
 *
 * Voice AI -- text-to-speech, speech-to-text, voice listing, and voice settings.
 *
 * @requires ELEVENLABS_API_KEY - API key from https://elevenlabs.io
 * @see https://docs.elevenlabs.io/api-reference
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL = "eleven_monolingual_v1";

export default class ElevenLabsIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "ai-models",
    version: "1.0.0",
    description: "Voice AI -- text-to-speech, speech-to-text, voice listing and settings via ElevenLabs.",
    auth: {
      type: "api-key",
      envVars: ["ELEVENLABS_API_KEY"],
    },
    tools: [
      {
        name: "elevenlabs_text_to_speech",
        description: "Convert text to speech audio using ElevenLabs. Returns the path to the generated audio file.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "The text to convert to speech." },
            voiceId: { type: "string", description: "ElevenLabs voice ID. Use elevenlabs_list_voices to find available voices." },
            modelId: { type: "string", description: "Model ID (e.g. eleven_monolingual_v1, eleven_multilingual_v2, eleven_turbo_v2_5)." },
            outputDir: { type: "string", description: "Directory to save the audio file. Defaults to runtime voice directory." },
          },
          required: ["text"],
        },
      },
      {
        name: "elevenlabs_list_voices",
        description: "List all available ElevenLabs voices including premade and custom voices.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "elevenlabs_get_voice",
        description: "Get details about a specific ElevenLabs voice.",
        parameters: {
          type: "object",
          properties: {
            voiceId: { type: "string", description: "The voice ID to look up." },
          },
          required: ["voiceId"],
        },
      },
      {
        name: "elevenlabs_voice_settings",
        description: "Update voice settings for a specific voice (stability, similarity boost, style).",
        parameters: {
          type: "object",
          properties: {
            voiceId: { type: "string", description: "The voice ID to update." },
            stability: { type: "number", description: "Stability (0.0 to 1.0). Higher = more consistent." },
            similarityBoost: { type: "number", description: "Similarity boost (0.0 to 1.0). Higher = closer to original voice." },
            style: { type: "number", description: "Style exaggeration (0.0 to 1.0). Higher = more expressive." },
          },
          required: ["voiceId"],
        },
      },
      {
        name: "elevenlabs_speech_to_text",
        description: "Transcribe an audio file to text using ElevenLabs speech-to-text.",
        parameters: {
          type: "object",
          properties: {
            audioPath: { type: "string", description: "Path to the audio file to transcribe." },
            languageCode: { type: "string", description: "Language code (e.g. 'en', 'es', 'fr'). Auto-detected if omitted." },
          },
          required: ["audioPath"],
        },
      },
    ],
    capabilities: {
      streaming: true,
    },
  };

  private getApiKey(): string {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ELEVENLABS_API_KEY not set");
    return key;
  }

  private async apiGet(path: string): Promise<any> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "xi-api-key": this.getApiKey() },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ElevenLabs ${res.status}: ${text}`);
    }
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "elevenlabs_text_to_speech": return await this.textToSpeech(args);
        case "elevenlabs_list_voices": return await this.listVoices();
        case "elevenlabs_get_voice": return await this.getVoice(args);
        case "elevenlabs_voice_settings": return await this.updateVoiceSettings(args);
        case "elevenlabs_speech_to_text": return await this.speechToText(args);
        default: return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`ElevenLabs error: ${(err as Error).message}`);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.apiGet("/voices?limit=1");
      return { healthy: true };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }

  private async textToSpeech(args: Record<string, unknown>): Promise<ToolResult> {
    const text = args.text as string;
    const voiceId = (args.voiceId as string) || DEFAULT_VOICE;
    const modelId = (args.modelId as string) || DEFAULT_MODEL;

    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.getApiKey(),
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`TTS failed ${res.status}: ${errText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const { mkdirSync, writeFileSync, existsSync } = await import("fs");
    const { join } = await import("path");

    const outputDir = (args.outputDir as string) || join(this.ctx.runtimeDir, "voice");
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const outputPath = join(outputDir, `elevenlabs-${Date.now()}.mp3`);
    writeFileSync(outputPath, buffer);

    return this.ok(`Audio generated: ${outputPath}`, {
      audioPath: outputPath,
      voiceId,
      modelId,
      textLength: text.length,
    });
  }

  private async listVoices(): Promise<ToolResult> {
    const data = await this.apiGet("/voices");
    const voices = data.voices || [];

    if (voices.length === 0) {
      return this.ok("No voices found.");
    }

    const list = voices.map((v: any) =>
      `  [${v.voice_id}] ${v.name} (${v.category || "premade"}) - ${v.labels?.accent || ""} ${v.labels?.gender || ""}`
    ).join("\n");

    return this.ok(`Available voices (${voices.length}):\n${list}`, { count: voices.length });
  }

  private async getVoice(args: Record<string, unknown>): Promise<ToolResult> {
    const voiceId = args.voiceId as string;
    const data = await this.apiGet(`/voices/${voiceId}`);

    const labels = data.labels || {};
    const info = [
      `Name: ${data.name}`,
      `ID: ${data.voice_id}`,
      `Category: ${data.category || "unknown"}`,
      `Gender: ${labels.gender || "unknown"}`,
      `Accent: ${labels.accent || "unknown"}`,
      `Age: ${labels.age || "unknown"}`,
      `Description: ${labels.description || data.description || "none"}`,
    ].join("\n");

    return this.ok(info, { voiceId: data.voice_id, name: data.name });
  }

  private async updateVoiceSettings(args: Record<string, unknown>): Promise<ToolResult> {
    const voiceId = args.voiceId as string;
    const settings: Record<string, number> = {};

    if (args.stability !== undefined) settings.stability = args.stability as number;
    if (args.similarityBoost !== undefined) settings.similarity_boost = args.similarityBoost as number;
    if (args.style !== undefined) settings.style = args.style as number;

    const res = await fetch(`${API_BASE}/voices/${voiceId}/settings/edit`, {
      method: "POST",
      headers: {
        "xi-api-key": this.getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Settings update failed ${res.status}: ${errText}`);
    }

    return this.ok(`Voice settings updated for ${voiceId}`, { voiceId, settings });
  }

  private async speechToText(args: Record<string, unknown>): Promise<ToolResult> {
    const audioPath = args.audioPath as string;
    const { readFileSync, existsSync } = await import("fs");
    const { basename } = await import("path");

    if (!existsSync(audioPath)) {
      return this.error(`Audio file not found: ${audioPath}`);
    }

    const audioBuffer = readFileSync(audioPath);
    const fileName = basename(audioPath);

    // Determine MIME type from extension
    const ext = fileName.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      m4a: "audio/mp4",
      webm: "audio/webm",
      flac: "audio/flac",
    };
    const mimeType = mimeTypes[ext || ""] || "audio/mpeg";

    // Build multipart form data manually (Node.js fetch supports FormData)
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append("audio", blob, fileName);
    if (args.languageCode) {
      formData.append("language_code", args.languageCode as string);
    }

    const res = await fetch(`${API_BASE}/speech-to-text`, {
      method: "POST",
      headers: {
        "xi-api-key": this.getApiKey(),
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`STT failed ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const transcript = data.text || data.transcript || "";

    return this.ok(transcript || "(no speech detected)", {
      transcript,
      audioPath,
      language: data.language_code || args.languageCode,
    });
  }
}

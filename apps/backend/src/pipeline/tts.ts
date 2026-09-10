import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/index.js";
import type { TextToSpeechProvider } from "./ttsProvider.js";

/** 20ms of 8kHz, 8-bit mulaw audio = 160 bytes. Twilio Media Streams expects
 * outbound frames in this format/size. */
const FRAME_BYTES = 160;
const MULAW_SILENCE_BYTE = 0xff;

export interface CachedLine {
  /** Exact text this cached file was rendered from - matched verbatim. */
  text: string;
  /** Filename under apps/backend/assets/, pre-rendered by prerender.ts. */
  filename: string;
}

/**
 * ElevenLabs streaming TTS, mulaw 8kHz (matching Twilio's Media Stream
 * format - no local transcoding needed). Uses the raw REST streaming
 * endpoint directly rather than an SDK, to avoid depending on an SDK
 * version's exact method signature for a call this plan can't exercise
 * against a real API key yet - the REST contract is the stable source of
 * truth to build against.
 *
 * Optionally takes a set of `cachedLines` (the fixed opening/apology text)
 * to serve from a pre-rendered file instead of a live API call - this
 * optimization lives here, inside the concrete provider, specifically so
 * the orchestrator never needs to know a given line is "special."
 */
export class ElevenLabsTts implements TextToSpeechProvider {
  constructor(private readonly cachedLines: CachedLine[] = []) {}

  async *synthesize(text: string): AsyncGenerator<Buffer> {
    const cached = this.cachedLines.find((line) => line.text === text);
    if (cached) {
      const path = join(process.cwd(), "assets", cached.filename);
      if (existsSync(path)) {
        yield* this.readCachedFrames(path);
        return;
      }
      console.warn(`[tts] cached audio file missing at ${path} - falling back to a live ElevenLabs request`);
    }
    yield* this.synthesizeLive(text);
  }

  private *readCachedFrames(path: string): Generator<Buffer> {
    const data = readFileSync(path);
    for (let i = 0; i < data.length; i += FRAME_BYTES) {
      yield data.subarray(i, Math.min(i + FRAME_BYTES, data.length));
    }
  }

  private async *synthesizeLive(text: string): AsyncGenerator<Buffer> {
    const config = loadConfig();

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.ELEVENLABS_VOICE_ID}/stream?output_format=ulaw_8000`,
      {
        method: "POST",
        headers: {
          "xi-api-key": config.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/basic",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
        }),
      },
    );

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS request failed: ${response.status} ${response.statusText} ${body}`);
    }

    const reader = response.body.getReader();
    let leftover = Buffer.alloc(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let buf = Buffer.concat([leftover, Buffer.from(value)]);
      while (buf.length >= FRAME_BYTES) {
        yield buf.subarray(0, FRAME_BYTES);
        buf = buf.subarray(FRAME_BYTES);
      }
      leftover = buf;
    }

    if (leftover.length > 0) {
      const padded = Buffer.concat([leftover, Buffer.alloc(FRAME_BYTES - leftover.length, MULAW_SILENCE_BYTE)]);
      yield padded;
    }
  }
}

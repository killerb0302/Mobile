import { loadConfig } from "../../config/index.js";
import type { SpeechToText, UtteranceResult } from "../stt.js";

/**
 * Batch SpeechToText backed by a running whisper.cpp `server` (its bundled
 * HTTP example, expected to already be running and loaded with a model -
 * see the README's local mode setup). Only the batch half of the
 * SpeechToText interface is meaningful here: push-to-talk already knows the
 * utterance boundary (button press/release), so there's no VAD/streaming
 * need at all - one HTTP request per recorded clip.
 *
 * NOTE: assumes whisper.cpp server's default `/inference` multipart
 * endpoint returning `{ text: string }` - verify against the exact running
 * server version at first real test, since this hasn't been exercised
 * against a live instance yet.
 */
export class WhisperStt implements SpeechToText {
  async waitUntilReady(): Promise<void> {
    const config = loadConfig();
    try {
      await fetch(config.WHISPER_SERVER_URL);
    } catch (err) {
      throw new Error(
        `Cannot reach whisper.cpp server at ${config.WHISPER_SERVER_URL} - start it first (see README's local mode setup). Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  feed(): void {
    throw new Error("WhisperStt is a batch provider - use transcribeClip(), not feed()");
  }

  startListening(): void {
    throw new Error("WhisperStt is a batch provider - use transcribeClip(), not startListening()");
  }

  onUtteranceEnd(): void {
    throw new Error("WhisperStt is a batch provider - use transcribeClip(), not onUtteranceEnd()");
  }

  onSpeechStarted(): void {
    throw new Error(
      "WhisperStt has no live speech-detection signal - barge-in for push-to-talk is a transport-level UI event instead",
    );
  }

  async transcribeClip(clip: Buffer): Promise<UtteranceResult> {
    const config = loadConfig();
    const start = Date.now();

    // Blob's BlobPart type wants a plain ArrayBuffer, not Node's
    // ArrayBufferLike (which could be a SharedArrayBuffer) - slice out a
    // fresh, plain copy of exactly this buffer's bytes.
    const arrayBuffer = clip.buffer.slice(clip.byteOffset, clip.byteOffset + clip.byteLength) as ArrayBuffer;
    const form = new FormData();
    form.append("file", new Blob([arrayBuffer], { type: "audio/wav" }), "utterance.wav");
    form.append("response_format", "json");

    const response = await fetch(`${config.WHISPER_SERVER_URL}/inference`, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`whisper.cpp server request failed: ${response.status} ${response.statusText} ${body}`);
    }

    const data = (await response.json()) as { text?: string };
    const transcript = (data.text ?? "").trim();

    return { transcript, sttMs: Date.now() - start };
  }

  close(): void {
    // No persistent connection on our side - the whisper.cpp server
    // process itself is managed outside this app.
  }
}

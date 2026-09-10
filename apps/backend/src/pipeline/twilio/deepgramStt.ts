import { createClient, LiveTranscriptionEvents, type LiveSchema } from "@deepgram/sdk";
import { loadConfig } from "../../config/index.js";
import type { SpeechToText, UtteranceResult } from "../stt.js";

const LIVE_OPTIONS: LiveSchema = {
  model: "nova-2-phonecall",
  encoding: "mulaw",
  sample_rate: 8000,
  channels: 1,
  interim_results: true,
  endpointing: 300,
  utterance_end_ms: 1000,
};

/**
 * Streaming SpeechToText backed by one Deepgram live-transcription
 * connection for the lifetime of a single call. Only the streaming half of
 * the SpeechToText interface is meaningful here - `transcribeClip()` throws,
 * since Twilio's continuous Media Stream never hands us a discrete,
 * pre-bounded clip.
 *
 * NOTE: built against the documented @deepgram/sdk v3 live-transcription
 * event API; verify method/event names against the exact installed SDK
 * version at first real test, since this hasn't been exercised against a
 * live API key yet.
 */
export class DeepgramStt implements SpeechToText {
  private readonly connection: ReturnType<ReturnType<typeof createClient>["listen"]["live"]>;
  private readonly ready: Promise<void>;
  private finalSegments: string[] = [];
  private listenStartedAt: number | null = null;
  private firstTranscriptMs: number | null = null;
  private utteranceEndCb: ((result: UtteranceResult) => void) | null = null;
  private speechStartedCb: (() => void) | null = null;
  private closed = false;

  constructor(onError: (err: Error) => void) {
    const config = loadConfig();
    const deepgram = createClient(config.DEEPGRAM_API_KEY);
    this.connection = deepgram.listen.live(LIVE_OPTIONS);

    let readyResolve!: () => void;
    this.ready = new Promise((resolve) => {
      readyResolve = resolve;
    });

    this.connection.on(LiveTranscriptionEvents.Open, () => readyResolve());

    this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const text: string | undefined = data?.channel?.alternatives?.[0]?.transcript;
      if (text && this.listenStartedAt !== null && this.firstTranscriptMs === null) {
        this.firstTranscriptMs = Date.now() - this.listenStartedAt;
      }
      if (data?.is_final && text) {
        this.finalSegments.push(text);
      }
    });

    this.connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      this.speechStartedCb?.();
    });

    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      const transcript = this.finalSegments.join(" ").trim();
      const sttMs = this.firstTranscriptMs;
      this.finalSegments = [];
      this.firstTranscriptMs = null;
      this.listenStartedAt = null;
      this.utteranceEndCb?.({ transcript, sttMs });
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      this.closed = true;
    });

    this.connection.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      onError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  feed(chunk: Buffer): void {
    if (this.closed) return;
    // The SDK's send() accepts ArrayBufferLike | Blob | string, not a Node
    // Buffer directly - slice out exactly this chunk's bytes as a plain
    // ArrayBuffer (chunk.buffer may be a larger pooled/shared allocation).
    const arrayBuffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    this.connection.send(arrayBuffer);
  }

  startListening(): void {
    this.listenStartedAt = Date.now();
    this.firstTranscriptMs = null;
    this.finalSegments = [];
  }

  onUtteranceEnd(cb: ((result: UtteranceResult) => void) | null): void {
    this.utteranceEndCb = cb;
  }

  onSpeechStarted(cb: (() => void) | null): void {
    this.speechStartedCb = cb;
  }

  transcribeClip(): Promise<UtteranceResult> {
    throw new Error("DeepgramStt is a streaming provider - use feed()/onUtteranceEnd(), not transcribeClip()");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.connection.requestClose();
    } catch {
      // Connection may already be closing/closed - nothing further to do.
    }
  }
}

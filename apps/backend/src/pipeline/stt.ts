import { createClient, LiveTranscriptionEvents, type LiveSchema } from "@deepgram/sdk";
import { loadConfig } from "../config/index.js";
import { PER_TURN_LISTEN_TIMEOUT_MS } from "../call/types.js";

export interface UtteranceResult {
  transcript: string;
  /** Total time from starting to listen to Deepgram signaling UtteranceEnd
   * - dominated by how long the callee actually talked, not STT speed. */
  listenDurationMs: number;
  /** Time from starting to listen to Deepgram's first transcript event with
   * any text - the actual STT-responsiveness metric the plan asks for. Null
   * if no transcript arrived before UtteranceEnd (e.g. only silence). */
  firstTranscriptMs: number | null;
}

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
 * Thin wrapper around one Deepgram live-transcription connection for the
 * lifetime of a single call. NOTE: built against the documented
 * @deepgram/sdk v3 live-transcription event API; verify method/event names
 * against the exact installed SDK version at first real test, since this
 * hasn't been exercised against a live API key yet.
 */
export class LiveTranscriber {
  private readonly connection: ReturnType<ReturnType<typeof createClient>["listen"]["live"]>;
  private readonly ready: Promise<void>;
  private finalSegments: string[] = [];
  private pendingUtterance: {
    resolve: (r: UtteranceResult) => void;
    reject: (e: Error) => void;
    startedAt: number;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  private firstTranscriptMs: number | null = null;
  private onSpeechStarted: (() => void) | null = null;
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
      if (text && this.pendingUtterance && this.firstTranscriptMs === null) {
        this.firstTranscriptMs = Date.now() - this.pendingUtterance.startedAt;
      }
      if (data?.is_final && text) {
        this.finalSegments.push(text);
      }
    });

    this.connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      this.onSpeechStarted?.();
    });

    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      if (!this.pendingUtterance) return;
      const { resolve, timeout, startedAt } = this.pendingUtterance;
      clearTimeout(timeout);
      const transcript = this.finalSegments.join(" ").trim();
      const firstTranscriptMs = this.firstTranscriptMs;
      this.finalSegments = [];
      this.firstTranscriptMs = null;
      this.pendingUtterance = null;
      resolve({ transcript, listenDurationMs: Date.now() - startedAt, firstTranscriptMs });
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

  /**
   * Registers a one-shot-style callback fired every time Deepgram detects
   * the callee starting to speak. The orchestrator arms this only while the
   * agent is in SPEAKING state, to detect barge-in; pass `null` to disarm.
   */
  armBargeInDetector(cb: (() => void) | null): void {
    this.onSpeechStarted = cb;
  }

  /**
   * Resolves with the callee's next full utterance once Deepgram signals
   * UtteranceEnd. Rejects after PER_TURN_LISTEN_TIMEOUT_MS if the callee
   * never finishes speaking (or never speaks at all), so a silent line
   * can't hang the call indefinitely.
   */
  waitForUtterance(): Promise<UtteranceResult> {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingUtterance = null;
        this.firstTranscriptMs = null;
        reject(new Error("Timed out waiting for callee to speak"));
      }, PER_TURN_LISTEN_TIMEOUT_MS);
      this.pendingUtterance = { resolve, reject, startedAt, timeout };
    });
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

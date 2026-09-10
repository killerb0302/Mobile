export interface UtteranceResult {
  transcript: string;
  /** Time-to-first-transcript from whenever this provider considers
   * "listening" to have started - the STT-responsiveness metric. Null when
   * not meaningful (e.g. a batch provider transcribing one clip in a single
   * shot has no partial/interim signal to time against). */
  sttMs: number | null;
}

/**
 * Turns audio into text - nothing about transport. Two capabilities live on
 * one interface so both a streaming provider (Deepgram, driven by a
 * continuous-stream transport) and a batch provider (whisper.cpp, driven by
 * a push-to-talk transport) can satisfy it; a given implementation only
 * needs to meaningfully implement the half it actually uses, and must throw
 * a clear error from the other half rather than silently no-op (a silent
 * no-op would mask an accidental mismatched transport/STT pairing).
 *
 * The CallOrchestrator never references a concrete STT implementation -
 * only ConversationTransport does, internally.
 */
export interface SpeechToText {
  /** Optional readiness wait (e.g. a websocket connection opening). */
  waitUntilReady?(): Promise<void>;

  // --- Streaming capability ---

  /** Feeds one chunk of continuously-arriving audio. */
  feed(chunk: Buffer): void;

  /** Marks that the caller is now expecting the next utterance - starts the
   * sttMs timer and resets accumulated state for streaming providers. */
  startListening(): void;

  /** Fires once when this provider's own endpoint/VAD detection decides the
   * current utterance is complete. Pass `null` to disarm. */
  onUtteranceEnd(cb: ((result: UtteranceResult) => void) | null): void;

  /** Fires whenever this provider detects the other party starting to
   * speak - used for barge-in detection while the agent is talking. Pass
   * `null` to disarm. */
  onSpeechStarted(cb: (() => void) | null): void;

  // --- Batch capability ---

  /** Transcribes one complete, already-bounded clip in a single call - used
   * by push-to-talk transports that already know the utterance boundary
   * themselves and don't need streaming/VAD at all. */
  transcribeClip(clip: Buffer): Promise<UtteranceResult>;

  close(): void;
}

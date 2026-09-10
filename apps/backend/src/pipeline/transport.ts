/**
 * Owns audio in/out and however a turn boundary and barge-in are physically
 * detected for a given medium (continuous stream + VAD-driven STT events for
 * a phone call, or a discrete push-to-talk clip for a browser tab). A
 * transport is constructed with a `SpeechToText` instance and delegates to
 * it internally - this is what keeps transport and STT decoupled while
 * still letting a streaming transport drive a streaming STT's feed/event
 * cycle, and a push-to-talk transport drive a batch STT's one-shot
 * transcription.
 *
 * The CallOrchestrator must never construct or reference a concrete
 * transport type directly - only this interface.
 */
export interface ConversationTransport {
  /** Optional one-time readiness wait (e.g. a streaming STT's socket has to
   * open before audio can be fed to it). Called once by the orchestrator
   * before the opening line plays. */
  waitUntilReady?(): Promise<void>;

  /** Waits for and returns one full utterance from the other party. */
  waitForUtterance(): Promise<{ transcript: string; sttMs: number | null }>;

  /**
   * Streams TTS audio frames out. If `interruptible`, stops early and
   * resolves with `interrupted: true` the moment the transport detects the
   * other party talking over the agent (however that's detected for this
   * medium) - it must not wait for the frames to finish first.
   */
  playAudio(frames: AsyncIterable<Buffer>, opts: { interruptible: boolean }): Promise<{ interrupted: boolean }>;

  /**
   * The MECHANISM of ending the call (Twilio REST hangup + WS close, or
   * just a WS close for a local browser tab) - never the DECISION of
   * whether to end, which belongs solely to the orchestrator.
   */
  endCall(reason: string): Promise<void> | void;

  /** Releases resources without necessarily "hanging up" anything (used on
   * an already-ended call to make sure sockets/connections are closed). */
  close(): void;
}

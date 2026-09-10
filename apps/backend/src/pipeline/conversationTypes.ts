/**
 * Provider-agnostic conversation types shared by the orchestrator and every
 * concrete provider (Twilio/Deepgram/Claude/ElevenLabs, or browser/whisper.cpp/
 * Ollama/Piper). Nothing in this file may reference a specific vendor.
 */

export enum CallState {
  /** Disclosure (paid/Twilio mode) or a friendly greeting (local mode). */
  OPENING = "OPENING",
  LISTENING = "LISTENING",
  THINKING = "THINKING",
  SPEAKING = "SPEAKING",
  HANGUP = "HANGUP",
  ERROR = "ERROR",
}

export type Speaker = "agent" | "callee";

export interface TranscriptEntry {
  speaker: Speaker;
  text: string;
  ts: number;
  /**
   * True for fixed lines (the opening line, the apology fallback) that are
   * logged as part of the transcript but must NOT be fed into the LLM's
   * conversation history - the Anthropic API requires the first message to
   * have role "user", and these lines aren't part of the dialogue anyway.
   */
  excludeFromLlmHistory?: boolean;
}

export interface TurnLatency {
  turn: number;
  /** Time-to-first-transcript (STT responsiveness), not how long the callee
   * talked for. Null when not meaningful for the active STT provider. */
  sttMs: number | null;
  /** Duration of the LLM call for this turn. */
  llmMs: number | null;
  /** Time from starting the TTS request to its first audio byte. */
  ttsMs: number | null;
  /** The critical metric: end of callee speech to the first agent audio
   * frame actually sent - what determines whether the pause feels natural. */
  totalMs: number | null;
}

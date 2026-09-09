export enum CallState {
  DISCLOSURE = "DISCLOSURE",
  LISTENING = "LISTENING",
  TRANSCRIBING = "TRANSCRIBING",
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
   * True for fixed/compliance lines (the disclosure, the apology fallback)
   * that are logged as part of the call transcript but must NOT be fed into
   * the Claude conversation history - the Anthropic API requires the first
   * message to have role "user", and these lines aren't part of the
   * negotiation dialogue anyway.
   */
  excludeFromLlmHistory?: boolean;
}

export interface TurnLatency {
  turn: number;
  /** Time from starting to listen to Deepgram's first transcript event
   * (STT responsiveness) - not how long the callee talked for. */
  sttMs: number | null;
  /** Duration of the Claude API call for this turn. */
  llmMs: number | null;
  /** Time from starting the ElevenLabs TTS request to its first audio byte. */
  ttsMs: number | null;
  /** End of callee speech (UtteranceEnd) to the first agent audio frame
   * actually sent back - the number that determines whether the pause
   * feels natural on a real call. */
  totalMs: number | null;
}

export const MAX_TURNS = 3;
export const OVERALL_CALL_TIMEOUT_MS = 3 * 60 * 1000;
export const PER_TURN_LISTEN_TIMEOUT_MS = 15 * 1000;

/**
 * Per-call in-memory state. One instance lives for the lifetime of a single
 * phone call; nothing here is persisted (Phase 0-1 has no database).
 */
export interface CallSession {
  callSid: string;
  streamSid: string | null;
  state: CallState;
  turnCount: number;
  transcript: TranscriptEntry[];
  latencies: TurnLatency[];
  objective: string;
  callStartedAt: number;
  overallTimeoutHandle: ReturnType<typeof setTimeout> | null;
  /** Set while the agent is speaking; used to detect and act on barge-in. */
  isSpeaking: boolean;
  ended: boolean;
}

export function createCallSession(callSid: string, objective: string): CallSession {
  return {
    callSid,
    streamSid: null,
    state: CallState.DISCLOSURE,
    turnCount: 0,
    transcript: [],
    latencies: [],
    objective,
    callStartedAt: Date.now(),
    overallTimeoutHandle: null,
    isSpeaking: false,
    ended: false,
  };
}

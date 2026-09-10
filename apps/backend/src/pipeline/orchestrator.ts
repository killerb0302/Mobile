import type { ConversationTransport } from "./transport.js";
import type { LanguageModel } from "./llmProvider.js";
import type { TextToSpeechProvider } from "./ttsProvider.js";
import { CallState, type Speaker, type TranscriptEntry, type TurnLatency } from "./conversationTypes.js";
import { logCallSummary } from "./logging.js";

export interface CallOrchestratorOptions {
  /** callSid for Twilio mode, a generated session id for local mode - used
   * only for logging/log-file naming, never branched on. */
  id: string;
  objective: string;
  /** Disclosure text (paid mode) or a friendly greeting (local mode). */
  openingLine: string;
  /** Spoken once if any provider call fails unrecoverably mid-conversation. */
  apologyLine: string;
  maxTurns: number;
  overallTimeoutMs: number;
}

/**
 * Provider-agnostic conversation engine. Depends ONLY on the four
 * capability interfaces (ConversationTransport/LanguageModel/
 * TextToSpeechProvider - SpeechToText is encapsulated inside whichever
 * transport is active) - it must never import or branch on a concrete
 * vendor (no `if Twilio`, `if Deepgram`, `if Ollama`, `if Claude`,
 * `if Piper` anywhere in this file). Mode selection happens once, in the
 * wiring layer (server.ts and friends), which constructs the concrete
 * providers and injects them here.
 *
 * Owns the turn cap, the overall session timeout, and the decision to hang
 * up - transports only expose the *mechanism* (`endCall()`).
 */
export class CallOrchestrator {
  private state: CallState = CallState.OPENING;
  private turnCount = 0;
  private readonly transcript: TranscriptEntry[] = [];
  private readonly latencies: TurnLatency[] = [];
  private readonly startedAt = Date.now();
  private finished = false;
  private overallTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly transport: ConversationTransport,
    private readonly llm: LanguageModel,
    private readonly tts: TextToSpeechProvider,
    private readonly options: CallOrchestratorOptions,
  ) {}

  async run(): Promise<void> {
    this.overallTimeoutHandle = setTimeout(() => {
      this.end("overall session timeout exceeded");
    }, this.options.overallTimeoutMs);

    try {
      await this.transport.waitUntilReady?.();

      this.state = CallState.OPENING;
      this.pushTranscript("agent", this.options.openingLine, true);
      await this.transport.playAudio(this.tts.synthesize(this.options.openingLine), { interruptible: false });

      while (this.turnCount < this.options.maxTurns && !this.finished) {
        await this.runTurn();
      }

      if (!this.finished) {
        this.end(this.turnCount >= this.options.maxTurns ? "reached max turn cap" : "conversation loop ended");
      }
    } catch (err) {
      await this.handleFatalError("orchestrator", err);
    }
  }

  private pushTranscript(speaker: Speaker, text: string, excludeFromLlmHistory = false): void {
    this.transcript.push({ speaker, text, ts: Date.now(), excludeFromLlmHistory });
  }

  private async runTurn(): Promise<void> {
    const turnNumber = this.turnCount + 1;
    const latency: TurnLatency = { turn: turnNumber, sttMs: null, llmMs: null, ttsMs: null, totalMs: null };

    this.state = CallState.LISTENING;
    let utterance: { transcript: string; sttMs: number | null };
    try {
      utterance = await this.transport.waitForUtterance();
    } catch (err) {
      console.warn(`[orchestrator ${this.options.id}] turn ${turnNumber}: ${err instanceof Error ? err.message : err}`);
      this.end("no response from the other party");
      return;
    }
    const turnStart = Date.now();
    latency.sttMs = utterance.sttMs;
    this.pushTranscript("callee", utterance.transcript);

    this.state = CallState.THINKING;
    let reply: string;
    try {
      const llmResult = await this.llm.getNextReply(this.options.objective, this.transcript);
      latency.llmMs = llmResult.llmMs;
      reply = llmResult.reply;
    } catch (err) {
      await this.handleFatalError("llm", err);
      return;
    }
    this.pushTranscript("agent", reply);

    this.state = CallState.SPEAKING;
    let interrupted: boolean;
    try {
      const timing = { ttsMs: null as number | null, totalMs: null as number | null };
      const result = await this.transport.playAudio(this.timedSynthesis(reply, turnStart, timing), {
        interruptible: true,
      });
      interrupted = result.interrupted;
      latency.ttsMs = timing.ttsMs;
      latency.totalMs = timing.totalMs;
    } catch (err) {
      await this.handleFatalError("tts", err);
      return;
    }

    this.turnCount = turnNumber;
    this.latencies.push(latency);
    console.log(`[orchestrator ${this.options.id}] turn ${turnNumber} latency (ms):`, latency);

    if (interrupted) {
      console.log(`[orchestrator ${this.options.id}] turn ${turnNumber}: barge-in detected, returning to LISTENING`);
    }
  }

  /**
   * Wraps tts.synthesize() to measure time-to-first-audio-byte (relative to
   * the TTS request itself) and the critical end-to-end metric - end of
   * callee speech (`turnStart`) to first agent audio byte - at the same
   * measurement point, to avoid drift from summing separate estimates.
   */
  private async *timedSynthesis(
    text: string,
    turnStart: number,
    out: { ttsMs: number | null; totalMs: number | null },
  ): AsyncGenerator<Buffer> {
    const ttsRequestStart = Date.now();
    let first = true;
    for await (const frame of this.tts.synthesize(text)) {
      if (first) {
        const now = Date.now();
        out.ttsMs = now - ttsRequestStart;
        out.totalMs = now - turnStart;
        first = false;
      }
      yield frame;
    }
  }

  private async handleFatalError(stage: string, err: unknown): Promise<void> {
    if (this.finished) return;
    console.error(`[orchestrator ${this.options.id}] fatal error in ${stage}, ending call:`, err);
    try {
      await this.transport.playAudio(this.tts.synthesize(this.options.apologyLine), { interruptible: false });
    } catch (apologyErr) {
      console.error(`[orchestrator ${this.options.id}] apology fallback also failed:`, apologyErr);
    }
    this.end(`error in ${stage}: ${err instanceof Error ? err.message : String(err)}`);
  }

  private end(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    if (this.overallTimeoutHandle) {
      clearTimeout(this.overallTimeoutHandle);
      this.overallTimeoutHandle = null;
    }
    this.state = CallState.HANGUP;
    logCallSummary(
      {
        id: this.options.id,
        objective: this.options.objective,
        startedAt: this.startedAt,
        transcript: this.transcript,
        latencies: this.latencies,
        turnCount: this.turnCount,
      },
      reason,
    );
    void this.transport.endCall(reason);
  }
}

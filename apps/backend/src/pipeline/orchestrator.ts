import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MediaStreamConnection } from "../media-stream/connection.js";
import { deleteSession } from "../call/sessionStore.js";
import { hangupCall } from "../call/twilioClient.js";
import { logCallSummary } from "../call/logging.js";
import { CallState, MAX_TURNS, type CallSession, type Speaker, type TurnLatency } from "../call/types.js";
import { LiveTranscriber } from "./stt.js";
import { getNextReply } from "./llm.js";
import { synthesizeSpeech } from "./tts.js";
import { disclosureLine, APOLOGY_LINE, DISCLOSURE_AUDIO_FILENAME, APOLOGY_AUDIO_FILENAME } from "./fixedLines.js";

const FRAME_BYTES = 160;
const MARK_TIMEOUT_MS = 10_000;

function chunkFile(filename: string): Buffer[] {
  const data = readFileSync(join(process.cwd(), "assets", filename));
  const frames: Buffer[] = [];
  for (let i = 0; i < data.length; i += FRAME_BYTES) {
    frames.push(data.subarray(i, Math.min(i + FRAME_BYTES, data.length)));
  }
  return frames;
}

/**
 * Drives one call's entire conversational state machine (DISCLOSURE ->
 * LISTENING -> TRANSCRIBING -> THINKING -> SPEAKING -> ... -> HANGUP) for
 * up to MAX_TURNS turns, wiring together Deepgram STT, Claude, and
 * ElevenLabs TTS over the Media Stream WebSocket. This is the Phase 0-1
 * proof: sustaining a real two-turn back-and-forth with basic barge-in
 * handling, a hard turn/time cap, per-turn latency instrumentation, and a
 * fixed-line fallback if any external dependency fails mid-call.
 */
export async function runCallOrchestration(session: CallSession, mediaConn: MediaStreamConnection): Promise<void> {
  const pendingMarks = new Map<string, () => void>();
  mediaConn.onMark((name) => {
    pendingMarks.get(name)?.();
    pendingMarks.delete(name);
  });

  function waitForMark(name: string): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingMarks.delete(name);
        console.warn(`[call ${session.callSid}] timed out waiting for playback mark "${name}"`);
        resolve();
      }, MARK_TIMEOUT_MS);
      pendingMarks.set(name, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  let markCounter = 0;
  const transcriber = new LiveTranscriber((err) => void handleFatalError("stt", err));
  mediaConn.onInboundAudio((chunk) => transcriber.feed(chunk));

  let finished = false;

  function pushTranscript(speaker: Speaker, text: string, excludeFromLlmHistory = false): void {
    session.transcript.push({ speaker, text, ts: Date.now(), excludeFromLlmHistory });
  }

  /**
   * Streams frames to Twilio, optionally arming barge-in detection. On
   * barge-in we stop sending remaining frames and flush Twilio's playback
   * buffer immediately, skipping the mark-wait entirely, per the plan's
   * "stop talking over the callee, don't try to finish the thought" scope.
   */
  async function playFrames(
    frames: AsyncIterable<Buffer> | Iterable<Buffer>,
    { interruptible }: { interruptible: boolean },
  ): Promise<{ interrupted: boolean }> {
    const state = { interrupted: false };
    if (interruptible) {
      transcriber.armBargeInDetector(() => {
        if (!state.interrupted) {
          state.interrupted = true;
          mediaConn.sendClear();
        }
      });
    }
    try {
      for await (const frame of frames) {
        if (state.interrupted) break;
        mediaConn.sendAudioFrame(frame);
      }
    } finally {
      if (interruptible) transcriber.armBargeInDetector(null);
    }
    if (!state.interrupted) {
      const markName = `mark-${++markCounter}`;
      mediaConn.sendMark(markName);
      await waitForMark(markName);
    }
    return state;
  }

  async function playPrerendered(filename: string): Promise<void> {
    await playFrames(chunkFile(filename), { interruptible: false });
  }

  /**
   * Runs one ElevenLabs TTS request and streams it out, measuring
   * time-to-first-audio-byte (relative to the TTS request itself) and
   * total-turn-latency (relative to `turnStart`, i.e. end of callee
   * speech) at the same measurement point for accuracy.
   */
  async function speakAndWait(
    text: string,
    turnStart: number,
    opts: { interruptible: boolean },
  ): Promise<{ interrupted: boolean; ttsMs: number; totalMs: number }> {
    const ttsRequestStart = Date.now();
    let ttsMs = -1;
    let totalMs = -1;

    async function* timed(): AsyncGenerator<Buffer> {
      let first = true;
      for await (const frame of synthesizeSpeech(text)) {
        if (first) {
          const now = Date.now();
          ttsMs = now - ttsRequestStart;
          totalMs = now - turnStart;
          first = false;
        }
        yield frame;
      }
    }

    const { interrupted } = await playFrames(timed(), opts);
    return { interrupted, ttsMs, totalMs };
  }

  function endCall(reason: string): void {
    if (finished) return;
    finished = true;
    transcriber.close();
    if (session.overallTimeoutHandle) {
      clearTimeout(session.overallTimeoutHandle);
      session.overallTimeoutHandle = null;
    }
    session.ended = true;
    logCallSummary(session, reason);
    deleteSession(session.callSid);
    void hangupCall(session.callSid);
    mediaConn.close();
  }

  async function handleFatalError(stage: string, err: unknown): Promise<void> {
    if (finished) return;
    console.error(`[call ${session.callSid}] fatal error in ${stage}, ending call:`, err);
    try {
      if (stage === "tts") {
        // TTS itself is broken - fall back to the pre-rendered static clip
        // since we can't synthesize a dynamic apology either.
        await playPrerendered(APOLOGY_AUDIO_FILENAME);
      } else {
        const { interrupted } = await speakAndWait(APOLOGY_LINE, Date.now(), { interruptible: false });
        void interrupted;
      }
    } catch (apologyErr) {
      console.error(`[call ${session.callSid}] apology fallback also failed:`, apologyErr);
    }
    endCall(`error in ${stage}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await transcriber.waitUntilReady();

    session.state = CallState.DISCLOSURE;
    pushTranscript("agent", disclosureLine(), true);
    await playPrerendered(DISCLOSURE_AUDIO_FILENAME);

    while (session.turnCount < MAX_TURNS && !finished) {
      const turnNumber = session.turnCount + 1;
      const latency: TurnLatency = { turn: turnNumber, sttMs: null, llmMs: null, ttsMs: null, totalMs: null };

      session.state = CallState.LISTENING;
      let utterance;
      try {
        utterance = await transcriber.waitForUtterance();
      } catch (err) {
        console.warn(`[call ${session.callSid}] turn ${turnNumber}: ${err instanceof Error ? err.message : err}`);
        break;
      }
      const turnStart = Date.now();
      latency.sttMs = utterance.firstTranscriptMs;
      pushTranscript("callee", utterance.transcript);

      session.state = CallState.TRANSCRIBING;

      session.state = CallState.THINKING;
      let llmResult;
      try {
        llmResult = await getNextReply(session.objective, session.transcript);
      } catch (err) {
        await handleFatalError("llm", err);
        return;
      }
      latency.llmMs = llmResult.llmMs;
      pushTranscript("agent", llmResult.reply);

      session.state = CallState.SPEAKING;
      session.isSpeaking = true;
      let speakResult;
      try {
        speakResult = await speakAndWait(llmResult.reply, turnStart, { interruptible: true });
      } catch (err) {
        await handleFatalError("tts", err);
        return;
      }
      session.isSpeaking = false;
      latency.ttsMs = speakResult.ttsMs;
      latency.totalMs = speakResult.totalMs;

      session.turnCount = turnNumber;
      session.latencies.push(latency);
      console.log(`[call ${session.callSid}] turn ${turnNumber} latency (ms):`, latency);

      if (speakResult.interrupted) {
        console.log(`[call ${session.callSid}] turn ${turnNumber}: barge-in detected, returning to LISTENING`);
      }
    }

    session.state = CallState.HANGUP;
    endCall(session.turnCount >= MAX_TURNS ? "reached max turn cap" : "conversation loop ended");
  } catch (err) {
    await handleFatalError("orchestrator", err);
  }
}

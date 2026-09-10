import type { MediaStreamConnection } from "../../media-stream/connection.js";
import { hangupCall } from "../../call/twilioClient.js";
import type { ConversationTransport } from "../transport.js";
import type { SpeechToText } from "../stt.js";

const MARK_TIMEOUT_MS = 10_000;
const PER_TURN_LISTEN_TIMEOUT_MS = 15_000;

/**
 * ConversationTransport for a real Twilio call: audio flows continuously
 * over the Media Stream WebSocket, and turn boundaries/barge-in are
 * detected via the injected streaming SpeechToText's own VAD (Deepgram's
 * SpeechStarted/UtteranceEnd events). This class knows nothing about
 * Claude, ElevenLabs, or the CallOrchestrator - only Twilio's media stream
 * protocol and the SpeechToText interface.
 */
export class TwilioConversationTransport implements ConversationTransport {
  private readonly pendingMarks = new Map<string, () => void>();
  private markCounter = 0;

  constructor(
    private readonly mediaConn: MediaStreamConnection,
    private readonly stt: SpeechToText,
    private readonly callSid: string,
  ) {
    this.mediaConn.onInboundAudio((chunk) => this.stt.feed(chunk));
    this.mediaConn.onMark((name) => {
      this.pendingMarks.get(name)?.();
      this.pendingMarks.delete(name);
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.stt.waitUntilReady?.();
  }

  private waitForMark(name: string): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingMarks.delete(name);
        console.warn(`[twilio-transport ${this.callSid}] timed out waiting for playback mark "${name}"`);
        resolve();
      }, MARK_TIMEOUT_MS);
      this.pendingMarks.set(name, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  waitForUtterance(): Promise<{ transcript: string; sttMs: number | null }> {
    this.stt.startListening();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stt.onUtteranceEnd(null);
        reject(new Error("Timed out waiting for callee to speak"));
      }, PER_TURN_LISTEN_TIMEOUT_MS);
      this.stt.onUtteranceEnd((result) => {
        clearTimeout(timeout);
        this.stt.onUtteranceEnd(null);
        resolve({ transcript: result.transcript, sttMs: result.sttMs });
      });
    });
  }

  /**
   * Streams frames to Twilio, optionally arming barge-in detection via the
   * STT's SpeechStarted event. On barge-in we stop sending remaining frames
   * and flush Twilio's playback buffer immediately (Twilio's `clear`
   * message), skipping the mark-wait entirely - we don't try to finish the
   * agent's thought, we just stop talking over the callee.
   */
  async playAudio(
    frames: AsyncIterable<Buffer>,
    { interruptible }: { interruptible: boolean },
  ): Promise<{ interrupted: boolean }> {
    const state = { interrupted: false };
    if (interruptible) {
      this.stt.onSpeechStarted(() => {
        if (!state.interrupted) {
          state.interrupted = true;
          this.mediaConn.sendClear();
        }
      });
    }
    try {
      for await (const frame of frames) {
        if (state.interrupted) break;
        this.mediaConn.sendAudioFrame(frame);
      }
    } finally {
      if (interruptible) this.stt.onSpeechStarted(null);
    }
    if (!state.interrupted) {
      const markName = `mark-${++this.markCounter}`;
      this.mediaConn.sendMark(markName);
      await this.waitForMark(markName);
    }
    return state;
  }

  async endCall(reason: string): Promise<void> {
    console.log(`[twilio-transport ${this.callSid}] ending call: ${reason}`);
    this.stt.close();
    await hangupCall(this.callSid);
    this.mediaConn.close();
  }

  close(): void {
    this.stt.close();
    this.mediaConn.close();
  }
}

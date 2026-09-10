import type { WebSocket } from "ws";
import type { ConversationTransport } from "../transport.js";
import type { SpeechToText } from "../stt.js";

interface StartMessage {
  type: "start";
}
interface UtteranceMessage {
  type: "utterance";
  /** base64-encoded WAV clip recorded while the talk button was held. */
  audio: string;
}
interface InterruptMessage {
  type: "interrupt";
}

type InboundMessage = StartMessage | UtteranceMessage | InterruptMessage;

/**
 * ConversationTransport for the local push-to-talk browser demo. Unlike the
 * Twilio transport, there's no continuous audio stream and no server-side
 * VAD: the browser tells us exactly when an utterance begins and ends (button
 * press/release), and barge-in is just another explicit message the browser
 * sends when the talk button is pressed again while the agent is still
 * speaking. No ack-based turn synchronization is needed either - the next
 * turn is entirely user-initiated (they press the button when they're
 * ready), so `playAudio()` doesn't need to wait for the browser to finish
 * actually playing what it was sent.
 */
export class LocalConversationTransport implements ConversationTransport {
  private pendingUtterance: {
    resolve: (audio: Buffer) => void;
    reject: (err: Error) => void;
  } | null = null;
  private onInterrupt: (() => void) | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly stt: SpeechToText,
    private readonly sessionId: string,
  ) {
    this.ws.on("message", (raw: Buffer) => this.handleMessage(raw));
  }

  async waitUntilReady(): Promise<void> {
    await this.stt.waitUntilReady?.();
  }

  private handleMessage(raw: Buffer): void {
    let msg: InboundMessage;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      console.error(`[local-transport ${this.sessionId}] failed to parse inbound message:`, err);
      return;
    }

    switch (msg.type) {
      case "utterance":
        if (this.pendingUtterance) {
          this.pendingUtterance.resolve(Buffer.from(msg.audio, "base64"));
          this.pendingUtterance = null;
        }
        break;
      case "interrupt":
        this.onInterrupt?.();
        break;
      case "start":
        break;
    }
  }

  private waitForClip(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.pendingUtterance = { resolve, reject };
    });
  }

  async waitForUtterance(): Promise<{ transcript: string; sttMs: number | null }> {
    const clip = await this.waitForClip();
    const result = await this.stt.transcribeClip(clip);
    // A UI nicety specific to this transport (not part of the
    // ConversationTransport contract) - shows what Whisper heard in the
    // browser. There's no equivalent for the agent's own reply text here,
    // since playAudio() only ever receives already-synthesized frames.
    this.send({ type: "transcript", speaker: "callee", text: result.transcript });
    return result;
  }

  async playAudio(
    frames: AsyncIterable<Buffer>,
    { interruptible }: { interruptible: boolean },
  ): Promise<{ interrupted: boolean }> {
    const state = { interrupted: false };
    if (interruptible) {
      this.onInterrupt = () => {
        if (!state.interrupted) {
          state.interrupted = true;
          this.send({ type: "audio-stop" });
        }
      };
    }
    this.send({ type: "audio-start" });
    for await (const frame of frames) {
      if (state.interrupted) break;
      this.send({ type: "audio", audio: frame.toString("base64") });
    }
    if (interruptible) this.onInterrupt = null;
    if (!state.interrupted) {
      this.send({ type: "audio-end" });
    }
    return state;
  }

  async endCall(reason: string): Promise<void> {
    this.send({ type: "ended", reason });
    this.stt.close();
    this.ws.close();
  }

  close(): void {
    this.stt.close();
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }
  }

  private send(payload: unknown): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

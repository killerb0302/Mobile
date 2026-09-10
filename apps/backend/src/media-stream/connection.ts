import type { WebSocket } from "ws";

interface TwilioStartMessage {
  event: "start";
  start: { streamSid: string; callSid: string };
}
interface TwilioMediaMessage {
  event: "media";
  media: { payload: string };
}
interface TwilioMarkMessage {
  event: "mark";
  mark: { name: string };
}
interface TwilioStopMessage {
  event: "stop";
}
interface TwilioConnectedMessage {
  event: "connected";
}

type TwilioInboundMessage =
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioMarkMessage
  | TwilioStopMessage
  | TwilioConnectedMessage;

/**
 * Wraps one Twilio Media Streams WebSocket connection, translating between
 * Twilio's JSON-envelope protocol (see
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages) and
 * plain Buffer-in/Buffer-out for the orchestrator. Verify the exact message
 * shapes against Twilio's current docs at first real test - this is built
 * from the documented protocol but hasn't been exercised against a live
 * call yet.
 */
export class MediaStreamConnection {
  public streamSid: string | null = null;
  public callSid: string | null = null;

  private onStartCb: ((callSid: string, streamSid: string) => void) | null = null;
  private onMediaCb: ((chunk: Buffer) => void) | null = null;
  private onMarkCb: ((name: string) => void) | null = null;
  private onStopCb: (() => void) | null = null;

  constructor(private readonly ws: WebSocket) {
    this.ws.on("message", (raw: Buffer) => this.handleMessage(raw));
    this.ws.on("close", () => this.onStopCb?.());
    this.ws.on("error", (err: Error) => {
      console.error("[media-stream] websocket error:", err);
    });
  }

  private handleMessage(raw: Buffer): void {
    let msg: TwilioInboundMessage;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      console.error("[media-stream] failed to parse inbound message:", err);
      return;
    }

    switch (msg.event) {
      case "start":
        this.streamSid = msg.start.streamSid;
        this.callSid = msg.start.callSid;
        this.onStartCb?.(msg.start.callSid, msg.start.streamSid);
        break;
      case "media":
        this.onMediaCb?.(Buffer.from(msg.media.payload, "base64"));
        break;
      case "mark":
        this.onMarkCb?.(msg.mark.name);
        break;
      case "stop":
        this.onStopCb?.();
        break;
      case "connected":
        break;
    }
  }

  onStart(cb: (callSid: string, streamSid: string) => void): void {
    this.onStartCb = cb;
  }

  onInboundAudio(cb: (chunk: Buffer) => void): void {
    this.onMediaCb = cb;
  }

  onMark(cb: (name: string) => void): void {
    this.onMarkCb = cb;
  }

  onStop(cb: () => void): void {
    this.onStopCb = cb;
  }

  sendAudioFrame(frame: Buffer): void {
    if (!this.streamSid || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(
      JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: { payload: frame.toString("base64") },
      }),
    );
  }

  sendMark(name: string): void {
    if (!this.streamSid || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }

  /** Flushes any audio Twilio has buffered but not yet played - used to cut
   * the agent off immediately on barge-in. */
  sendClear(): void {
    if (!this.streamSid || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
  }

  close(): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.close();
    }
  }
}

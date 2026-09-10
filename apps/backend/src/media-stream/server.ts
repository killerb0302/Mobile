import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { MediaStreamConnection } from "./connection.js";
import { takePendingCall } from "../call/sessionStore.js";
import { DeepgramStt } from "../pipeline/twilio/deepgramStt.js";
import { TwilioConversationTransport } from "../pipeline/twilio/twilioTransport.js";
import { ClaudeLlm } from "../pipeline/llm.js";
import { ElevenLabsTts } from "../pipeline/tts.js";
import { CallOrchestrator } from "../pipeline/orchestrator.js";
import {
  disclosureLine,
  APOLOGY_LINE,
  DISCLOSURE_AUDIO_FILENAME,
  APOLOGY_AUDIO_FILENAME,
} from "../pipeline/fixedLines.js";

// Twilio-mode tuning: a real per-minute-billed phone call gets a hard turn
// cap and a tight overall timeout (see the plan's Phase 0-1 scope) - local
// mode uses much more permissive values since there's no per-minute cost.
const MAX_TURNS = 3;
const OVERALL_TIMEOUT_MS = 3 * 60 * 1000;

// Stateless providers, shared across calls; DeepgramStt is per-call (it's a
// stateful streaming connection) and constructed fresh per Media Stream.
const llm = new ClaudeLlm();
const tts = new ElevenLabsTts([
  { text: disclosureLine(), filename: DISCLOSURE_AUDIO_FILENAME },
  { text: APOLOGY_LINE, filename: APOLOGY_AUDIO_FILENAME },
]);

/**
 * Registers the WebSocket endpoint Twilio's <Connect><Stream> connects to
 * for bidirectional call audio, and wires up the Twilio-mode concrete
 * providers (DeepgramStt + TwilioConversationTransport + ClaudeLlm +
 * ElevenLabsTts) behind the provider-agnostic CallOrchestrator. This is the
 * one place Twilio-mode wiring happens - the orchestrator itself never
 * references any of these concrete types.
 *
 * NOTE: built against @fastify/websocket's current handler signature (raw
 * `ws` WebSocket passed directly as the first handler argument) - verify
 * against the installed plugin version at first real test, since this
 * hasn't been exercised against a live connection yet.
 */
export function registerMediaStreamRoute(app: FastifyInstance): void {
  app.get("/media-stream", { websocket: true }, (socket: WebSocket) => {
    const conn = new MediaStreamConnection(socket);

    conn.onStart((callSid, streamSid) => {
      const pending = takePendingCall(callSid);
      if (!pending) {
        console.error(`[media-stream] no pending call found for callSid ${callSid}; closing stream`);
        conn.close();
        return;
      }
      console.log(`[media-stream] stream ${streamSid} started for call ${callSid}`);

      const stt = new DeepgramStt((err) => console.error(`[media-stream] Deepgram error for ${callSid}:`, err));
      const transport = new TwilioConversationTransport(conn, stt, callSid);
      const orchestrator = new CallOrchestrator(transport, llm, tts, {
        id: callSid,
        objective: pending.objective,
        openingLine: disclosureLine(),
        apologyLine: APOLOGY_LINE,
        maxTurns: MAX_TURNS,
        overallTimeoutMs: OVERALL_TIMEOUT_MS,
      });
      void orchestrator.run();
    });
  });
}

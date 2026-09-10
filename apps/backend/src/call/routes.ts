import type { FastifyInstance } from "fastify";
import Twilio from "twilio";
import { loadConfig } from "../config/index.js";
import { takePendingCall } from "./sessionStore.js";
import { hangupCall } from "./twilioClient.js";
import { placeCall } from "./placeCall.js";

interface VoiceAnswerBody {
  CallSid: string;
}
interface VoiceStatusBody {
  CallSid: string;
  CallStatus: string;
}
interface VoiceAmdBody {
  CallSid: string;
  AnsweredBy: string;
}
interface TriggerCallBody {
  to: string;
  objective?: string;
}

const DEFAULT_OBJECTIVE =
  "Ask whether they have any availability this week and, if so, book the earliest available slot.";

const TERMINAL_CALL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);

/**
 * HTTP routes for this phase: Twilio's voice webhooks (answer/status/AMD)
 * plus one unauthenticated /trigger-call endpoint to kick off a test call.
 * No REST API, task queue, or auth yet - deferred to a later phase per the
 * plan's Phase 0-1 scope. NOTE: Twilio webhook signature validation is also
 * skipped for this phase (fine behind a throwaway local tunnel for testing;
 * revisit before any real/production deployment).
 */
export function registerCallRoutes(app: FastifyInstance): void {
  app.post<{ Body: VoiceAnswerBody }>("/voice/answer", async (request, reply) => {
    const { CallSid } = request.body;
    const config = loadConfig();

    const wssUrl = `${config.PUBLIC_BASE_URL.replace(/^https:/, "wss:")}/media-stream`;
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.connect().stream({ url: wssUrl });

    reply.type("text/xml").send(twiml.toString());
  });

  app.post<{ Body: VoiceStatusBody }>("/voice/status", async (request, reply) => {
    const { CallSid, CallStatus } = request.body;
    console.log(`[voice] status callback: ${CallSid} -> ${CallStatus}`);

    if (TERMINAL_CALL_STATUSES.has(CallStatus)) {
      // If a pending-call record still exists here, the call ended (busy,
      // no-answer, failed, or hung up) before the Media Stream ever
      // connected and a CallOrchestrator ever started - there's no
      // transcript/latency data to log, just note it and clean up. In the
      // common case the orchestrator already consumed this record and
      // logged its own summary, so this is a no-op.
      const pending = takePendingCall(CallSid);
      if (pending) {
        console.log(`[voice] call ${CallSid} ended before conversation started (status: ${CallStatus})`);
      }
    }

    reply.code(204).send();
  });

  app.post<{ Body: VoiceAmdBody }>("/voice/amd", async (request, reply) => {
    const { CallSid, AnsweredBy } = request.body;
    console.log(`[voice] AMD result for ${CallSid}: ${AnsweredBy}`);

    if (AnsweredBy?.startsWith("machine")) {
      const pending = takePendingCall(CallSid);
      console.log(`[voice] voicemail detected for ${CallSid}${pending ? "" : " (conversation already started)"}`);
      await hangupCall(CallSid);
    }

    reply.code(204).send();
  });

  app.post<{ Body: TriggerCallBody }>("/trigger-call", async (request, reply) => {
    const { to, objective } = request.body;
    if (!to) {
      reply.code(400).send({ error: "Missing required field: to (E.164 phone number)" });
      return;
    }
    try {
      const result = await placeCall({ to, objective: objective ?? DEFAULT_OBJECTIVE });
      reply.send(result);
    } catch (err) {
      console.error("[voice] failed to place call:", err);
      reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

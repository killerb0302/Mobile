import { loadConfig } from "../config/index.js";
import { getTwilioClient, hangupCall } from "./twilioClient.js";
import { createSession, deleteSession, getSessionByCallSid } from "./sessionStore.js";
import { OVERALL_CALL_TIMEOUT_MS } from "./types.js";
import { logCallSummary } from "./logging.js";

export interface PlaceCallParams {
  to: string;
  objective: string;
}

export interface PlaceCallResult {
  callSid: string;
}

/**
 * Places an outbound call and registers the in-memory session that the
 * Media Stream WS handler and voice webhooks will attach to once Twilio
 * dials in. This is Phase 0-1's only entry point for starting a call - no
 * REST API / task queue yet.
 */
export async function placeCall({ to, objective }: PlaceCallParams): Promise<PlaceCallResult> {
  const config = loadConfig();
  const client = getTwilioClient();

  const call = await client.calls.create({
    to,
    from: config.TWILIO_PHONE_NUMBER,
    url: `${config.PUBLIC_BASE_URL}/voice/answer`,
    statusCallback: `${config.PUBLIC_BASE_URL}/voice/status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    machineDetection: "DetectMessageEnd",
    asyncAmd: "true",
    asyncAmdStatusCallback: `${config.PUBLIC_BASE_URL}/voice/amd`,
    asyncAmdStatusCallbackMethod: "POST",
  });

  const session = createSession(call.sid, objective);

  session.overallTimeoutHandle = setTimeout(() => {
    void forceEndCall(call.sid, "overall call timeout exceeded");
  }, OVERALL_CALL_TIMEOUT_MS);

  console.log(`[call] placed call ${call.sid} to ${to}, objective: "${objective}"`);

  return { callSid: call.sid };
}

/**
 * Enforced by the overall wall-clock timeout, and reused by any other path
 * that needs to unconditionally end a call regardless of pipeline state
 * (e.g. an unrecoverable error). Always hangs up via the Twilio REST API
 * and cleans up the in-memory session so nothing leaks.
 */
export async function forceEndCall(callSid: string, reason: string): Promise<void> {
  console.warn(`[call] force-ending ${callSid}: ${reason}`);
  const session = getSessionByCallSid(callSid);
  if (session) {
    session.ended = true;
  }
  await hangupCall(callSid);
  if (session) {
    logCallSummary(session, reason);
  }
  deleteSession(callSid);
}

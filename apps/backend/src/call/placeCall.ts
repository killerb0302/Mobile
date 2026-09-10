import { loadConfig } from "../config/index.js";
import { getTwilioClient } from "./twilioClient.js";
import { registerPendingCall } from "./sessionStore.js";

export interface PlaceCallParams {
  to: string;
  objective: string;
}

export interface PlaceCallResult {
  callSid: string;
}

/**
 * Places an outbound call and registers the pending-call record the
 * Media Stream WS handler will consume once Twilio actually connects the
 * call. This is Phase 0-1's only entry point for starting a call - no REST
 * API / task queue yet.
 *
 * No custom pre-answer timeout here: Twilio's own default ring timeout
 * (~60s) already fires a `no-answer` status callback, which
 * `/voice/status` already cleans up - a second timer duplicating that would
 * just be redundant. Once the call is answered and the CallOrchestrator
 * starts, IT owns the in-conversation overall timeout (see
 * CallOrchestratorOptions.overallTimeoutMs) - lifecycle decisions live in
 * one place, not split across Twilio-specific plumbing and the
 * orchestrator.
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

  registerPendingCall(call.sid, objective);

  console.log(`[call] placed call ${call.sid} to ${to}, objective: "${objective}"`);

  return { callSid: call.sid };
}

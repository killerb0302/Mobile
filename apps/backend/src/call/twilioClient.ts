import Twilio from "twilio";
import { loadConfig } from "../config/index.js";

let client: Twilio.Twilio | undefined;

export function getTwilioClient(): Twilio.Twilio {
  if (!client) {
    const config = loadConfig();
    client = Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }
  return client;
}

export async function hangupCall(callSid: string): Promise<void> {
  try {
    await getTwilioClient().calls(callSid).update({ status: "completed" });
  } catch (err) {
    // The call may have already ended (callee hung up, or we already
    // hung it up) - Twilio returns an error in that case. Log and move on;
    // there's nothing further we can do to end an already-ended call.
    console.error(`[twilio] hangup(${callSid}) failed (call may have already ended):`, err);
  }
}

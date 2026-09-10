import type { PendingCall } from "./types.js";

const pendingCalls = new Map<string, PendingCall>();

export function registerPendingCall(callSid: string, objective: string): void {
  pendingCalls.set(callSid, { callSid, objective, createdAt: Date.now() });
}

/** Looks up and removes a pending call (consumed exactly once - by either
 * the Media Stream handler starting the orchestrator, or a terminal Twilio
 * status callback for a call that never got that far). */
export function takePendingCall(callSid: string): PendingCall | undefined {
  const call = pendingCalls.get(callSid);
  if (call) pendingCalls.delete(callSid);
  return call;
}

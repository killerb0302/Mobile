import { type CallSession, createCallSession } from "./types.js";

const sessionsByCallSid = new Map<string, CallSession>();
const callSidByStreamSid = new Map<string, string>();

export function createSession(callSid: string, objective: string): CallSession {
  const session = createCallSession(callSid, objective);
  sessionsByCallSid.set(callSid, session);
  return session;
}

export function getSessionByCallSid(callSid: string): CallSession | undefined {
  return sessionsByCallSid.get(callSid);
}

export function linkStreamToCall(streamSid: string, callSid: string): void {
  callSidByStreamSid.set(streamSid, callSid);
}

export function getSessionByStreamSid(streamSid: string): CallSession | undefined {
  const callSid = callSidByStreamSid.get(streamSid);
  if (!callSid) return undefined;
  return sessionsByCallSid.get(callSid);
}

export function deleteSession(callSid: string): void {
  const session = sessionsByCallSid.get(callSid);
  if (session?.streamSid) {
    callSidByStreamSid.delete(session.streamSid);
  }
  sessionsByCallSid.delete(callSid);
}

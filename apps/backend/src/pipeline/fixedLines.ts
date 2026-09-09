import { loadConfig } from "../config/index.js";

/**
 * Fixed, non-LLM-generated lines. These are pre-rendered to mulaw audio
 * once (see src/pipeline/prerender.ts) and played verbatim by the state
 * machine - never something the LLM is trusted to say on its own, per the
 * compliance requirement that disclosure must not depend on model behavior.
 */
export function disclosureLine(): string {
  const { CALLER_NAME } = loadConfig();
  return `Hi, this is an A I assistant calling on behalf of ${CALLER_NAME} to help schedule an appointment. This call may be recorded and transcribed.`;
}

export const APOLOGY_LINE =
  "I'm sorry, I'm having trouble with this call right now. I'll have to try again later. Thank you, goodbye.";

export const DISCLOSURE_AUDIO_FILENAME = "disclosure.ulaw";
export const APOLOGY_AUDIO_FILENAME = "apology.ulaw";

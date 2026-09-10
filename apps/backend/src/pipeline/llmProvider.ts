import type { TranscriptEntry } from "./conversationTypes.js";

export interface LlmTurnResult {
  reply: string;
  llmMs: number;
}

/**
 * Generates the agent's next spoken line given the objective and
 * conversation so far. For this phase, always returns a plain conversational
 * reply string only - no tool use, no structured outcome extraction. That
 * stays true for every implementation (Claude or Ollama) equally; structured
 * outcomes/negotiation logic are Phase 2, above this interface, not inside it.
 */
export interface LanguageModel {
  getNextReply(objective: string, transcript: TranscriptEntry[]): Promise<LlmTurnResult>;
}

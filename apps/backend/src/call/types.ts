/**
 * Twilio-specific bookkeeping for the window between placing a call and the
 * Media Stream actually connecting (i.e. before a CallOrchestrator exists
 * for it). Once the orchestrator starts, it owns all conversation state
 * itself - this record is consumed and discarded at that point.
 */
export interface PendingCall {
  callSid: string;
  objective: string;
  createdAt: number;
}

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptEntry, TurnLatency } from "./conversationTypes.js";

const LOG_DIR = join(process.cwd(), "call-logs");

export interface CallSummaryInput {
  /** callSid for Twilio mode, a generated session id for local mode. */
  id: string;
  objective: string;
  startedAt: number;
  transcript: TranscriptEntry[];
  latencies: TurnLatency[];
  turnCount: number;
}

/**
 * Logs the full transcript and per-turn latency breakdown for a finished (or
 * force-ended) conversation, both to the console and to a JSON file under
 * ./call-logs. Provider-agnostic - the orchestrator calls this the same way
 * regardless of which transport/STT/LLM/TTS backed the conversation.
 */
export function logCallSummary(input: CallSummaryInput, endReason: string): void {
  const summary = {
    id: input.id,
    objective: input.objective,
    endReason,
    durationMs: Date.now() - input.startedAt,
    turnCount: input.turnCount,
    transcript: input.transcript,
    latencies: input.latencies,
  };

  console.log(`\n[${input.id}] === CALL SUMMARY ===`);
  console.log(`  end reason: ${endReason}`);
  console.log(`  duration: ${summary.durationMs}ms, turns: ${input.turnCount}`);
  console.log("  transcript:");
  for (const entry of input.transcript) {
    console.log(`    [${entry.speaker}] ${entry.text}`);
  }
  console.log("  per-turn latency (ms):");
  for (const lat of input.latencies) {
    console.log(
      `    turn ${lat.turn}: stt=${lat.sttMs ?? "-"} llm=${lat.llmMs ?? "-"} tts=${lat.ttsMs ?? "-"} total=${lat.totalMs ?? "-"}`,
    );
  }

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const path = join(LOG_DIR, `${input.id}.json`);
    writeFileSync(path, JSON.stringify(summary, null, 2));
    console.log(`  full summary written to ${path}`);
  } catch (err) {
    console.error(`[${input.id}] failed to write call log file:`, err);
  }
}

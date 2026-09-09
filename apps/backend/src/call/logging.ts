import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CallSession } from "./types.js";

const LOG_DIR = join(process.cwd(), "call-logs");

/**
 * Logs the full transcript and per-turn latency breakdown for a finished
 * (or force-ended) call, both to the console and to a JSON file under
 * ./call-logs. This is the primary output Phase 0-1 exists to produce -
 * the whole point of this pass is to inspect these numbers.
 */
export function logCallSummary(session: CallSession, endReason: string): void {
  const summary = {
    callSid: session.callSid,
    objective: session.objective,
    endReason,
    durationMs: Date.now() - session.callStartedAt,
    turnCount: session.turnCount,
    transcript: session.transcript,
    latencies: session.latencies,
  };

  console.log(`\n[call ${session.callSid}] === CALL SUMMARY ===`);
  console.log(`  end reason: ${endReason}`);
  console.log(`  duration: ${summary.durationMs}ms, turns: ${session.turnCount}`);
  console.log("  transcript:");
  for (const entry of session.transcript) {
    console.log(`    [${entry.speaker}] ${entry.text}`);
  }
  console.log("  per-turn latency (ms):");
  for (const lat of session.latencies) {
    console.log(
      `    turn ${lat.turn}: stt=${lat.sttMs ?? "-"} llm=${lat.llmMs ?? "-"} tts=${lat.ttsMs ?? "-"} total=${lat.totalMs ?? "-"}`,
    );
  }

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const path = join(LOG_DIR, `${session.callSid}.json`);
    writeFileSync(path, JSON.stringify(summary, null, 2));
    console.log(`  full summary written to ${path}`);
  } catch (err) {
    console.error(`[call ${session.callSid}] failed to write call log file:`, err);
  }
}

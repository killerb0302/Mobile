import { spawn } from "node:child_process";
import { loadConfig } from "../../config/index.js";
import type { TextToSpeechProvider } from "../ttsProvider.js";

/**
 * Spawns a fresh `piper` process per synthesis request, feeding text via
 * stdin and streaming raw 16-bit PCM audio from stdout as it's produced.
 *
 * A persistent process fed multiple lines over stdin (avoiding a per-turn
 * model reload) is a plausible future optimization, but Piper's exact
 * stdin-loop output framing changed with its move to the GPL-3.0 fork and
 * hasn't been verified against a live binary here - spawning fresh per turn
 * is the safer, verifiable-by-inspection choice for this phase. Piper's
 * model load is typically well under a second, so the added latency is
 * real but modest - re-evaluate once this has been run against a real
 * binary and the persistent-process behavior can be confirmed.
 */
export class PiperTts implements TextToSpeechProvider {
  async *synthesize(text: string): AsyncGenerator<Buffer> {
    const config = loadConfig();

    const child = spawn(config.PIPER_BINARY_PATH, ["--model", config.PIPER_VOICE_MODEL_PATH, "--output-raw"]);

    // Every stream on a ChildProcess can independently emit 'error' (e.g. a
    // failed spawn makes writing to stdin fail too), and Node throws an
    // uncaught exception - crashing the whole process - for any 'error'
    // event with no listener. All of these must be attached BEFORE writing
    // anything, so a bad PIPER_BINARY_PATH surfaces as a normal rejected
    // promise the orchestrator can catch, not a process crash.
    let spawnError: Error | null = null;
    child.on("error", (err) => {
      spawnError = err;
    });
    child.stdin.on("error", () => {
      // A failed spawn means this write will also fail - the real cause is
      // reported via the child's own 'error'/exit handling above/below.
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdin.write(`${text}\n`);
    child.stdin.end();

    const exitPromise = new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0));
    });

    for await (const chunk of child.stdout) {
      yield chunk as Buffer;
    }

    const exitCode = await exitPromise;
    if (spawnError) {
      throw new Error(
        `Failed to start piper at PIPER_BINARY_PATH=${config.PIPER_BINARY_PATH}: ${(spawnError as Error).message}`,
      );
    }
    if (exitCode !== 0) {
      throw new Error(
        `piper exited with code ${exitCode} - check PIPER_BINARY_PATH/PIPER_VOICE_MODEL_PATH. stderr: ${stderr}`,
      );
    }
  }
}

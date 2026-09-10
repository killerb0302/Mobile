import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ElevenLabsTts } from "./tts.js";
import { disclosureLine, APOLOGY_LINE, DISCLOSURE_AUDIO_FILENAME, APOLOGY_AUDIO_FILENAME } from "./fixedLines.js";

const ASSETS_DIR = join(process.cwd(), "assets");
// No cached lines here, obviously - this script is what PRODUCES the cache.
const tts = new ElevenLabsTts([]);

/**
 * One-time script: pre-renders the fixed disclosure and apology-fallback
 * lines to mulaw 8kHz audio files via ElevenLabs, so the state machine can
 * play them by streaming static bytes instead of making a live TTS call for
 * text that never changes. Run once (and again only if CALLER_NAME or the
 * line text changes) via `npm run prerender-audio`, after real API keys are
 * configured.
 */
async function renderLine(text: string, filename: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const frame of tts.synthesize(text)) {
    chunks.push(frame);
  }
  const audio = Buffer.concat(chunks);
  const path = join(ASSETS_DIR, filename);
  writeFileSync(path, audio);
  console.log(`Wrote ${audio.length} bytes to ${path}`);
}

async function main(): Promise<void> {
  mkdirSync(ASSETS_DIR, { recursive: true });
  console.log("Rendering disclosure line...");
  await renderLine(disclosureLine(), DISCLOSURE_AUDIO_FILENAME);
  console.log("Rendering apology fallback line...");
  await renderLine(APOLOGY_LINE, APOLOGY_AUDIO_FILENAME);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed to pre-render fixed audio lines:", err);
  process.exit(1);
});

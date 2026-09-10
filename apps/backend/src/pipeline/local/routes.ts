import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { WhisperStt } from "./whisperStt.js";
import { OllamaLlm } from "./ollamaLlm.js";
import { PiperTts } from "./piperTts.js";
import { LocalConversationTransport } from "./localTransport.js";
import { CallOrchestrator } from "../orchestrator.js";
import { loadConfig } from "../../config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(__dirname, "static", "index.html");

const DEFAULT_OBJECTIVE = "Have a friendly test conversation to help debug the assistant's negotiation logic.";
const OPENING_LINE =
  "Hey there! I'm a local AI voice agent demo, running for free on your machine. Go ahead and hold the button to talk to me.";
const APOLOGY_LINE = "Oops, I ran into a problem. Let's stop here for now.";

// Local mode: no per-minute cost, so a generous turn budget instead of the
// paid path's strict cap - just a safety valve against a runaway session.
const MAX_TURNS = 20;
const OVERALL_TIMEOUT_MS = 30 * 60 * 1000;

let sessionCounter = 0;

// Stateless providers, shared across connections (WhisperStt is per-
// connection since a batch transcriber has no persistent state to share,
// but nothing stops it being module-level either - kept per-connection here
// only for symmetry with DeepgramStt's genuinely-stateful equivalent).
const llm = new OllamaLlm();
const tts = new PiperTts();

/**
 * Registers the local-mode push-to-talk page and its WebSocket endpoint,
 * wiring up WhisperStt + LocalConversationTransport + OllamaLlm + PiperTts
 * behind the same provider-agnostic CallOrchestrator the Twilio path uses.
 * This is the one place local-mode wiring happens.
 */
export function registerLocalVoiceRoutes(app: FastifyInstance): void {
  app.get("/", async (_request, reply) => {
    reply.type("text/html").send(readFileSync(PAGE_PATH, "utf8"));
  });

  app.get("/local-call", { websocket: true }, (socket: WebSocket) => {
    const config = loadConfig();
    const sessionId = `local-${Date.now()}-${++sessionCounter}`;
    console.log(`[local] new session ${sessionId}`);

    socket.send(JSON.stringify({ type: "config", sampleRate: config.PIPER_SAMPLE_RATE }));

    const stt = new WhisperStt();
    const transport = new LocalConversationTransport(socket, stt, sessionId);
    const orchestrator = new CallOrchestrator(transport, llm, tts, {
      id: sessionId,
      objective: DEFAULT_OBJECTIVE,
      openingLine: OPENING_LINE,
      apologyLine: APOLOGY_LINE,
      maxTurns: MAX_TURNS,
      overallTimeoutMs: OVERALL_TIMEOUT_MS,
    });
    void orchestrator.run();
  });
}

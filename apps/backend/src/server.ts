import "dotenv/config";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config/index.js";
import { registerCallRoutes } from "./call/routes.js";
import { registerMediaStreamRoute } from "./media-stream/server.js";
import { registerLocalVoiceRoutes } from "./pipeline/local/routes.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(websocket);

  // Mode selection happens exactly once, here - nothing downstream branches
  // on VOICE_AGENT_MODE again.
  if (config.VOICE_AGENT_MODE === "twilio") {
    registerCallRoutes(app);
    registerMediaStreamRoute(app);
  } else {
    registerLocalVoiceRoutes(app);
  }

  app.get("/health", async () => ({ ok: true, mode: config.VOICE_AGENT_MODE }));

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  console.log(`[server] listening on port ${config.PORT} (mode: ${config.VOICE_AGENT_MODE})`);

  if (config.VOICE_AGENT_MODE === "twilio") {
    console.log(`[server] public base url: ${config.PUBLIC_BASE_URL}`);
    console.log(
      `[server] trigger a test call with: curl -X POST ${config.PUBLIC_BASE_URL}/trigger-call -H 'content-type: application/json' -d '{"to":"+15551234567"}'`,
    );
  } else {
    console.log(`[server] open http://localhost:${config.PORT} in a browser and hold the button to talk`);
  }
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});

import "dotenv/config";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config/index.js";
import { registerCallRoutes } from "./call/routes.js";
import { registerMediaStreamRoute } from "./media-stream/server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(websocket);

  registerCallRoutes(app);
  registerMediaStreamRoute(app);

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  console.log(`[server] listening on port ${config.PORT}`);
  console.log(`[server] public base url: ${config.PUBLIC_BASE_URL}`);
  console.log(
    `[server] trigger a test call with: curl -X POST ${config.PUBLIC_BASE_URL}/trigger-call -H 'content-type: application/json' -d '{"to":"+15551234567"}'`,
  );
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});

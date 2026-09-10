import "dotenv/config";
import { loadConfig } from "../config/index.js";

/**
 * Dev convenience CLI: POSTs to the already-running server's /trigger-call
 * endpoint. Requires `npm run dev` (or `npm start`) to already be running
 * in another terminal, with PUBLIC_BASE_URL tunneled to this port so Twilio
 * can reach the /voice/* webhooks and /media-stream.
 *
 * Usage: npm run trigger-call -- +15551234567 "Book a table for 2 at 7pm"
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const to = process.argv[2];
  const objective = process.argv.slice(3).join(" ") || undefined;

  if (!to) {
    console.error('Usage: npm run trigger-call -- "+15551234567" ["objective text..."]');
    process.exit(1);
  }

  const response = await fetch(`http://localhost:${config.PORT}/trigger-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, objective }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Failed to trigger call:", response.status, body);
    process.exit(1);
  }
  console.log("Call triggered:", body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

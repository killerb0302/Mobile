import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { MediaStreamConnection } from "./connection.js";
import { getSessionByCallSid, linkStreamToCall } from "../call/sessionStore.js";
import { runCallOrchestration } from "../pipeline/orchestrator.js";

/**
 * Registers the WebSocket endpoint Twilio's <Connect><Stream> connects to
 * for bidirectional call audio. NOTE: built against @fastify/websocket's
 * current handler signature (raw `ws` WebSocket passed directly as the
 * first handler argument) - verify against the installed plugin version at
 * first real test, since this hasn't been exercised against a live
 * connection yet.
 */
export function registerMediaStreamRoute(app: FastifyInstance): void {
  app.get("/media-stream", { websocket: true }, (socket: WebSocket) => {
    const conn = new MediaStreamConnection(socket);

    conn.onStart((callSid, streamSid) => {
      const session = getSessionByCallSid(callSid);
      if (!session) {
        console.error(`[media-stream] no session found for callSid ${callSid}; closing stream`);
        conn.close();
        return;
      }
      session.streamSid = streamSid;
      linkStreamToCall(streamSid, callSid);
      console.log(`[media-stream] stream ${streamSid} started for call ${callSid}`);
      void runCallOrchestration(session, conn);
    });
  });
}

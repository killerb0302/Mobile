import { loadConfig } from "../config/index.js";

/** 20ms of 8kHz, 8-bit mulaw audio = 160 bytes. Twilio Media Streams expects
 * outbound frames in this format/size. */
const FRAME_BYTES = 160;
const MULAW_SILENCE_BYTE = 0xff;

/**
 * Streams ElevenLabs TTS audio for `text`, already encoded as mulaw 8kHz
 * (via ElevenLabs' `output_format=ulaw_8000`, so no local transcoding is
 * needed), chunked into fixed 160-byte/20ms frames ready to hand straight to
 * the Media Stream WebSocket.
 *
 * Uses the raw REST streaming endpoint directly (rather than an SDK) to
 * avoid depending on an SDK version's exact method signature for a call
 * this plan can't exercise against a real API key yet - the REST contract
 * is the stable source of truth to build against.
 *
 * Callers measure their own time-to-first-frame by timing from the call to
 * this function to the first value yielded by the returned generator.
 */
export async function* synthesizeSpeech(text: string): AsyncGenerator<Buffer> {
  const config = loadConfig();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.ELEVENLABS_VOICE_ID}/stream?output_format=ulaw_8000`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/basic",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
      }),
    },
  );

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS request failed: ${response.status} ${response.statusText} ${body}`);
  }

  const reader = response.body.getReader();
  let leftover = Buffer.alloc(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    let buf = Buffer.concat([leftover, Buffer.from(value)]);
    while (buf.length >= FRAME_BYTES) {
      yield buf.subarray(0, FRAME_BYTES);
      buf = buf.subarray(FRAME_BYTES);
    }
    leftover = buf;
  }

  if (leftover.length > 0) {
    const padded = Buffer.concat([leftover, Buffer.alloc(FRAME_BYTES - leftover.length, MULAW_SILENCE_BYTE)]);
    yield padded;
  }
}

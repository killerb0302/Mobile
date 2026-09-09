# Mobile

An AI voice agent that places real outbound phone calls on your behalf to
schedule things with businesses (restaurants, clinics, salons, etc.) -
carrying on a live, spoken conversation rather than relaying a script.

## Current status: Phase 0-1 (voice pipeline proof)

This repo currently contains just the backend piece needed to prove the
hardest technical assumption of the whole project: that we can place a real
Twilio call, bridge live bidirectional audio over a WebSocket, and hold a
real two-turn conversation through Deepgram (speech-to-text) -> Claude
(the assistant's replies) -> ElevenLabs (text-to-speech), with a mandatory
spoken disclosure, basic barge-in handling, strict timeouts, and per-turn
latency logging.

There is **no iOS app, no database, and no unbounded negotiation loop yet**
- those are later phases, built once this pipeline is proven out. See
`apps/backend/` for everything that exists so far.

## What this needs before you can make a real call

Four paid third-party accounts, none of which this assistant can create for
you:

| Service | What it's for | Rough cost to start |
|---|---|---|
| [Twilio](https://www.twilio.com) | Places the actual phone call | ~$20 (phone number + call minutes) |
| [Anthropic API](https://console.anthropic.com) | Generates the assistant's replies (separate from a Claude.ai subscription) | A few dollars of API credit |
| [Deepgram](https://console.deepgram.com) | Real-time speech-to-text | Free trial credit usually covers this phase |
| [ElevenLabs](https://elevenlabs.io) | Real-time text-to-speech | ~$5/mo starter plan (needed for the streaming API) |

You'll also need a way to expose your local server to the public internet
so Twilio's servers can reach it - [ngrok](https://ngrok.com) or a
Cloudflare Tunnel both work.

The server **fails fast at startup** with a clear list of missing
environment variables if any of these aren't configured - it's safe to
`npm install` and try to build/run before you have any of them, to review
what's here without spending anything.

## Setup

```bash
cd apps/backend
npm install
cp .env.example .env
# fill in .env with your real Twilio/Anthropic/Deepgram/ElevenLabs keys
```

Pre-render the fixed disclosure and apology lines to audio (only needs to
be re-run if you change `CALLER_NAME` or the line text in
`src/pipeline/fixedLines.ts`):

```bash
npm run prerender-audio
```

Start an ngrok tunnel to your local port (default 3000) in one terminal:

```bash
ngrok http 3000
```

Copy the `https://...ngrok-free.app` URL it prints into `PUBLIC_BASE_URL`
in your `.env`, then start the server in another terminal:

```bash
npm run dev
```

Trigger a test call - **call a phone you personally control first**, not a
real business, until you've verified the pipeline works end-to-end:

```bash
npm run trigger-call -- "+15551234567" "Ask if they have a table for 2 available tonight"
```

## What to look at afterward

Every call writes a full transcript and a per-turn latency breakdown
(speech-to-text responsiveness, Claude response time, ElevenLabs
time-to-first-audio-byte, and total turn latency) to
`apps/backend/call-logs/<CallSid>.json`, and prints the same summary to the
server's console. The latency numbers are the real point of this phase -
if total turn latency runs several seconds, that's a sign the pipeline
needs more work (e.g. streaming the LLM response into TTS instead of
waiting for the full reply) before it would feel natural on a real call.

## Legal note

Many jurisdictions require disclosing that a call is AI-driven and/or that
it may be recorded, and rules vary and are evolving. This system always
speaks a fixed disclosure line before anything else, as a hard, code-level
requirement rather than something left to the model - but you're
responsible for confirming current requirements for your jurisdiction
before placing real calls to real businesses.

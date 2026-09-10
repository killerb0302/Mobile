# Mobile

An AI voice agent that places real outbound phone calls on your behalf to
schedule things with businesses (restaurants, clinics, salons, etc.) -
carrying on a live, spoken conversation rather than relaying a script.

## Current status: Phase 0-1 (voice pipeline proof)

This repo currently contains just the backend piece needed to prove the
hardest technical assumption of the whole project: that we can hold a real,
two-way spoken conversation through a speech-to-text -> LLM -> text-to-speech
pipeline, with a mandatory opening line, basic barge-in handling, strict
timeouts, and per-turn latency logging.

There is **no iOS app, no database, and no unbounded negotiation loop yet**
- those are later phases, built once this pipeline is proven out. See
`apps/backend/` for everything that exists so far.

**Two ways to run it, same underlying agent:**

- **Twilio mode** (`VOICE_AGENT_MODE=twilio`, the default) - real outbound
  phone calls via Twilio + Deepgram + Claude + ElevenLabs. Costs real money
  (see the account table below) and can only call real businesses.
- **Local mode** (`VOICE_AGENT_MODE=local`) - **$0, fully offline, no
  accounts, no trials.** A browser tab captures your mic (push-to-talk) so
  you can talk to the same agent yourself, using whisper.cpp + Ollama +
  Piper instead of the paid services. See "Free local mode" below.

Both modes run through the exact same `CallOrchestrator` - the conversation
logic, turn-taking, barge-in, and latency instrumentation are identical
either way; only the underlying speech/LLM/audio providers differ. Local
mode is meant to be a free way to develop and stress-test the agent's
conversation behavior before ever spending money on a real call.

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

## Setup (Twilio mode)

```bash
cd apps/backend
npm install
cp .env.example .env
# leave VOICE_AGENT_MODE=twilio (the default) and fill in your real
# Twilio/Anthropic/Deepgram/ElevenLabs keys
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

## Free local mode

A completely free, offline way to talk to the same agent - no Twilio, no
Anthropic, no Deepgram, no ElevenLabs, no accounts, no trial credits. A
browser tab captures your mic (push-to-talk: hold a button, release when
done) and plays the agent's replies through your speakers - you play the
role of "whoever answers," which is a genuinely useful way to stress-test
the conversation prompt for free before ever spending money on a real call.

**This needs to run on your own machine, not a cloud dev container** - it
needs real microphone/speaker access (a browser permission prompt) and a
few native tools installed locally:

1. **whisper.cpp** (speech-to-text) - clone/build from
   [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) (or grab a
   release binary), download a model (e.g. `ggml-base.en.bin`, ~150MB), and
   run its bundled `server` example so it stays loaded in memory:
   ```bash
   ./server -m models/ggml-base.en.bin
   ```
   Defaults to `http://localhost:8080` - matches `WHISPER_SERVER_URL`'s
   default.

2. **Ollama** (local LLM) - install from [ollama.com](https://ollama.com),
   then pull a model:
   ```bash
   ollama pull llama3.2:3b   # or phi3:mini if you have less RAM
   ```
   Runs as a background service at `http://localhost:11434` automatically.

3. **Piper** (text-to-speech) - grab a release from
   [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (the
   actively-maintained fork; GPL-3.0-licensed, which is fine for this
   personal/local use) and download one voice model - e.g. from Piper's
   voice samples page, an `.onnx` file plus its `.onnx.json` config (check
   that JSON's `"sample_rate"` field for your `PIPER_SAMPLE_RATE`).

Then:

```bash
cd apps/backend
npm install
cp .env.example .env
# set VOICE_AGENT_MODE=local and fill in WHISPER_SERVER_URL/OLLAMA_MODEL/
# PIPER_BINARY_PATH/PIPER_VOICE_MODEL_PATH/PIPER_SAMPLE_RATE
npm run dev
```

Open `http://localhost:3000` in a browser, hold the button, and talk. Press
the button again while the agent is mid-reply to interrupt it (barge-in).
No ngrok/tunnel needed - nothing external needs to reach this server.

A transcript and per-turn latency breakdown is written to
`apps/backend/call-logs/<session-id>.json`, same as Twilio mode - useful for
comparing how much slower/lower-quality the free stack is versus the paid
one.

## Legal note

Many jurisdictions require disclosing that a call is AI-driven and/or that
it may be recorded, and rules vary and are evolving. This system always
speaks a fixed disclosure line before anything else, as a hard, code-level
requirement rather than something left to the model - but you're
responsible for confirming current requirements for your jurisdiction
before placing real calls to real businesses.

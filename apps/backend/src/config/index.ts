import { z } from "zod";

/**
 * One flat schema with every field the app could ever need; which fields
 * are actually REQUIRED depends on VOICE_AGENT_MODE and is enforced by the
 * manual check below rather than a zod discriminated union - that keeps the
 * missing-var error list simple and specific (the whole point of failing
 * fast) without fighting TypeScript over a union type that every small
 * provider file would otherwise have to re-narrow. Each provider only ever
 * runs in the mode it was built for (wired up once in server.ts), so the
 * fields it reads are guaranteed present by the time it runs.
 */
const envSchema = z.object({
  VOICE_AGENT_MODE: z.enum(["twilio", "local"]).default("twilio"),
  PORT: z.coerce.number().int().positive().default(3000),

  // --- Twilio mode ---
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  CALLER_NAME: z.string().min(1).default("the caller"),

  // --- Local mode ---
  WHISPER_SERVER_URL: z.string().default("http://localhost:8080"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().optional(),
  PIPER_BINARY_PATH: z.string().optional(),
  PIPER_VOICE_MODEL_PATH: z.string().optional(),
  PIPER_SAMPLE_RATE: z.coerce.number().int().positive().default(22050),
});

type RawConfig = z.infer<typeof envSchema>;

export type AppConfig = RawConfig & {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  ANTHROPIC_API_KEY: string;
  DEEPGRAM_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  PUBLIC_BASE_URL: string;
  OLLAMA_MODEL: string;
  PIPER_BINARY_PATH: string;
  PIPER_VOICE_MODEL_PATH: string;
};

const TWILIO_REQUIRED_FIELDS = [
  ["TWILIO_ACCOUNT_SID", "Twilio Account SID is required in twilio mode"],
  ["TWILIO_AUTH_TOKEN", "Twilio Auth Token is required in twilio mode"],
  ["TWILIO_PHONE_NUMBER", "Twilio phone number is required in twilio mode (E.164, e.g. +15551234567)"],
  ["ANTHROPIC_API_KEY", "Anthropic API key is required in twilio mode"],
  ["DEEPGRAM_API_KEY", "Deepgram API key is required in twilio mode"],
  ["ELEVENLABS_API_KEY", "ElevenLabs API key is required in twilio mode"],
  ["ELEVENLABS_VOICE_ID", "ElevenLabs voice ID is required in twilio mode"],
  ["PUBLIC_BASE_URL", "PUBLIC_BASE_URL is required in twilio mode (a public https URL, e.g. an ngrok tunnel)"],
] as const;

const LOCAL_REQUIRED_FIELDS = [
  ["OLLAMA_MODEL", "OLLAMA_MODEL is required in local mode (e.g. llama3.2:3b - must already be pulled)"],
  ["PIPER_BINARY_PATH", "PIPER_BINARY_PATH is required in local mode (path to the piper executable)"],
  ["PIPER_VOICE_MODEL_PATH", "PIPER_VOICE_MODEL_PATH is required in local mode (path to a voice .onnx file)"],
] as const;

let cachedConfig: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    printErrorsAndExit(parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`));
  }
  const raw = parsed.data;

  const requiredFields = raw.VOICE_AGENT_MODE === "twilio" ? TWILIO_REQUIRED_FIELDS : LOCAL_REQUIRED_FIELDS;
  const missing = requiredFields
    .filter(([key]) => !raw[key as keyof RawConfig])
    .map(([key, message]) => `  - ${key}: ${message}`);

  if (raw.VOICE_AGENT_MODE === "twilio" && raw.PUBLIC_BASE_URL) {
    if (!raw.PUBLIC_BASE_URL.startsWith("https://")) {
      missing.push("  - PUBLIC_BASE_URL: must be https (Twilio requires TLS)");
    }
  }
  if (raw.VOICE_AGENT_MODE === "twilio" && raw.TWILIO_PHONE_NUMBER && !/^\+[1-9]\d{1,14}$/.test(raw.TWILIO_PHONE_NUMBER)) {
    missing.push("  - TWILIO_PHONE_NUMBER: must be E.164 (e.g. +15551234567)");
  }

  if (missing.length > 0) {
    printErrorsAndExit(missing, raw.VOICE_AGENT_MODE);
  }

  cachedConfig = raw as AppConfig;
  return cachedConfig;
}

function printErrorsAndExit(lines: string[], mode?: string): never {
  console.error(
    [
      `Missing or invalid required environment variables${mode ? ` for VOICE_AGENT_MODE=${mode}` : ""}:`,
      ...lines,
      "",
      "Copy apps/backend/.env.example to apps/backend/.env and fill in real values before starting the server.",
    ].join("\n"),
  );
  process.exit(1);
}

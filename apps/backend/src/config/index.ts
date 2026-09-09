import { z } from "zod";

const envSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().min(1, "Twilio Account SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "Twilio Auth Token is required"),
  TWILIO_PHONE_NUMBER: z
    .string()
    .min(1, "Twilio phone number is required")
    .regex(/^\+[1-9]\d{1,14}$/, "TWILIO_PHONE_NUMBER must be E.164 (e.g. +15551234567)"),
  ANTHROPIC_API_KEY: z.string().min(1, "Anthropic API key is required"),
  DEEPGRAM_API_KEY: z.string().min(1, "Deepgram API key is required"),
  ELEVENLABS_API_KEY: z.string().min(1, "ElevenLabs API key is required"),
  ELEVENLABS_VOICE_ID: z.string().min(1, "ElevenLabs voice ID is required"),
  PUBLIC_BASE_URL: z
    .string()
    .url("PUBLIC_BASE_URL must be a full https URL, e.g. https://abc123.ngrok.io")
    .refine((url) => url.startsWith("https://"), "PUBLIC_BASE_URL must be https (Twilio requires TLS)"),
  PORT: z.coerce.number().int().positive().default(3000),
  CALLER_NAME: z.string().min(1).default("the caller"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    // eslint-disable-next-line no-console
    console.error(
      [
        "Missing or invalid required environment variables:",
        ...missing,
        "",
        "Copy apps/backend/.env.example to apps/backend/.env and fill in real values before starting the server.",
      ].join("\n"),
    );
    process.exit(1);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

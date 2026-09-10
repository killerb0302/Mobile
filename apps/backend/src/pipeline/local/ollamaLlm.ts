import { loadConfig } from "../../config/index.js";
import type { TranscriptEntry } from "../conversationTypes.js";
import type { LanguageModel, LlmTurnResult } from "../llmProvider.js";

function buildSystemPrompt(objective: string): string {
  return [
    "You are a friendly AI voice assistant, practicing a phone-call scenario for testing purposes.",
    `Objective: ${objective}`,
    "Keep replies short (one or two sentences), natural, and conversational, since they will be spoken aloud via text-to-speech.",
    "Respond with only what you would say out loud next - no stage directions, no meta-commentary.",
  ].join("\n");
}

/**
 * LanguageModel backed by a local Ollama instance's chat API
 * (http://localhost:11434 by default). Same plain-conversational-reply-only
 * contract as ClaudeLlm - no tool use, no structured output.
 */
export class OllamaLlm implements LanguageModel {
  async getNextReply(objective: string, transcript: TranscriptEntry[]): Promise<LlmTurnResult> {
    const config = loadConfig();
    const start = Date.now();

    const history = transcript
      .filter((entry) => !entry.excludeFromLlmHistory)
      .map((entry) => ({
        role: entry.speaker === "agent" ? ("assistant" as const) : ("user" as const),
        content: entry.text,
      }));

    const messages = [
      { role: "system" as const, content: buildSystemPrompt(objective) },
      ...(history.length > 0
        ? history
        : [
            {
              role: "user" as const,
              content: "(The conversation has just started. Greet them briefly and state your objective.)",
            },
          ]),
    ];

    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.OLLAMA_MODEL, messages, stream: false }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Ollama request failed: ${response.status} ${response.statusText} ${body} - is Ollama running and has '${config.OLLAMA_MODEL}' been pulled (ollama pull ${config.OLLAMA_MODEL})?`,
      );
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const reply = (data.message?.content ?? "").trim();

    return { reply, llmMs: Date.now() - start };
  }
}

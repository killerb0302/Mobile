import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../config/index.js";
import type { TranscriptEntry } from "./conversationTypes.js";
import type { LanguageModel, LlmTurnResult } from "./llmProvider.js";

// Confirmed as a currently-valid Claude model ID as of this plan (Sept
// 2026). Re-verify against the Anthropic API docs at implementation/test
// time in case it has since been superseded.
const MODEL_ID = "claude-sonnet-5";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    const config = loadConfig();
    client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return client;
}

function buildSystemPrompt(objective: string): string {
  return [
    "You are a polite, efficient AI voice assistant placing a phone call on behalf of a real person to a business, in order to accomplish a specific scheduling objective.",
    `Objective: ${objective}`,
    "You are speaking live over a phone call - keep replies short (one or two sentences), natural, and conversational, since they will be spoken aloud via text-to-speech.",
    "The call has already opened with a disclosure that you are an AI assistant - do not repeat that disclosure yourself.",
    "If the person asks something you don't have information for, say so plainly rather than inventing details.",
    "Respond with only what you would say out loud next - no stage directions, no meta-commentary.",
  ].join("\n");
}

/**
 * Single non-streaming Claude call for one conversational turn. No tool use
 * yet (that's Phase 2) - always returns a plain conversational reply string.
 */
export class ClaudeLlm implements LanguageModel {
  async getNextReply(objective: string, transcript: TranscriptEntry[]): Promise<LlmTurnResult> {
    const start = Date.now();

    const history = transcript
      .filter((entry) => !entry.excludeFromLlmHistory)
      .map((entry) => ({
        role: entry.speaker === "agent" ? ("assistant" as const) : ("user" as const),
        content: entry.text,
      }));

    // The Anthropic API requires the first message to have role "user". If
    // the callee hasn't said anything usable yet, prompt the model to open
    // the substantive part of the conversation itself.
    const messages =
      history.length > 0
        ? history
        : [{ role: "user" as const, content: "(The call has just connected. Greet them briefly and state your objective.)" }];

    const response = await getClient().messages.create({
      model: MODEL_ID,
      max_tokens: 300,
      system: buildSystemPrompt(objective),
      messages,
      // Minimizes time-to-first-token for this latency-critical, real-time
      // turn-taking workload. Verify at test time whether disabled-thinking
      // or adaptive-thinking-low-effort actually gives better real-world
      // turn latency for this model - a build-time experiment per the plan.
      thinking: { type: "disabled" },
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    const reply = textBlock?.text.trim() ?? "";

    return { reply, llmMs: Date.now() - start };
  }
}

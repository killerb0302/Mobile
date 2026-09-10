/**
 * Synthesizes speech audio for text, streamed as it becomes available. The
 * frame format/encoding is entirely up to the implementation (mulaw 8kHz for
 * ElevenLabs feeding a Twilio transport, whatever Piper emits for a browser
 * transport) - the orchestrator never inspects frame contents, only hands
 * them to whatever ConversationTransport is active.
 */
export interface TextToSpeechProvider {
  synthesize(text: string): AsyncGenerator<Buffer>;
}

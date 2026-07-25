/** Voices available on OpenAI Realtime (and previewable via gpt-4o-mini-tts). */
export const REALTIME_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse"
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

export const DEFAULT_VOICE_PREVIEW_TEXT =
  "Hi, I'm Pixel — your mirror companion. Ask me anything, and I'll keep the answer short.";

export function isRealtimeVoice(value: string): value is RealtimeVoice {
  return (REALTIME_VOICES as readonly string[]).includes(value);
}

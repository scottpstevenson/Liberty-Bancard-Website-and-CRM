/**
 * Centralized AI model name constants.
 * Update here to change the model across the entire codebase.
 * All model strings must match valid OpenAI model identifiers.
 */

export const AI_MODELS = {
  /** General-purpose high-quality model — AI advisors, proposals, blueprint generation */
  standard: "gpt-5",

  /** Lightweight fast model — intent classification, enrichment, scoring, campaign copy */
  fast: "gpt-4o-mini",

  /** Image generation */
  image: "gpt-image-1",

  /** Audio transcription */
  transcription: "gpt-4o-mini-transcribe",

  /** Audio response / TTS */
  audio: "gpt-audio",
} as const;

export type AiModelKey = keyof typeof AI_MODELS;
export type AiModelValue = (typeof AI_MODELS)[AiModelKey];

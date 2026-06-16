/**
 * Emotion Fusion Service
 * Pure calculation layer — no DB, no API, no LLM, no side effects.
 * Combines available emotional signals into a single unified result.
 */

import {
  FusionInput,
  FusionResult,
  FUSION_WEIGHTS,
  textEmotionToScore,
  moodLabelFromScore,
} from "./emotionWeights";

const MISMATCH_THRESHOLD = 25;

export function fuseEmotion(input: FusionInput): FusionResult {
  const sources: { key: string; score: number; weight: number }[] = [];
  const sourceLabels: string[] = [];

  // Resolve text score
  const textScore = input.textScore ?? (input.textEmotion ? textEmotionToScore(input.textEmotion) : undefined);
  if (textScore !== undefined) {
    sources.push({ key: "text", score: textScore, weight: FUSION_WEIGHTS.text });
    sourceLabels.push("text");
  }

  if (input.faceScore !== undefined) {
    sources.push({ key: "face", score: input.faceScore, weight: FUSION_WEIGHTS.face });
    sourceLabels.push("face");
  }

  if (input.voiceScore !== undefined) {
    sources.push({ key: "voice", score: input.voiceScore, weight: FUSION_WEIGHTS.voice });
    sourceLabels.push("voice");
  }

  if (input.historyScore !== undefined) {
    sources.push({ key: "history", score: input.historyScore, weight: FUSION_WEIGHTS.history });
    sourceLabels.push("history");
  }

  // Nothing to fuse
  if (sources.length === 0) {
    return {
      score: 50,
      mood: "Neutral",
      confidence: 0.5,
      sources: [],
      mismatch: false,
      explanation: "No emotional signals available",
    };
  }

  // Normalize weights so available sources sum to 1.0
  const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
  const normalizedSources = sources.map(s => ({
    ...s,
    normalizedWeight: s.weight / totalWeight,
  }));

  // Weighted score
  const finalScore = Math.round(
    normalizedSources.reduce((sum, s) => sum + s.score * s.normalizedWeight, 0)
  );

  // Mismatch detection (text vs face)
  let mismatch = false;
  let explanation = "";

  if (textScore !== undefined && input.faceScore !== undefined) {
    const diff = Math.abs(textScore - input.faceScore);
    if (diff > MISMATCH_THRESHOLD) {
      mismatch = true;
      explanation = "Text and facial signals show different emotional patterns";
    }
  }

  // Confidence: based on agreement between available sources
  let confidence: number;
  if (sources.length === 1) {
    confidence = 0.75;
  } else {
    const scores = sources.map(s => s.score);
    const maxDiff = Math.max(...scores) - Math.min(...scores);
    // maxDiff 0 → confidence 0.95, maxDiff 100 → confidence 0.4
    confidence = Math.round((0.95 - (maxDiff / 100) * 0.55) * 100) / 100;
    confidence = Math.max(0.4, Math.min(0.95, confidence));
  }

  if (!explanation) {
    explanation = confidence >= 0.8
      ? "Emotional signals are consistent"
      : "Emotional signals show some variation";
  }

  return {
    score: Math.max(0, Math.min(100, finalScore)),
    mood: moodLabelFromScore(finalScore),
    confidence,
    sources: sourceLabels,
    mismatch,
    explanation,
  };
}

/**
 * Builds a human-readable context string for LLM injection.
 */
export function buildFusionContext(result: FusionResult, input: FusionInput): string {
  const lines: string[] = [
    `Estimated mood: ${result.mood}`,
    `Score: ${result.score}/100`,
    `Confidence: ${result.confidence}`,
  ];

  const signals: string[] = [];
  if (input.textEmotion) signals.push(`Text: ${input.textEmotion}`);
  if (input.faceMood) signals.push(`Face: ${input.faceMood}`);
  else if (input.faceScore !== undefined) signals.push(`Face score: ${input.faceScore}`);
  if (input.voiceScore !== undefined) signals.push(`Voice score: ${input.voiceScore}`);
  if (input.historyScore !== undefined) signals.push(`History average: ${input.historyScore}`);

  if (signals.length > 0) {
    lines.push(`Signals: ${signals.join(", ")}`);
  }

  if (result.mismatch) {
    lines.push(`Note: ${result.explanation}`);
  }

  return lines.join("\n");
}

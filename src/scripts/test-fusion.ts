/**
 * Fusion Engine Validation Script
 * Tests all 6 scenarios against fuseEmotion + buildFusionContext + buildPrompt
 */

import { fuseEmotion, buildFusionContext } from "../services/emotionFusion.service";
import { FusionInput } from "../services/emotionWeights";
import { buildPrompt } from "../services/contextBuilder.service";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Test 1: Text Only ──────────────────────────────────────────
console.log("\n═══ TEST 1: Text Only (no camera, no history) ═══");
{
  const input: FusionInput = { textEmotion: "low" };
  const result = fuseEmotion(input);
  const ctx = buildFusionContext(result, input);

  assert(result.score === 30, `Score is 30 (got ${result.score})`);
  assert(result.mood === "Uneasy", `Mood is Uneasy (got ${result.mood})`);
  assert(result.confidence === 0.75, `Single-source confidence 0.75 (got ${result.confidence})`);
  assert(result.sources.length === 1, `Only 1 source (got ${result.sources.length})`);
  assert(result.sources[0] === "text", `Source is text (got ${result.sources[0]})`);
  assert(!result.mismatch, "No mismatch");
  assert(!isNaN(result.score), "Score is not NaN");
  assert(!isNaN(result.confidence), "Confidence is not NaN");
  assert(ctx.includes("[Emotional Guidance]"), "Context has guidance header");
  assert(!ctx.includes("Score:"), "Context does not expose raw score");
  assert(!ctx.includes("Confidence:"), "Context does not expose confidence number");

  // Verify prompt works with fusion
  const prompt = buildPrompt("I feel really bad today", [], "", "TestUser", "unknown", "Maya", "supportive", null, ctx);
  assert(prompt.includes("[Emotional Guidance]"), "Prompt contains fusion guidance");
  assert(!prompt.includes("The user's last tracked mood was"), "No standalone latestMood when fusion exists");
}

// ── Test 2: Text Stronger Than Face (Mismatch) ────────────────
console.log("\n═══ TEST 2: Text dominates, face contradicts ═══");
{
  const input: FusionInput = { textEmotion: "low", faceScore: 80, faceMood: "Happy" };
  const result = fuseEmotion(input);
  const ctx = buildFusionContext(result, input);

  // Text=30 (50%) + Face=80 (25%), normalized: text=0.667, face=0.333
  // Expected: 30*0.667 + 80*0.333 = 20 + 26.67 = ~47
  assert(result.score >= 40 && result.score <= 55, `Score in 40-55 range (got ${result.score})`);
  assert(result.mismatch === true, "Mismatch detected");
  assert(result.confidence < 0.8, `Confidence reduced below 0.8 (got ${result.confidence})`);
  assert(ctx.includes("[Emotional Guidance]"), "Context has guidance header");
  assert(ctx.includes("Prioritize the user"), "Context advises to prioritize user's words");
  assert(!ctx.includes("Face:"), "No raw face label exposed");
  assert(!ctx.includes("mismatch: true"), "No raw mismatch boolean exposed");
}

// ── Test 3: Neutral Text + Sad Face ───────────────────────────
console.log("\n═══ TEST 3: Neutral text, sad face ═══");
{
  const input: FusionInput = { textEmotion: "neutral", faceScore: 24, faceMood: "Sad" };
  const result = fuseEmotion(input);
  const ctx = buildFusionContext(result, input);

  // Text=50 (normalized 0.667) + Face=24 (normalized 0.333) = 33.3+8 = ~41
  assert(result.score >= 35 && result.score <= 50, `Score in 35-50 range (got ${result.score})`);
  assert(result.mismatch === true, "Mismatch detected (diff=26)");
  assert(!ctx.includes("Sad"), "Does not expose 'Sad' face label");
  assert(!ctx.includes("camera"), "Does not mention camera");

  const prompt = buildPrompt("I'm okay", [], "", "TestUser", "low", "Maya", "supportive", null, ctx);
  assert(!prompt.includes("The user's last tracked mood was"), "latestMood suppressed by fusion");
  assert(prompt.includes("[Emotional Guidance]"), "Fusion guidance present in prompt");
}

// ── Test 4: Matching Positive Signals ──────────────────────────
console.log("\n═══ TEST 4: Matching positive signals ═══");
{
  const input: FusionInput = { textEmotion: "positive", faceScore: 80, faceMood: "Happy", historyScore: 70 };
  const result = fuseEmotion(input);
  const ctx = buildFusionContext(result, input);

  // Text=75 (weighted ~0.588) + Face=80 (weighted ~0.294) + History=70 (weighted ~0.118)
  assert(result.score >= 70 && result.score <= 85, `Score in 70-85 range (got ${result.score})`);
  assert(!result.mismatch, "No mismatch");
  assert(result.confidence >= 0.8, `High confidence (got ${result.confidence})`);
  assert(result.sources.length === 3, `3 sources (got ${result.sources.length})`);
  assert(ctx.includes("consistent"), "Guidance says signals are consistent");
}

// ── Test 5: Missing Data (all edge cases) ──────────────────────
console.log("\n═══ TEST 5: Missing/invalid data ═══");
{
  // 5a: Completely empty input
  const r1 = fuseEmotion({});
  assert(r1.score === 50, `Empty input → score 50 (got ${r1.score})`);
  assert(r1.mood === "Neutral", `Empty input → Neutral (got ${r1.mood})`);
  assert(r1.sources.length === 0, `Empty input → 0 sources (got ${r1.sources.length})`);
  assert(!isNaN(r1.score) && !isNaN(r1.confidence), "No NaN in empty result");

  // 5b: NaN scores
  const r2 = fuseEmotion({ faceScore: NaN, historyScore: NaN });
  assert(r2.score === 50, `NaN inputs → fallback 50 (got ${r2.score})`);
  assert(r2.sources.length === 0, `NaN inputs → 0 sources (got ${r2.sources.length})`);

  // 5c: Undefined text emotion
  const r3 = fuseEmotion({ textEmotion: undefined, faceScore: undefined });
  assert(r3.score === 50, `All undefined → score 50 (got ${r3.score})`);

  // 5d: Invalid string emotion (not in map)
  const r4 = fuseEmotion({ textEmotion: "invalidemotion" as any });
  assert(r4.score === 50, `Unknown emotion maps to 50 (got ${r4.score})`);
  assert(!isNaN(r4.score), "No NaN from unknown emotion");

  // 5e: buildFusionContext with safe result
  const ctx = buildFusionContext(r1, {});
  assert(typeof ctx === "string", "Context is always a string");
  assert(ctx.includes("[Emotional Guidance]"), "Context has header even for empty input");
}

// ── Test 6: Large Context Budget ───────────────────────────────
console.log("\n═══ TEST 6: MAX_CONTEXT_CHARS overflow ═══");
{
  const fusionCtx = buildFusionContext(
    fuseEmotion({ textEmotion: "stress", faceScore: 30, historyScore: 40 }),
    { textEmotion: "stress", faceScore: 30, historyScore: 40 }
  );

  // Create a massive message history to overflow the 3000 char limit
  const bigHistory = Array.from({ length: 50 }, (_, i) => ({
    role: "user" as const,
    content: `This is a very long message number ${i} that is meant to overflow the context budget and force the rebuild logic to activate. `.repeat(3),
  }));

  const bigSummary = "Summary content ".repeat(100);

  const prompt = buildPrompt(
    "Hello", bigHistory, bigSummary, "TestUser", "low", "Maya", "supportive", null, fusionCtx
  );

  assert(prompt.includes("[Emotional Guidance]"), "Fusion context SURVIVES budget trim");
  assert(prompt.includes("Maya:"), "User message present");
  assert(prompt.includes("Hello"), "Current message present");
  assert(!prompt.includes("The user's last tracked mood was"), "latestMood suppressed (fusion exists)");
}

// ── Summary ────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════");
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log(`  TOTAL:  ${passed + failed}`);
console.log("══════════════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);

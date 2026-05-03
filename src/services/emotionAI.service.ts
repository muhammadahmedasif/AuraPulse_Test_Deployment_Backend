import { logger } from "../utils/logger";
import { groq1 } from "./llm.service";

const MODEL_NAME = "llama-3.1-8b-instant";

// ── Types ──────────────────────────────────────────────────────
export interface EmotionAIParams {
  userMessage: string;
  recentMessages: string;
  sessionSummary: string;
  latestMood: "low" | "neutral" | "positive" | "unknown";
}

export interface EmotionAIResult {
  emotion: "panic" | "stress" | "low" | "neutral" | "positive";
  intensity: number;
  suggestedActivity: "breathing" | "ocean" | "forest" | "zen" | null;
  autoTrigger: boolean;
}

// ── Smart Gate ────────────────────────────────────────────────
function isGreeting(message: string): boolean {
  const greetings = ["hi", "hello", "hey", "hola", "greetings", "yo", "morning", "evening", "night"];
  const trimmed = message.trim().toLowerCase();
  // Remove punctuation for better matching
  const clean = trimmed.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
  return greetings.includes(clean);
}

// ── Fallback Heuristic ─────────────────────────────────────────
function fallbackAnalysis(message: string, latestMood: string): EmotionAIResult {
  const lowercaseMsg = message.toLowerCase();
  
  if (lowercaseMsg.includes("panic")) {
    return { emotion: "panic", intensity: 0.9, suggestedActivity: "breathing", autoTrigger: true };
  }
  if (lowercaseMsg.includes("stress")) {
    return { emotion: "stress", intensity: 0.8, suggestedActivity: "ocean", autoTrigger: true };
  }
  if (lowercaseMsg.includes("anxious") || lowercaseMsg.includes("anxiety")) {
    return { emotion: "stress", intensity: 0.7, suggestedActivity: "breathing", autoTrigger: false };
  }
  if (lowercaseMsg.includes("overwhelm")) {
    return { emotion: "stress", intensity: 0.75, suggestedActivity: "zen", autoTrigger: false };
  }
  if (lowercaseMsg.includes("sad") || lowercaseMsg.includes("depress")) {
    return { emotion: "low", intensity: 0.7, suggestedActivity: "forest", autoTrigger: latestMood === "low" };
  }

  return { emotion: "neutral", intensity: 0.1, suggestedActivity: null, autoTrigger: false };
}

// ── Main Analysis Function ─────────────────────────────────────
export async function analyzeUserState(params: EmotionAIParams): Promise<EmotionAIResult> {
  // ── Smart Gate ──
  if (params.userMessage.length < 5 || isGreeting(params.userMessage)) {
    logger.info("🧠 emotionAI: Smart Gate triggered, using heuristic");
    return fallbackAnalysis(params.userMessage, params.latestMood);
  }

  const systemPrompt = `You are an emotion analysis engine.
Analyze emotional state based on context.
Return ONLY valid JSON with this exact structure:
{"emotion":"panic|stress|low|neutral|positive","intensity":0.0-1.0,"suggestedActivity":"breathing|ocean|forest|zen|null","autoTrigger":true|false}

DECISION RULES:
panic -> breathing
stress -> ocean OR breathing
low -> forest OR zen
neutral/positive -> null

AUTO TRIGGER RULES:
autoTrigger = true IF:
- intensity > 0.7
- OR latestMood = low / very_low`;

  const userPrompt = `User message: "${params.userMessage}"
Recent context: "${params.recentMessages}"
Summary: "${params.sessionSummary}"
Mood: "${params.latestMood}"`;

  try {
    logger.info("🧠 emotionAI: Running Groq analysis...");
    
    const completion = await groq1.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 80,
      temperature: 0.1,
      response_format: { type: "json_object" }
    }, {
      timeout: 1500 // VERY strict 1.5s timeout
    });

    const text = completion.choices[0]?.message?.content || "{}";
    const data = JSON.parse(text);

    const finalResult: EmotionAIResult = {
      emotion: data.emotion || "neutral",
      intensity: data.intensity || 0.1,
      suggestedActivity: (data.suggestedActivity === "null" || !data.suggestedActivity) ? null : data.suggestedActivity,
      autoTrigger: data.autoTrigger || false
    };

    logger.info("✅ emotionAI: Groq Complete", finalResult);
    return finalResult;
    
  } catch (error) {
    logger.warn("⚠️ emotionAI: Groq failed, using heuristic fallback", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return fallbackAnalysis(params.userMessage, params.latestMood);
  }
}

import { Types } from "mongoose";

export type Intent = "task" | "support" | "general";

export interface AuthUser {
  _id: Types.ObjectId;
  email?: string;
  name?: string;
  profileImage?: string;
  aiName: string;
  aiBehavior: string;
  aiAvatar: string;
  aiVoice?: string;
}

export interface MessageAnalysis {
  emotionalState: string;
  themes: string[];
  riskLevel: number;
  recommendedApproach: string;
  progressIndicators: string[];
}

export interface EmotionMeta {
  emotion: "panic" | "stress" | "low" | "neutral" | "positive";
  intensity: number;
  suggestedActivity: "breathing" | "ocean" | "forest" | "zen" | null;
  autoTrigger: boolean;
  // ── Crisis Extension (Phase 1) ─────────────────────────────
  crisisRiskScore?: number;       // 0.0–1.0 composite risk
  suicideRisk?: number;           // 0.0–1.0
  selfHarmRisk?: number;          // 0.0–1.0
  panicSeverity?: number;         // 0.0–1.0
  escalationRecommended?: boolean;
  escalationReason?: string;
  recommendedAction?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: {
    analysis?: MessageAnalysis;
    technique?: string;
    goal?: string;
    currentGoal?: string | null;
    progress?: {
      emotionalState?: string;
      riskLevel?: number;
    };
    emotionMeta?: EmotionMeta | null;
    source?: "text" | "voice";
  };
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

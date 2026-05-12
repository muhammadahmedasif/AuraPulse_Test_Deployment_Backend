import { Schema, model, Document, Types } from "mongoose";
import { RiskLevel } from "../services/crisis/crisis-types";

export interface IEscalationLog extends Document {
  userId: Types.ObjectId | string;
  sessionId: string;
  riskLevel: RiskLevel;
  crisisRiskScore: number;
  escalationReason: string;
  contactCalled?: string;
  contactPhone?: string;
  callSid?: string;
  outcome: "initiated" | "completed" | "failed" | "blocked";
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EscalationLogSchema = new Schema<IEscalationLog>(
  {
    userId:           { type: Schema.Types.Mixed, required: true, index: true },
    sessionId:        { type: String, required: true },
    riskLevel:        { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true },
    crisisRiskScore:  { type: Number, required: true },
    escalationReason: { type: String, default: "" },
    contactCalled:    { type: String },
    contactPhone:     { type: String },
    callSid:          { type: String },
    outcome:          {
      type: String,
      enum: ["initiated", "completed", "failed", "blocked"],
      default: "initiated",
    },
    error: { type: String },
  },
  { timestamps: true }
);

// Index for cooldown queries
EscalationLogSchema.index({ userId: 1, createdAt: -1 });

export const EscalationLog = model<IEscalationLog>("EscalationLog", EscalationLogSchema);

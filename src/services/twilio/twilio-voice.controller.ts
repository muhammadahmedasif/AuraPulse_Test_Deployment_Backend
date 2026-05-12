/**
 * Twilio Voice Controller
 * ───────────────────────
 * Handles three webhook routes called by Twilio during emergency calls:
 *
 *  POST /api/twilio/voice          — Call connects → return opening TwiML
 *  POST /api/twilio/voice/respond  — Contact speaks → Groq AI reply → TwiML
 *  POST /api/twilio/voice/status   — Call status updates → update EscalationLog
 *
 * All responses are TwiML XML. Groq is called via the EXISTING generate() fn.
 */

import { Request, Response }        from "express";
import { twilioSessionManager }      from "./twilio-session-manager";
import { buildCallResponsePrompt, buildOpeningMessage } from "../../prompts/emergency-contact.prompt";
import { buildGreetingTwiML, buildResponseTwiML, buildErrorTwiML, buildClosingTwiML } from "./twiml-builder";
import { buildEmergencyCallContext }                    from "../crisis/escalation-memory.service";
import { generate }                                     from "../llm.service";
import { EscalationLog }                               from "../../models/EscalationLog";
import { EscalationLogger }                            from "../crisis/escalation-logger.service";
import { logger }                                       from "../../utils/logger";
import { CrisisContext, CrisisAssessment }              from "../crisis/crisis-types";

// ── Helper: send TwiML response ────────────────────────────────────────────────
function sendTwiML(res: Response, twiml: string): void {
  res.set("Content-Type", "text/xml");
  res.send(twiml);
}

// ── POST /api/twilio/voice — Initial webhook (call connected) ──────────────────
export const handleVoiceWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const callSid      = req.body?.CallSid || req.query.callSid as string;
    const userId       = req.query.userId       as string || "";
    const sessionId    = req.query.sessionId    as string || "";
    const contactName  = req.query.contactName  as string || "there";
    const relationship = req.query.relationship as string || "family member";

    logger.info("[TWILIO] Call connected", { callSid, userId, contactName });
    EscalationLogger.callConnected({ userId, sessionId, callSid, contactCalled: contactName });

    // Retrieve or rebuild crisis context
    let callSession = twilioSessionManager.get(callSid);

    if (!callSession && userId && sessionId) {
      // Rebuild minimal context if session was lost (e.g. server restart)
      const emotionalSummary = await buildEmergencyCallContext(sessionId, userId);
      const assessment: CrisisAssessment = {
        riskLevel: "HIGH", crisisRiskScore: 0.8,
        suicideRisk: 0, selfHarmRisk: 0, panicSeverity: 0,
        escalationRecommended: true, confidence: 0.7,
        escalationReason: "severe emotional distress",
        recommendedAction: "Please check on this person immediately",
      };
      const crisisContext: CrisisContext = {
        userId, sessionId, userName: "the individual",
        assessment, emotionalSummary,
        triggeringStatements: [],
        recommendedAction: "Please reach out immediately",
      };
      callSession = {
        callSid, userId, sessionId,
        contactName, contactPhone: "",
        crisisContext,
        conversationHistory: [],
        startedAt: new Date(),
      };
      twilioSessionManager.set(callSid, callSession);
    }

    if (!callSession) {
      logger.warn("[TWILIO] Session not found and context unavailable", { callSid });
      sendTwiML(res, buildClosingTwiML(
        "Hello, this is AuraPulse Emergency Support. We were calling regarding a wellness concern. Please contact AuraPulse for more information. Goodbye."
      ));
      return;
    }

    const opening = buildOpeningMessage(
      contactName,
      callSession.crisisContext.userName,
      callSession.crisisContext
    );

    // Store opening in history
    twilioSessionManager.update(callSid, {
      conversationHistory: [{ role: "ai", content: opening }],
    });

    sendTwiML(res, buildGreetingTwiML(contactName, callSession.crisisContext.userName, opening, callSid));

  } catch (err) {
    logger.error("[TWILIO] handleVoiceWebhook error", { error: String(err) });
    sendTwiML(res, buildErrorTwiML());
  }
};

// ── POST /api/twilio/voice/respond — Contact spoke, generate AI reply ──────────
export const handleVoiceRespond = async (req: Request, res: Response): Promise<void> => {
  try {
    const callSid      = (req.query.callSid || req.body?.CallSid) as string;
    const speechResult = (req.body?.SpeechResult || "").trim();

    logger.info("[TWILIO] Contact spoke", { callSid, speech: speechResult.slice(0, 80) });

    const callSession = twilioSessionManager.get(callSid);

    if (!callSession) {
      logger.warn("[TWILIO] No session for callSid", { callSid });
      sendTwiML(res, buildClosingTwiML(
        "Thank you for your time. Please reach out to the individual directly. Goodbye."
      ));
      return;
    }

    if (!speechResult) {
      // No speech detected — re-prompt
      sendTwiML(res, buildResponseTwiML(
        "I'm sorry, I didn't catch that. Could you please repeat your question?",
        callSid,
        callSession.conversationHistory.length
      ));
      return;
    }

    // Add contact speech to history
    const updatedHistory = [
      ...callSession.conversationHistory,
      { role: "contact" as const, content: speechResult },
    ];

    // Build prompt and call Groq (reuses existing generate())
    const prompt = buildCallResponsePrompt(
      callSession.crisisContext,
      speechResult,
      updatedHistory
    );

    const aiResponse = await generate(prompt, { maxTokens: 120, temperature: 0.6 });
    const cleanResponse = aiResponse.trim() ||
      "I understand your concern. Please reach out to the individual as soon as possible and offer your support.";

    // Update history with AI response
    twilioSessionManager.update(callSid, {
      conversationHistory: [
        ...updatedHistory,
        { role: "ai" as const, content: cleanResponse },
      ],
    });

    const turnCount = updatedHistory.length;
    sendTwiML(res, buildResponseTwiML(cleanResponse, callSid, turnCount));

  } catch (err) {
    logger.error("[TWILIO] handleVoiceRespond error", { error: String(err) });
    sendTwiML(res, buildErrorTwiML());
  }
};

// ── POST /api/twilio/voice/status — Call status webhook ───────────────────────
export const handleCallStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { CallSid, CallStatus } = req.body;

    logger.info("[TWILIO] Call status update", { callSid: CallSid, status: CallStatus });

    const callSession = twilioSessionManager.get(CallSid);
    const userId = callSession?.userId;

    if (CallStatus === "completed") {
      EscalationLogger.callCompleted({ userId: userId || "unknown", callSid: CallSid });
      await EscalationLog.findOneAndUpdate(
        { callSid: CallSid },
        { outcome: "completed" }
      );
      twilioSessionManager.delete(CallSid);

    } else if (["failed", "busy", "no-answer", "canceled"].includes(CallStatus)) {
      EscalationLogger.callFailed({
        userId: userId || "unknown",
        callSid: CallSid,
        error: `Call ended with status: ${CallStatus}`,
      });
      await EscalationLog.findOneAndUpdate(
        { callSid: CallSid },
        { outcome: "failed", error: CallStatus }
      );
      twilioSessionManager.delete(CallSid);
    }

    res.sendStatus(204);
  } catch (err) {
    logger.error("[TWILIO] handleCallStatus error", { error: String(err) });
    res.sendStatus(204); // Always 204 to Twilio to prevent retries
  }
};

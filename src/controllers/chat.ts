import { Request, Response } from "express";
import { ChatSession } from "../models/ChatSession";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger";
import { Types } from "mongoose";
import { buildPrompt } from "../services/contextBuilder.service";
import { routedGenerateStream } from "../services/aiRouter.service";
import {
  shouldUpdateSummary,
  updateSummary,
  generateTitle,
} from "../services/summarizer.service";
import { MessageAnalysis } from "../types";
import { Mood } from "../models/Mood";
import { analyzeUserState } from "../services/emotionAI.service";
import * as escalationEngine from "../services/crisis/escalation-engine.service";


// ── Default Analysis (until real analysis is implemented) ──────
const defaultAnalysis: MessageAnalysis = {
  emotionalState: "neutral",
  themes: [],
  riskLevel: 0,
  recommendedApproach: "supportive",
  progressIndicators: [],
};

// ── Create Chat Session ────────────────────────────────────────
export const createChatSession = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user._id) {
      return res
        .status(401)
        .json({ message: "Unauthorized - User not authenticated" });
    }

    const userId = req.user._id;
    const sessionId = randomUUID();

    const session = new ChatSession({
      sessionId,
      userId,
      title: "New Therapy Session",
      startTime: new Date(),
      status: "active",
      messages: [],
    });

    await session.save();

    res.status(201).json({
      message: "Chat session created successfully",
      sessionId: session.sessionId,
    });
  } catch (error) {
    logger.error("Error creating chat session:", error);
    res.status(500).json({
      message: "Error creating chat session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ── Send Message (CORE — refactored) ───────────────────────────
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message, source } = req.body;
    const messageSource = source === "voice" ? "voice" : "text";
    const userId = req.user._id;
    const userName = req.user.name;

    // ── Instant Response Headers ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

    if (!message || typeof message !== "string") {
      return res.status(400).json({ message: "Message is required" });
    }

    logger.info("Processing chat message", { sessionId, source: messageSource });

    // ── Load session & mood ──
    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      logger.warn("Session not found:", { sessionId });
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      logger.warn("Unauthorized access attempt:", { sessionId, userId });
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Check if session is locked (completed or archived)
    if (session.status === "completed" || session.status === "archived") {
      logger.warn("Attempted to message a locked session:", { sessionId, status: session.status });
      return res.status(400).json({ message: "This session has been completed and is locked." });
    }

    // ── Build context with HYBRID memory ──
    const allMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const summary = session.summary || "";

    // ── Start Parallel Emotion Analysis ──
    const latestMoodDoc = await Mood.findOne({ userId }).sort({ timestamp: -1 });
    let latestMood: "low" | "neutral" | "positive" | "unknown" = "unknown";
    if (latestMoodDoc) {
      if (latestMoodDoc.score <= 40) latestMood = "low";
      else if (latestMoodDoc.score >= 70) latestMood = "positive";
      else latestMood = "neutral";
    }

    const aiName = req.user.aiName || "Maya";
    const aiBehavior = req.user.aiBehavior || "supportive";

    // ── Start Emotion Analysis (Blocking) ──
    const recentContext = allMessages.slice(-3).map(m => m.content).join(" | ");
    const emotionMeta = await analyzeUserState({
      userMessage: message,
      recentMessages: recentContext,
      sessionSummary: summary,
      latestMood
    }).catch(err => {
      logger.warn("Emotion analysis failed in background", err);
      return null;
    });

    const prompt = buildPrompt(message, allMessages, summary, userName, latestMood, aiName, aiBehavior, emotionMeta?.suggestedActivity);

    // ── Abort on client disconnect ──
    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        logger.info("Client disconnected, aborting AI stream", { sessionId });
        abortController.abort();
      }
    });

    // ── Generate AI response via router ──
    // This starts streaming immediately to res
    const { fullText, modelUsed, fallbackUsed, error: llmError } = await routedGenerateStream(
      prompt,
      (chunk) => {
        if (!res.writableEnded) {
          res.write(JSON.stringify({ t: "chunk", d: chunk }) + "\n");
        }
      },
      {
        primaryMaxTokens: 250,
        temperature: 0.7,
      },
      abortController.signal
    );

    const reply = fullText.trim();

    logger.info("Generated response successfully", {
      sessionId,
      modelUsed,
      fallbackUsed,
      replyLength: reply.length,
    });

    // ── Crisis Escalation (async fire-and-forget — NEVER blocks chat) ──────
    if (emotionMeta) {
      void escalationEngine.evaluate(
        userId.toString(),
        sessionId,
        userName || "User",
        emotionMeta,
        message
      );
    }


    // ── Save messages atomically ──
    const updatedSession = await ChatSession.findOneAndUpdate(
      { sessionId, userId },
      {
        $push: {
          messages: {
            $each: [
              {
                role: "user",
                content: message,
                timestamp: new Date(),
                metadata: {
                  emotionMeta,
                  source: messageSource,
                },
              },
              {
                role: "assistant",
                content: reply,
                timestamp: new Date(),
                metadata: {
                  analysis: defaultAnalysis,
                  technique: defaultAnalysis.recommendedApproach,
                  goal: "Provide support",
                  progress: {
                    emotionalState: defaultAnalysis.emotionalState,
                    riskLevel: defaultAnalysis.riskLevel,
                  },
                  emotionMeta,
                  source: messageSource,
                },
              },
            ],
          },
        },
      },
      { new: true }
    );

    if (updatedSession) {
      logger.info("Session updated atomically", {
        sessionId,
        messageCount: updatedSession.messages.length,
      });

      // ── Background: Title Generation (Groq) ──
      const isDefaultTitle =
        updatedSession.title === "New Session" ||
        updatedSession.title === "New Therapy Session";

      if (updatedSession.messages.length >= 2 && isDefaultTitle) {
        generateTitle(message, reply)
          .then((title) => {
            if (title && title.length > 2) {
              ChatSession.updateOne({ sessionId }, { $set: { title } }).catch(
                (err) => logger.error("Title update error", err)
              );
            }
          })
          .catch((err) => logger.error("Title generation error", err));
      }

      // ── Background: Summary Update (Groq) ──
      const msgCount = updatedSession.messages.length;
      const hasSummary = !!updatedSession.summary;

      if (shouldUpdateSummary(msgCount, hasSummary)) {
        const msgs = updatedSession.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        updateSummary(sessionId, msgs, updatedSession.summary || "").catch(
          (err) =>
            logger.warn("Background summary update failed", {
              error: String(err),
            })
        );
      }
    }

    // ── Send final completion event ──
    res.write(
      JSON.stringify({
        t: "done",
        analysis: defaultAnalysis,
        modelUsed,
        fallbackUsed,
        error: llmError,
        metadata: {
          progress: {
            emotionalState: defaultAnalysis.emotionalState,
            riskLevel: defaultAnalysis.riskLevel,
          },
          emotionMeta,
        },
      }) + "\n"
    );
    res.end();
    logger.info("Response stream completed", { sessionId });
  } catch (error) {
    logger.error("Error in sendMessage:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Error processing message" });
    }
  }
};

// ── Get Chat Session ───────────────────────────────────────────
export const getChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    logger.info(`Getting chat session: ${sessionId}`);
    const chatSession = await ChatSession.findOne({ sessionId, userId, status: { $ne: "archived" } });

    if (!chatSession) {
      logger.warn(`Chat session not found: ${sessionId}`);
      return res.status(404).json({ error: "Chat session not found" });
    }
    logger.info(`Found chat session: ${sessionId}`);
    res.json(chatSession);
  } catch (error) {
    logger.error("Failed to get chat session:", error);
    res.status(500).json({ error: "Failed to get chat session" });
  }
};

// ── Get Chat History ───────────────────────────────────────────
export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;
    logger.info(`Fetching chat history`, {
      sessionId,
      userId: userId.toString(),
    });

    // 1. Try finding by UUID
    let session = await ChatSession.findOne({ sessionId });

    // 2. Fallback to _id if not found and sessionId looks like an ObjectId
    if (!session && Types.ObjectId.isValid(sessionId)) {
      session = await ChatSession.findById(sessionId);
    }

    if (!session || session.status === "archived") {
      logger.warn(`Session not found in DB or is archived`, { sessionId });
      return res.status(404).json({ message: "Session not found" });
    }

    logger.info(`Session found`, {
      sessionId: session.sessionId,
      ownerId: session.userId.toString(),
      requestUserId: userId.toString(),
      messagesCount: session.messages.length,
    });

    if (session.userId.toString() !== userId.toString()) {
      logger.warn(`Ownership mismatch`, {
        sessionId,
        ownerId: session.userId.toString(),
        requestUserId: userId.toString(),
      });
      return res.status(403).json({ message: "Unauthorized" });
    }

    logger.info(`Returning ${session.messages.length} messages to client`);
    res.json(session.messages);
  } catch (error) {
    logger.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Error fetching chat history" });
  }
};

// ── Get User Sessions ──────────────────────────────────────────
export const getUserSessions = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const sessions = await ChatSession.find({ 
      userId,
      status: { $ne: "archived" },
      "messages.0": { $exists: true }
    })
      .select("sessionId title startTime status messages")
      .sort({ startTime: -1 });

    const sessionsWithPreview = sessions.map((session) => {
      const lastMessage =
        session.messages.length > 0
          ? session.messages[session.messages.length - 1]
          : null;
      return {
        sessionId: session.sessionId,
        title: session.title,
        startTime: session.startTime,
        status: session.status,
        lastMessage: lastMessage
          ? {
              content: lastMessage.content,
              timestamp: lastMessage.timestamp,
            }
          : null,
        messageCount: session.messages.length,
      };
    });
    res.json(sessionsWithPreview);
  } catch (error) {
    logger.error("Error fetching user sessions:", error);
    res.status(500).json({ message: "Error fetching user sessions" });
  }
};

// ── Delete Chat Session ────────────────────────────────────────
export const deleteChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    logger.info(`Attempting to delete chat session: ${sessionId}`);

    // Using findOneAndDelete to ensure we only delete if it belongs to the user
    const deletedSession = await ChatSession.findOneAndDelete({
      sessionId,
      userId,
    });

    if (!deletedSession) {
      logger.warn(
        `Chat session not found or unauthorized for deletion: ${sessionId}`
      );
      return res
        .status(404)
        .json({ message: "Chat session not found or unauthorized" });
    }

    logger.info(`Successfully deleted chat session: ${sessionId}`);
    res.json({ message: "Chat session deleted successfully" });
  } catch (error) {
    logger.error("Failed to delete chat session:", error);
    res.status(500).json({ message: "Failed to delete chat session" });
  }
};

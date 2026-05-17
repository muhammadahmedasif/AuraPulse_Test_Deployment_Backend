/**
 * Admin Analytics Routes
 * ──────────────────────
 * Aggregates real data from existing MongoDB collections.
 * NO fake metrics — only data derivable from the database.
 *
 * GET /api/admin/analytics — Dashboard analytics
 */

import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { ChatSession } from "../../models/ChatSession";
import { EscalationLog } from "../../models/EscalationLog";
import { Activity } from "../../models/Activity";
import { Mood } from "../../models/Mood";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

// ── GET / — Dashboard analytics ───────────────────────────────────────────────
router.get("/", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── Core counts ──
    const [
      totalUsers,
      newUsersThisWeek,
      newUsersThisMonth,
      totalSessions,
      activeSessions,
      totalEscalations,
      escalationsThisWeek,
      totalActivities,
      totalMoodEntries,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      ChatSession.countDocuments({ "messages.0": { $exists: true } }),
      ChatSession.countDocuments({ status: "active", "messages.0": { $exists: true } }),
      EscalationLog.countDocuments(),
      EscalationLog.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Activity.countDocuments(),
      Mood.countDocuments(),
    ]);

    // ── Average session duration (across all sessions) ──
    const durationAgg = await ChatSession.aggregate([
      { $match: { "messages.1": { $exists: true } } },
      {
        $project: {
          duration: {
            $subtract: [
              { $arrayElemAt: ["$messages.timestamp", -1] },
              { $arrayElemAt: ["$messages.timestamp", 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgDuration: { $avg: "$duration" },
        },
      },
    ]);
    const avgSessionDurationMs = durationAgg[0]?.avgDuration || 0;
    const avgSessionMinutes = Math.round(avgSessionDurationMs / 60000);

    // ── Users growth (last 7 days) ──
    const usersGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Sessions per day (last 7 days) ──
    const sessionsPerDay = await ChatSession.aggregate([
      { $match: { startTime: { $gte: sevenDaysAgo }, "messages.0": { $exists: true } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$startTime" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Emergency trends (last 7 days) ──
    const emergencyTrends = await EscalationLog.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Average mood score ──
    const moodAgg = await Mood.aggregate([
      { $match: { timestamp: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$score" },
          count: { $sum: 1 },
        },
      },
    ]);
    const avgMoodScore = Math.round(moodAgg[0]?.avgScore || 0);

    res.json({
      metrics: {
        totalUsers,
        newUsersThisWeek,
        newUsersThisMonth,
        totalSessions,
        activeSessions,
        avgSessionMinutes,
        totalEscalations,
        escalationsThisWeek,
        totalActivities,
        totalMoodEntries,
        avgMoodScore,
      },
      trends: {
        usersGrowth,
        sessionsPerDay,
        emergencyTrends,
      },
    });
  } catch (error) {
    logger.error("[ADMIN_ANALYTICS] Analytics error", { error: String(error) });
    res.status(500).json({ message: "Failed to compute analytics" });
  }
});

export default router;

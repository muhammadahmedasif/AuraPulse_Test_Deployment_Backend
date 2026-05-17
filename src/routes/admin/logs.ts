/**
 * Admin Logs Routes
 * ─────────────────
 * Returns escalation logs as the system activity feed.
 * These are real audit logs from the EscalationLog collection.
 *
 * GET /api/admin/logs — Paginated system logs
 */

import { Router, Request, Response } from "express";
import { EscalationLog } from "../../models/EscalationLog";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

// ── GET / — System logs ───────────────────────────────────────────────────────
router.get("/", requirePermission("logs.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const category = (req.query.category as string) || "";
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};

    // Map admin UI categories to real data filters
    if (category === "CRISIS") {
      filter.riskLevel = { $in: ["HIGH", "CRITICAL"] };
    } else if (category === "AUTH") {
      // Auth logs aren't stored in EscalationLog — return empty for now
      return res.json({
        logs: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
      });
    }

    const [logs, total] = await Promise.all([
      EscalationLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      EscalationLog.countDocuments(filter),
    ]);

    const enrichedLogs = await Promise.all(
      logs.map(async (log) => {
        const user = await User.findById(log.userId).select("name profileImage");

        // Map to the UI's expected log format
        let severity: "INFO" | "WARNING" | "CRITICAL" = "INFO";
        if (log.riskLevel === "CRITICAL") severity = "CRITICAL";
        else if (log.riskLevel === "HIGH") severity = "WARNING";

        return {
          _id: log._id,
          timestamp: log.createdAt,
          category: "CRISIS" as const,
          severity,
          description: `${log.riskLevel} risk escalation for ${user?.name || "Unknown"} — ${log.outcome} (${log.escalationReason || "N/A"})`,
          operator: log.contactCalled || "System",
          riskLevel: log.riskLevel,
          outcome: log.outcome,
          userId: log.userId,
          sessionId: log.sessionId,
          userProfileImage: user?.profileImage || "",
        };
      })
    );

    res.json({
      logs: enrichedLogs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_LOGS] Logs error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch logs" });
  }
});

export default router;

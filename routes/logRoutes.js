// attendance-backend/routes/logRoutes.js
import express from "express";
import Log from "../models/Log.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * Helper: month/year filter on createdAt
 */
const buildDateRange = (month, year) => {
  if (!year) return null;

  const y = parseInt(year, 10);
  if (Number.isNaN(y)) return null;

  if (month) {
    const m = parseInt(month, 10) - 1;
    if (Number.isNaN(m)) return null;

    const from = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    const to = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
    return { $gte: from, $lt: to };
  }

  // whole year
  const from = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
  return { $gte: from, $lt: to };
};

/**
 * GET /api/logs?month=MM&year=YYYY
 * Only MANAGER can see logs.
 * Returns logs for the given month/year (or whole year if only year given).
 */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager"]), // <--- ONLY MANAGER
  async (req, res) => {
    try {
      const { month, year } = req.query;

      const filter = {};
      const createdAtRange = buildDateRange(month, year);
      if (createdAtRange) {
        filter.createdAt = createdAtRange;
      }

      const logs = await Log.find(filter)
        .sort({ createdAt: -1 })
        .limit(1500); // hard cap to avoid huge responses

      const mapped = logs.map((l) => ({
        id: l._id,
        time: l.createdAt,
        type: l.type, // LOGIN | LOGOUT | OPERATION | ERROR
        action: l.action,
        entity: l.entity, // AUTH | ATTENDANCE | EMPLOYEE | PROJECT | TASK | HOLIDAY | OTHER
        userId: l.user || null,
        role: l.role || l.userRole || "",
        userName: l.userName || "",
        userEmail: l.userEmail || "",
        description: l.description || "",
        status: l.status || "SUCCESS", // SUCCESS | FAILED | ERROR
        ipAddress: l.ipAddress || "",
        details: l.details || {}
      }));

      res.json(mapped);
    } catch (err) {
      console.error("Get logs error:", err);
      res.status(500).json({ message: "Error fetching logs" });
    }
  }
);

export default router;

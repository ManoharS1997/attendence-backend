import express from "express";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import {
  buildHolidayCalendar,
  countMandatoryPublicHolidays,
  countWeekendHolidays
} from "../utils/holidays.js";

const router = express.Router();

const buildDateFilter = (month, year) => {
  const filter = {};
  if (month && year) {
    const regex = new RegExp(`-${month}-${year}$`); // "DD-MM-YYYY"
    filter.date = { $regex: regex };
  } else if (year) {
    const regex = new RegExp(`-${year}$`);
    filter.date = { $regex: regex };
  }
  return filter;
};

const accumulateUsage = (records) => {
  let fullLeaves = 0;
  let halfDays = 0;
  let extraHours = 0;
  let compOffDays = 0;

  for (const r of records) {
    switch (r.status) {
      case "EMERGENCY LEAVE":
      case "CASUAL LEAVE":
      case "SICK LEAVE":
        fullLeaves += 1;
        break;
      case "PRESENT HALF DAY":
      case "Half Day - Fun Thursday":
      case "Half Day - Development":
        halfDays += 1;
        break;
      case "COMPOFF":
        compOffDays += 1;
        break;
      default:
        break;
    }
    
    // Add extra hours
    if (r.extraHoursWorked) {
      extraHours += (r.extraHoursWorked || 0) / 60;

    }
  }

  return { fullLeaves, halfDays, extraHours, compOffDays };
};

/**
 * Build monthly summary for one user.
 */
const buildSummary = (user, records, month, year) => {
  const { fullLeaves, halfDays, extraHours, compOffDays } = accumulateUsage(records);

  let weekendHolidays = user.weekendHolidays || 0;
  let mandatoryPublic = 0;

  if (month && year) {
    weekendHolidays = countWeekendHolidays(month, year);
    mandatoryPublic = countMandatoryPublicHolidays(month, year);
  }

  const optionalPublic = user.publicHolidays || 0;
  const publicHolidays = mandatoryPublic + optionalPublic;

  const totalEntitlement =
    (user.totalLeaveEntitlement || 0) + (user.carryForward2025 || 0);

  const leavesTaken = fullLeaves + halfDays * 0.5 - compOffDays;
  const balanceLeaves = totalEntitlement - fullLeaves + compOffDays;
  const balanceAfterHalfDays = totalEntitlement - leavesTaken;

  return {
    userId: user._id,
    fullName: user.fullName,
    email: user.email,

    totalLeaveEntitlement: user.totalLeaveEntitlement || 0,

    publicHolidays,
    weekendHolidays,
    carryForward2025: user.carryForward2025 || 0,

    leavesTaken,
    balanceLeaves,
    totalHalfDays: halfDays,
    compOffDays,
    extraHours,
    balanceAfterHalfDays,

    // NEW: Add year and month for frontend filtering
    year: year || new Date().getFullYear(),
    month: month || new Date().getMonth() + 1
  };
};

/**
 * GET /api/leave/summary/me?month=MM&year=YYYY
 * Employee – own monthly summary (view only)
 */
router.get("/summary/me", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const user = await User.findById(req.user.id);

    const filter = {
      user: user._id,
      ...buildDateFilter(month, year)
    };
    const records = await Attendance.find({
  ...filter,
  "managerDecision.status": "APPROVED"
});

    const summary = buildSummary(user, records, month, year);
    res.json(summary);
  } catch (err) {
    console.error("Leave summary me error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * NEW: GET /api/leave/years
 * Get list of available years from attendance records
 */
router.get("/years", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.role === "employee" ? req.user.id : req.query.userId;
    
    const records = await Attendance.find({ user: userId }).select("date");
    
    const yearsSet = new Set();
    records.forEach(record => {
      const year = record.date.split("-")[2];
      if (year) {
        yearsSet.add(parseInt(year));
      }
    });
    
    // Add current and previous years if none found
    const currentYear = new Date().getFullYear();
    yearsSet.add(currentYear);
    yearsSet.add(currentYear - 1);
    yearsSet.add(currentYear - 2);
    
    const years = Array.from(yearsSet).sort((a, b) => b - a); // Descending
    
    res.json(years);
  } catch (err) {
    console.error("Get years error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/leave/summary/all?month=MM&year=YYYY
 * Admin (view) & Manager (view+actions) – one summary per employee
 */
router.get(
  "/summary/all",
  authMiddleware,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;

      const employees = await User.find({ role: "employee" }).sort("fullName");
      if (!employees.length) return res.json([]);

      const filter = {
        user: { $in: employees.map((e) => e._id) },
        ...buildDateFilter(month, year)
      };

      const records = await Attendance.find(filter);

      const byUser = new Map();
      employees.forEach((u) => {
        byUser.set(u._id.toString(), []);
      });

      records.forEach((r) => {
        const key = r.user.toString();
        if (byUser.has(key)) {
          byUser.get(key).push(r);
        }
      });

      const summaries = employees.map((u) =>
        buildSummary(u, byUser.get(u._id.toString()) || [], month, year)
      );

      res.json(summaries);
    } catch (err) {
      console.error("Leave summary all error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * DELETE /api/leave/summary/:userId?month=MM&year=YYYY
 * Manager ONLY – delete all attendance for that employee
 * for the given month/year (effectively clearing that month's summary).
 */
router.delete(
  "/summary/:userId",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;
      const { userId } = req.params;

      if (!month || !year) {
        return res
          .status(400)
          .json({ message: "month and year are required" });
      }

      const filter = {
        user: userId,
        ...buildDateFilter(month, year)
      };

      const result = await Attendance.deleteMany(filter);

      res.json({
        message: "Monthly summary data cleared for employee",
        deletedCount: result.deletedCount
      });
    } catch (err) {
      console.error("Delete monthly summary error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * GET /api/leave/calendar?month=MM&year=YYYY
 * Simple holiday calendar for the selected month – same for all users.
 */
router.get("/calendar", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res
        .status(400)
        .json({ message: "month and year are required" });
    }

    const days = buildHolidayCalendar(month, year);
    res.json({ month, year, days });
  } catch (err) {
    console.error("Holiday calendar error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
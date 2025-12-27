// attendance-backend/routes/holidayRoutes.js
import express from "express";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import HolidaySetting from "../models/HolidaySetting.js";
import { countWorkingDaysInRange, calculateTotalEstimateHours, calculateDurationMonths } from "../utils/holidays.js";

const router = express.Router();

/**
 * POST /api/holidays/taken
 * Body: { dateKey, value, year, month }
 * Only MANAGER can change optional holiday Taken/Not Taken
 */
router.post(
  "/taken",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { dateKey, value, year, month } = req.body;

      if (!dateKey || !value) {
        return res
          .status(400)
          .json({ message: "dateKey and value are required" });
      }

      const status = value === "TAKEN" ? "TAKEN" : "NOT_TAKEN";

      const [yyyy, mm] = dateKey.split("-");
      const y = Number(year || yyyy);
      const m = Number(month || mm);

      const setting = await HolidaySetting.findOneAndUpdate(
        { dateKey },
        { dateKey, status, year: y, month: m },
        { new: true, upsert: true }
      );

      res.json(setting);
    } catch (err) {
      console.error("Save holiday taken error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * GET /api/holidays?month=MM&year=YYYY
 * Everyone (admin, manager, employee) can read
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const filter = {};
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);

    const items = await HolidaySetting.find(filter);
    res.json(items);
  } catch (err) {
    console.error("Get holidays error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/holidays/check?dateKey=YYYY-MM-DD
 * Check if a specific date is a holiday (considering TAKEN status)
 */
router.get("/check", authMiddleware, async (req, res) => {
  try {
    const { dateKey } = req.query;
    
    if (!dateKey) {
      return res.status(400).json({ message: "dateKey is required" });
    }
    
    // Check if it exists in HolidaySetting
    const setting = await HolidaySetting.findOne({ dateKey });
    
    if (setting) {
      return res.json({
        dateKey,
        status: setting.status,
        year: setting.year,
        month: setting.month,
        exists: true
      });
    }
    
    // Return NOT_TAKEN if not found
    res.json({
      dateKey,
      status: "NOT_TAKEN",
      exists: false
    });
  } catch (err) {
    console.error("Check holiday error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/holidays/working-days
 * Calculate working days between two dates
 * Query: startDate=DD-MM-YYYY&endDate=DD-MM-YYYY
 */
router.get("/working-days", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: "startDate and endDate are required" 
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ 
        message: "Invalid date format. Use DD-MM-YYYY" 
      });
    }
    
    // Parse dates for validation
    const parseDate = (dateStr) => {
      const [dd, mm, yyyy] = dateStr.split("-").map(Number);
      return new Date(yyyy, mm - 1, dd);
    };
    
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    
    if (end < start) {
      return res.status(400).json({ 
        message: "End date cannot be before start date" 
      });
    }
    
    // Calculate working days (excludes weekends and holidays)
    const workingDays = await countWorkingDaysInRange(startDate, endDate);
    
    // Calculate total estimate hours (working days × 8 hours)
    const totalEstimateHours = workingDays * 8;
    
    // Calculate duration in months
    const durationMonths = calculateDurationMonths(startDate, endDate);
    
    res.json({
      startDate,
      endDate,
      workingDays,
      totalEstimateHours,
      durationMonths,
      calculation: {
        workingDaysFormula: "Excludes: Sundays, 2nd Saturdays, Public Holidays, and Optional Holidays marked as TAKEN",
        totalEstimateHoursFormula: "Working days × 8 hours per day",
        durationMonthsFormula: "Months between start and end dates (inclusive)"
      }
    });
    
  } catch (err) {
    console.error("Calculate working days error:", err);
    res.status(500).json({ message: "Server error calculating working days" });
  }
});

/**
 * POST /api/holidays/calculate-project
 * Calculate project details from dates
 * Body: { startDate, endDate }
 */
router.post("/calculate-project", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: "startDate and endDate are required" 
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ 
        message: "Invalid date format. Use DD-MM-YYYY" 
      });
    }
    
    // Parse dates for validation
    const parseDate = (dateStr) => {
      const [dd, mm, yyyy] = dateStr.split("-").map(Number);
      return new Date(yyyy, mm - 1, dd);
    };
    
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    
    if (end < start) {
      return res.status(400).json({ 
        message: "End date cannot be before start date" 
      });
    }
    
    // Calculate working days (excludes weekends and holidays)
    const workingDays = await countWorkingDaysInRange(startDate, endDate);
    
    // Calculate total estimate hours (working days × 8 hours)
    const totalEstimateHours = workingDays * 8;
    
    // Calculate duration in months
    const durationMonths = calculateDurationMonths(startDate, endDate);
    
    res.json({
      startDate,
      endDate,
      workingDays,
      totalEstimateHours,
      durationMonths,
      breakdown: {
        workingDays,
        hoursPerDay: 8,
        totalEstimateHours,
        durationMonths
      },
      exclusions: [
        "Sundays",
        "2nd Saturdays",
        "Mandatory Public Holidays (Republic Day, Independence Day, Gandhi Jayanti)",
        "Optional Holidays marked as TAKEN by Manager"
      ],
      inclusions: [
        "Mondays to Fridays (except holidays)",
        "1st, 3rd, 4th, 5th Saturdays",
        "Optional Holidays marked as NOT TAKEN by Manager"
      ]
    });
    
  } catch (err) {
    console.error("Calculate project error:", err);
    res.status(500).json({ message: "Server error calculating project details" });
  }
});

export default router;
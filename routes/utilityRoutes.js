// routes/utilityRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import HolidaySetting from "../models/HolidaySetting.js";
import { 
  countWorkingDaysInRange, 
  calculateDurationMonths,
  isMandatoryPublicHoliday
} from "../utils/holidays.js";

const router = express.Router();

/**
 * Helper function to get holiday breakdown
 */
const getHolidayBreakdown = async (startStr, endStr) => {
  const parseDate = (dateStr) => {
    const [dd, mm, yyyy] = dateStr.split("-").map(Number);
    return new Date(yyyy, mm - 1, dd);
  };
  
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  
  let sundays = 0;
  let secondSaturdays = 0;
  let mandatoryHolidays = 0;
  let optionalHolidaysTaken = 0;
  let optionalHolidaysNotTaken = 0;
  
  const cursor = new Date(start);
  
  while (cursor <= end) {
    const yyyy = cursor.getFullYear();
    const mm = String(cursor.getMonth() + 1).padStart(2, "0");
    const dd = String(cursor.getDate()).padStart(2, "0");
    const dateStr = `${dd}-${mm}-${yyyy}`;
    const dateKey = `${yyyy}-${mm}-${dd}`;
    
    // Check Sunday
    if (cursor.getDay() === 0) {
      sundays++;
    }
    
    // Check 2nd Saturday
    const dayOfMonth = cursor.getDate();
    const weekIndex = Math.floor((dayOfMonth - 1) / 7);
    if (cursor.getDay() === 6 && weekIndex === 1) {
      secondSaturdays++;
    }
    
    // Check mandatory holiday
    if (isMandatoryPublicHoliday(dateStr)) {
      mandatoryHolidays++;
    }
    
    // Check optional holiday
    const holidaySetting = await HolidaySetting.findOne({ dateKey });
    if (holidaySetting) {
      if (holidaySetting.status === "TAKEN") {
        optionalHolidaysTaken++;
      } else {
        optionalHolidaysNotTaken++;
      }
    }
    
    cursor.setDate(cursor.getDate() + 1);
  }
  
  return {
    sundays,
    secondSaturdays,
    mandatoryHolidays,
    optionalHolidays: {
      taken: optionalHolidaysTaken,
      notTaken: optionalHolidaysNotTaken,
      total: optionalHolidaysTaken + optionalHolidaysNotTaken
    },
    totalNonWorkingDays: sundays + secondSaturdays + mandatoryHolidays + optionalHolidaysTaken
  };
};

/* ======================== ROUTES ======================== */

/**
 * POST /api/utils/calculate-dates
 * Calculate working days, total hours, and duration between dates
 */
router.post("/calculate-dates", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: "startDate and endDate are required" 
      });
    }
    
    // Validate date format (DD-MM-YYYY)
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
    
    if (!start || !end) {
      return res.status(400).json({ 
        message: "Invalid dates provided" 
      });
    }
    
    if (end < start) {
      return res.status(400).json({ 
        message: "End date cannot be before start date" 
      });
    }
    
    // Calculate working days (excludes all holidays)
    const workingDays = await countWorkingDaysInRange(startDate, endDate);
    
    // Calculate total estimate hours (working days × 8 hours)
    const totalEstimateHours = workingDays * 8;
    
    // Calculate duration in months
    const durationMonths = calculateDurationMonths(startDate, endDate);
    
    // Get holiday breakdown
    const holidayBreakdown = await getHolidayBreakdown(startDate, endDate);
    
    res.json({
      success: true,
      data: {
        startDate,
        endDate,
        workingDays,
        totalEstimateHours,
        durationMonths,
        calculation: {
          workingDaysFormula: "Excludes: Sundays, 2nd Saturdays, Public Holidays, Optional Holidays marked as TAKEN",
          totalHoursFormula: `Working days (${workingDays}) × 8 hours per day`,
          durationFormula: `${durationMonths} months between dates`
        },
        holidayBreakdown,
        summary: {
          totalDays: Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1,
          workingDays,
          nonWorkingDays: (Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1) - workingDays,
          dailyHours: 8,
          monthlyAverageHours: durationMonths > 0 ? totalEstimateHours / durationMonths : 0
        }
      }
    });
    
  } catch (err) {
    console.error("Calculate dates error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error calculating dates" 
    });
  }
});

/**
 * GET /api/utils/working-days
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
    
    const workingDays = await countWorkingDaysInRange(startDate, endDate);
    const totalHours = workingDays * 8;
    
    res.json({
      startDate,
      endDate,
      workingDays,
      totalEstimateHours: totalHours,
      calculation: `Working days (${workingDays}) × 8 hours = ${totalHours} hours`
    });
    
  } catch (err) {
    console.error("Get working days error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/utils/dashboard
 * Employee dashboard auto-summary
 */
router.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const records = await Attendance.find({
      user: userId,
      "managerDecision.status": "APPROVED"
    });

    let presentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let totalHoursWorked = 0;
    let totalExtraHours = 0;

    records.forEach(r => {
      if (r.status === "PRESENT FULL DAY") presentDays++;
      if (r.status === "PRESENT HALF DAY") halfDays++;
      if (["CASUAL LEAVE", "EMERGENCY LEAVE", "SICK LEAVE"].includes(r.status)) {
        leaveDays++;
      }
      totalHoursWorked += r.hoursWorked || 0;
      totalExtraHours += r.extraHoursWorked || 0;
    });

    const user = await User.findById(userId).select(
      "casualLeaveBalance emergencyLeaveBalance sickLeaveBalance compOffBalance"
    );

    res.json({
      attendance: {
        presentDays,
        halfDays,
        leaveDays,
        totalRecords: records.length
      },
      timesheet: {
        totalHoursWorked,
        totalExtraHours
      },
      leaveBalance: {
        casual: user.casualLeaveBalance,
        emergency: user.emergencyLeaveBalance,
        sick: user.sickLeaveBalance,
        compOff: user.compOffBalance
      }
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ message: "Dashboard error" });
  }
});

/**
 * GET /api/utils/attendance-report?month=MM&year=YYYY
 * Get detailed attendance report for logged-in user
 */
router.get("/attendance-report", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;

    const filter = {
      user: req.user.id,
      "managerDecision.status": "APPROVED"
    };

    // Add month/year filter if provided
    if (month && year) {
      filter.date = { $regex: `-${String(month).padStart(2, "0")}-${year}$` };
    }

    const records = await Attendance.find(filter)
      .sort({ date: 1 })
      .select("date status workInTime workOutTime hoursWorked extraHoursWorked note");

    // Calculate summary statistics
    let presentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let totalHours = 0;
    let totalExtraHours = 0;

    records.forEach(r => {
      if (r.status === "PRESENT FULL DAY") presentDays++;
      if (r.status === "PRESENT HALF DAY") halfDays++;
      if (["CASUAL LEAVE", "EMERGENCY LEAVE", "SICK LEAVE"].includes(r.status)) {
        leaveDays++;
      }
      totalHours += r.hoursWorked || 0;
      totalExtraHours += r.extraHoursWorked || 0;
    });

    res.json({
      summary: {
        totalDays: records.length,
        presentDays,
        halfDays,
        leaveDays,
        totalHours,
        totalExtraHours
      },
      records,
      period: month && year ? `${month}/${year}` : "All Time"
    });
  } catch (err) {
    console.error("Attendance report error:", err);
    res.status(500).json({ message: "Attendance report error" });
  }
});

/**
 * GET /api/utils/leave-balance
 * Get current leave balances for logged-in user
 */
router.get("/leave-balance", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "casualLeaveBalance emergencyLeaveBalance sickLeaveBalance compOffBalance"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      casualLeave: user.casualLeaveBalance,
      emergencyLeave: user.emergencyLeaveBalance,
      sickLeave: user.sickLeaveBalance,
      compOff: user.compOffBalance,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error("Leave balance error:", err);
    res.status(500).json({ message: "Error fetching leave balance" });
  }
});

export default router;
import express from "express";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import AttendanceRequest from "../models/AttendanceRequest.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";

const router = express.Router();

/* ======================== HELPER FUNCTIONS ======================== */

/**
 * Convert time string to minutes
 */
const toMinutes = (time) => {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Get client IP address from request headers
 */
const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

/**
 * Build date filter for MongoDB queries
 */
const buildDateFilter = (month, year) => {
  const filter = {};
  if (month && year) {
    filter.date = { $regex: `-${String(month).padStart(2, "0")}-${year}$` };
  } else if (year) {
    filter.date = { $regex: `-${year}$` };
  }
  return filter;
};

/**
 * Get today's date in DD-MM-YYYY format
 */
const todayString = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

/**
 * Check if a status is considered a leave status
 */
// ✅ FIXED: Correct leave statuses only
const LEAVE_STATUSES = [
  "CASUAL LEAVE",
  "EMERGENCY LEAVE",
  "SICK LEAVE",
  "ABSENT",
  "PUBLIC HOLIDAY",
  "SUNDAY",
  "2ND SATURDAY"
];

/**
 * Check if a status is considered a leave status
 */
const isLeaveStatus = (status) => LEAVE_STATUSES.includes(status);

/**
 * Normalize frontend half-day status to backend enum
 */
const normalizeStatus = (status) => {
  if (status === "Half Day - Fun Thursday") {
    return { status: "PRESENT HALF DAY", halfDayType: "FUN" };
  }

  if (status === "Half Day - Development") {
    return { status: "PRESENT HALF DAY", halfDayType: "DEVELOPMENT" };
  }

  return { status, halfDayType: null };
};


/**
 * Create log entry for auditing
 */
const createLog = async (logData) => {
  try {
    await Log.create(logData);
  } catch (logErr) {
    console.error("Log creation error:", logErr.message);
  }
};

// ✅ FIXED CONSTANTS - REMOVE DAILY_WORK_MIN
const OFFICE_START_MIN = 10 * 60; // 10:00
const OFFICE_END_MIN = 18 * 60;   // 18:00
const OFFICE_GROSS_MIN = 8 * 60;  // ✅ ADDED: 8 hours gross office time
const HALF_DAY_MIN = 3 * 60;      // 3 hours for half day

/* ======================== ROUTES ======================== */

/* ------------------------ POST /api/attendance ------------------------ */
/**
 * Employee marks/updates attendance for a day
 * Auto-approves same-day present full day
 * Other statuses require manager approval
 */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
  date,
  status: rawStatus,
  workInTime,
  workOutTime,
  lunchInTime,
  lunchOutTime,
  note,
  extraWork
} = req.body;

const normalized = normalizeStatus(rawStatus);
const status = normalized.status;
const halfDayType = normalized.halfDayType;


    // Validate required fields
    if (!date || !status) {
      return res.status(400).json({ message: "Date and status required" });
    }

    // ✅ Calculate lunch minutes from lunchInTime/lunchOutTime
    let lunchBreakMinutes = 0;
    if (lunchInTime && lunchOutTime) {
      const lunchInMin = toMinutes(lunchInTime);
      const lunchOutMin = toMinutes(lunchOutTime);
      
      if (lunchInMin !== null && lunchOutMin !== null && lunchOutMin > lunchInMin) {
        lunchBreakMinutes = lunchOutMin - lunchInMin;
      }
    }

    // ✅ Half day validation - NO LUNCH allowed
    if (status === "PRESENT HALF DAY" && lunchBreakMinutes > 0) {
      return res.status(400).json({ 
        message: "Lunch not allowed for half day attendance" 
      });
    }

    const existing = await Attendance.findOne({
      user: req.user.id,
      date
    });

    // Check if attendance is locked
    if (existing?.isLocked) {
      return res.status(403).json({
        message: "Attendance locked after manager approval"
      });
    }

    const isToday = date === todayString();
    const leaveLike = isLeaveStatus(status);

    // ✅ Calculate worked minutes with CORRECT formula
    let workedMinutes = 0;
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let extraMinutesWorked = 0; // ✅ NEW: Extra minutes beyond 8 hours

    if (workInTime && workOutTime) {
      const inMin = toMinutes(workInTime);
      const outMin = toMinutes(workOutTime);

      if (inMin !== null && outMin !== null) {
        // ✅ CORRECT FORMULA: Gross minutes minus lunch minutes
        const grossMinutes = outMin - inMin;
        const lunchMinutes = lunchInTime && lunchOutTime ? 
          (toMinutes(lunchOutTime) - toMinutes(lunchInTime)) : 0;
        
        workedMinutes = grossMinutes - lunchMinutes;

        // Calculate late minutes
        if (inMin > OFFICE_START_MIN) {
          lateMinutes = inMin - OFFICE_START_MIN;
        }

        // Calculate early leave minutes
        if (outMin < OFFICE_END_MIN) {
          earlyLeaveMinutes = OFFICE_END_MIN - outMin;
        }

        // ✅ FIXED: Extra minutes calculation - beyond 8 hours gross
        extraMinutesWorked = Math.max(0, workedMinutes - OFFICE_GROSS_MIN);
      }
    }

    // ✅ CRITICAL FIX: Leave days AND COMPOFF NEVER count hours
    if (isLeaveStatus(status) || status === "COMPOFF") {
      workedMinutes = 0;
      lateMinutes = 0;
      earlyLeaveMinutes = 0;
      extraMinutesWorked = 0;
    }

    let hoursWorked = workedMinutes / 60; // ✅ Hours as decimal
    let extraHoursWorked = extraMinutesWorked / 60; // ✅ Extra hours as decimal

    // ✅ Ensure zero hours for leaves even after calculation
    if (isLeaveStatus(status) || status === "COMPOFF") {
      hoursWorked = 0;
      extraHoursWorked = 0;
    }

    // ✅ Half day validation - must work minimum 3 hours
    if (status === "PRESENT HALF DAY" && workedMinutes < HALF_DAY_MIN) {
      return res.status(400).json({ 
        message: "Half day requires minimum 3 working hours" 
      });
    }

    // ✅ FIXED: Auto approve only SAME DAY full day present
    // Changed from hoursWorked >= DAILY_WORK_MIN/60 to hoursWorked > 0
    if (
      !existing &&
      isToday &&
      status === "PRESENT FULL DAY" &&
      hoursWorked > 0  // ✅ FIXED: Changed from DAILY_WORK_MIN/60 to > 0
    ) {
      const record = await Attendance.create({
        user: req.user.id,
        date,
        status,
        workInTime,
        workOutTime,
        lunchInTime,       // ✅ Store lunch in
        lunchOutTime,      // ✅ Store lunch out
        lunchBreakMinutes, // ✅ Keep backward compatibility
        lateMinutes,
        earlyLeaveMinutes,
        hoursWorked,       // ✅ Use calculated hours
        extraMinutesWorked, // ✅ Store extra minutes
        extraHoursWorked,   // ✅ Store extra hours
        extraHoursApproved: false,
        compOffDaysEarned: 0,
        isLeaveRequest: false,
        note,
        managerDecision: {
          status: "APPROVED",
          decidedBy: req.user.id,
          decidedAt: new Date(),
          comment: "Self-marked present full day (auto-approved)"
        }
      });

      // Extra hours need approval for comp-off (if at least 1 hour)
      if (extraHoursWorked >= 1) {
        await AttendanceRequest.create({
          user: req.user.id,
          attendance: record._id,
          date,
          type: "UPDATE",
          toStatus: "EXTRA_HOURS",
          extraHours: extraHoursWorked,
          status: "PENDING"
        });
      }

      // Log the action
      await createLog({
        type: "OPERATION",
        action: "MARK_ATTENDANCE",
        entity: "ATTENDANCE",
        user: req.user.id,
        userName: req.user.fullName,
        userEmail: req.user.email,
        role: req.user.role,
        description: `Marked attendance as ${status} on ${date}`,
        status: "SUCCESS",
        ipAddress: getClientIp(req),
        details: { date, status, extraHoursWorked }
      });

      return res.json({ 
        message: "Attendance marked", 
        record 
      });
    }

    // All other cases → manager approval
    const requestPayload = {
      user: req.user.id,
      date,
      type: existing ? "UPDATE" : "CREATE",
      toStatus: status,
      toWorkInTime: workInTime || "",
      toWorkOutTime: workOutTime || "",
      toLunchInTime: lunchInTime || "",    // ✅ Include lunch in
      toLunchOutTime: lunchOutTime || "",  // ✅ Include lunch out
      lunchBreakMinutes,
      halfDayType,
      note: note || "",
      calculated: {
        hoursWorked,
        extraHoursWorked,
        extraMinutesWorked, // ✅ Include extra minutes
        lateMinutes,
        earlyLeaveMinutes
      },
      status: "PENDING"
    };

    if (existing) {
      requestPayload.attendance = existing._id;
      requestPayload.fromStatus = existing.status;
    }

    // Handle extra hours or comp-off
    if (status === "COMPOFF") {
      requestPayload.extraWork = extraWork || null;
    } else if (status === "PRESENT FULL DAY" && extraHoursWorked > 0) {
      requestPayload.extraHours = extraHoursWorked;
    }

    const requestDoc = await AttendanceRequest.create(requestPayload);

    // Log the request creation
    await createLog({
      type: "OPERATION",
      action: "ATTENDANCE_REQUEST_CREATE",
      entity: "ATTENDANCE_REQUEST",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: `Created attendance request for ${date} -> ${status}`,
      status: "SUCCESS",
      ipAddress: getClientIp(req),
      details: {
        requestId: requestDoc._id,
        date,
        toStatus: status,
        type: requestDoc.type,
        extraHours: extraHoursWorked
      }
    });

    res.status(202).json({
      message: "Request sent for manager approval",
      requestId: requestDoc._id
    });
  } catch (err) {
    console.error("Save attendance error:", err);
    await createLog({
      type: "ERROR",
      action: "MARK_ATTENDANCE",
      entity: "ATTENDANCE",
      user: req.user?.id,
      userName: req.user?.fullName,
      userEmail: req.user?.email,
      role: req.user?.role,
      description: "Failed to save attendance",
      status: "FAILED",
      ipAddress: getClientIp(req),
      details: { error: err.message }
    });
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------ POST /api/attendance/extra-hours ------------------------ */
/**
 * Employee requests extra hours approval for comp-off
 */
router.post("/extra-hours", authMiddleware, async (req, res) => {
  try {
    const { date, extraHours, reason } = req.body;

    if (!date || !extraHours || extraHours <= 0) {
      return res.status(400).json({ 
        message: "Valid date and positive extra hours are required" 
      });
    }

    const attendance = await Attendance.findOne({
      user: req.user.id,
      date
    });

    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    // Create extra hours approval request
    const request = await AttendanceRequest.create({
      user: req.user.id,
      attendance: attendance._id,
      date,
      type: "UPDATE",
      fromStatus: attendance.status,
      toStatus: "COMPOFF",
      extraHours,
      extraWork: {
        workedDate: date,
        hours: extraHours,
        compOffDate: "",
        compOffTime: "",
        reason: reason || ""
      },
      note: `Extra hours approval requested: ${extraHours} hours. Reason: ${reason || "No reason provided"}`,
      status: "PENDING"
    });

    // Update attendance with extra hours (DO NOT reset existing hours)
    attendance.extraHoursWorked = (attendance.extraHoursWorked || 0) + extraHours;
    attendance.isLeaveRequest = true;
    await attendance.save();

    await createLog({
      type: "OPERATION",
      action: "EXTRA_HOURS_REQUEST",
      entity: "ATTENDANCE",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: `Requested ${extraHours} extra hours approval for ${date}`,
      status: "SUCCESS",
      ipAddress: getClientIp(req),
      details: {
        date,
        extraHours,
        reason
      }
    });

    res.status(201).json({
      message: "Extra hours approval request submitted",
      requestId: request._id
    });

  } catch (err) {
    console.error("Extra hours request error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------ GET /api/attendance/extra-hours/:userId ------------------------ */
/**
 * Get total extra hours for an employee
 * IMPORTANT: Sum ALL extraHoursWorked, not just approved ones
 */
router.get("/extra-hours", authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { month, year } = req.query;

    // Check permissions
    if (req.user.role === "employee" && req.user.id !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const filter = { user: userId };
    if (month && year) {
      filter.date = { $regex: `-${String(month).padStart(2, "0")}-${year}$` };
    }

    const records = await Attendance.find(filter);

    // ✅ Sum ALL extraHoursWorked, not just approved ones
    const totalExtraHours = records.reduce((sum, record) => 
      sum + (record.extraHoursWorked || 0), 0
    );

    const approvedExtraHours = records.reduce((sum, record) => 
      sum + (record.extraHoursApproved ? (record.extraHoursWorked || 0) : 0), 0
    );

    const pendingExtraHours = totalExtraHours - approvedExtraHours;
    const compOffBalance = approvedExtraHours / 8; // Convert hours to comp-off days

    const extraHoursRecords = records
      .filter(r => r.extraHoursWorked > 0)
      .map(r => ({
        date: r.date,
        hours: r.extraHoursWorked,
        approved: r.extraHoursApproved,
        status: r.status,
        compOffDaysEarned: r.compOffDaysEarned || 0
      }));

    res.json({
      totalExtraHours,
      approvedExtraHours,
      pendingExtraHours,
      compOffBalance,
      records: extraHoursRecords
    });

  } catch (err) {
    console.error("Get extra hours error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------ GET /api/attendance/my ------------------------ */
/**
 * Get logged-in user's attendance records
 */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const filter = {
      user: req.user.id,
      ...buildDateFilter(month, year)
    };

    const records = await Attendance.find({
      ...filter,
      $or: [
        { "managerDecision.status": "APPROVED" },
        { managerDecision: { $exists: false } }
      ]
    }).sort({ date: 1 });

    res.json(records);
  } catch (err) {
    console.error("My attendance error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------ GET /api/attendance ------------------------ */
/**
 * Get all attendance records (manager/admin only)
 */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;
      const filter = buildDateFilter(month, year);

      const records = await Attendance.find(filter)
        .populate("user", "fullName email role department")
        .sort({ date: 1 });

      res.json(records);
    } catch (err) {
      console.error("All attendance error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ------------------------ GET /api/attendance/requests ------------------------ */
/**
 * Get pending attendance/leave change requests (manager only)
 */
router.get(
  "/requests",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const pending = await AttendanceRequest.find({ status: "PENDING" })
        .populate("user", "fullName email role department")
        .populate("attendance")
        .sort({ createdAt: 1 });

      // ✅ SAFETY FIX: remove broken requests with missing user
      const safePending = pending.filter(r => r.user);

      res.json(safePending);
    } catch (err) {
      console.error("List attendance requests error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ------------------------ PATCH /api/attendance/requests/:id/decision ------------------------ */
/**
 * Manager approves/rejects an attendance request
 */
router.patch(
  "/requests/:id/decision",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { decision, comment } = req.body;

      if (!["APPROVED", "REJECTED"].includes(decision)) {
        return res.status(400).json({ message: "Invalid decision value" });
      }

      const request = await AttendanceRequest.findById(id)
        .populate("attendance")
        .populate("user");

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      let attendanceDoc = null;

      // Try to find or create attendance record
      if (request.attendance) {
        attendanceDoc = request.attendance;
      }

      if (!attendanceDoc && request.user && request.date) {
        const userId = request.user._id || request.user;
        attendanceDoc = await Attendance.findOne({
          user: userId,
          date: request.date
        });
      }

      // Create new attendance record if approved and not found
      if (!attendanceDoc && decision === "APPROVED") {
        const userId = request.user._id || request.user;
        attendanceDoc = await Attendance.create({
          user: userId,
          date: request.date,
          status: request.toStatus,
          workInTime: request.toWorkInTime || "",
          workOutTime: request.toWorkOutTime || "",
          lunchInTime: request.toLunchInTime || "",      // ✅ Store lunch in
          lunchOutTime: request.toLunchOutTime || "",    // ✅ Store lunch out
          lunchBreakMinutes: request.lunchBreakMinutes || 0,
          lateMinutes: request.calculated?.lateMinutes || 0,
          earlyLeaveMinutes: request.calculated?.earlyLeaveMinutes || 0,
          hoursWorked: request.calculated?.hoursWorked || 0,
          extraMinutesWorked: request.calculated?.extraMinutesWorked || 0, // ✅ Store extra minutes
          extraHoursWorked: request.extraHours || (request.calculated?.extraHoursWorked || 0),
          note: request.note || "",
          extraHoursApproved: decision === "APPROVED",
          compOffDaysEarned: 0,
          isLeaveRequest: isLeaveStatus(request.toStatus),
          halfDayType: request.halfDayType || null,
          extraWork: (request.toStatus === "COMPOFF" && request.extraWork)
            ? request.extraWork
            : undefined,
          managerDecision: {
            status: decision,
            decidedBy: req.user.id,
            decidedAt: new Date(),
            comment: comment || request.note || ""
          }
        });
      }

      // Apply decision to existing attendance record
      if (attendanceDoc) {
        if (decision === "APPROVED") {
          // Update status and other fields
          attendanceDoc.status = request.toStatus;
          attendanceDoc.workInTime = request.toWorkInTime || attendanceDoc.workInTime;
          attendanceDoc.workOutTime = request.toWorkOutTime || attendanceDoc.workOutTime;
          attendanceDoc.lunchInTime = request.toLunchInTime || attendanceDoc.lunchInTime;     // ✅ Update lunch in
          attendanceDoc.lunchOutTime = request.toLunchOutTime || attendanceDoc.lunchOutTime;  // ✅ Update lunch out
          attendanceDoc.lunchBreakMinutes = request.lunchBreakMinutes || attendanceDoc.lunchBreakMinutes;
          attendanceDoc.note = request.note || attendanceDoc.note;
          attendanceDoc.halfDayType = request.halfDayType || attendanceDoc.halfDayType;
          attendanceDoc.isLeaveRequest = isLeaveStatus(request.toStatus);

          // ✅ Handle extra hours and comp-off calculation
          // DO NOT modify extraHoursWorked - keep daily hours intact
          if (request.extraHours) {
            const fullCompOffDays = Math.floor(request.extraHours / 8);

            attendanceDoc.compOffDaysEarned =
              (attendanceDoc.compOffDaysEarned || 0) + fullCompOffDays;

            // ❗ DO NOT change extraHoursWorked here - it stays as daily worked hours
            attendanceDoc.extraHoursApproved = true;
          }

          if (request.toStatus === "COMPOFF" && request.extraWork) {
            attendanceDoc.extraWork = request.extraWork;
            attendanceDoc.extraHoursApproved = true;
          }

          // ✅ COMP-OFF CREDIT RULE
          if (
            request.calculated?.extraHoursWorked >= 1 &&
            request.toStatus === "PRESENT FULL DAY"
          ) {
            await User.findByIdAndUpdate(request.user._id, {
              $inc: { compOffBalance: 1 }
            });
          }

          // 🔐 LOCK for half day & leave
          if (
            request.toStatus === "PRESENT HALF DAY" ||
            isLeaveStatus(request.toStatus)
          ) {
            attendanceDoc.isLocked = true;
          }

        } else if (decision === "REJECTED") {
          // Reset approval status but keep worked hours
          if (request.extraHours) {
            // Keep extraHoursWorked as is (they were actually worked)
            // Only mark as not approved for comp-off
            attendanceDoc.extraHoursApproved = false;
          }
        }

        // Update calculated fields if available
        if (request.calculated) {
          attendanceDoc.lateMinutes = request.calculated.lateMinutes || attendanceDoc.lateMinutes;
          attendanceDoc.earlyLeaveMinutes = request.calculated.earlyLeaveMinutes || attendanceDoc.earlyLeaveMinutes;
          attendanceDoc.hoursWorked = request.calculated.hoursWorked || attendanceDoc.hoursWorked;
          attendanceDoc.extraMinutesWorked = request.calculated.extraMinutesWorked || attendanceDoc.extraMinutesWorked;
          attendanceDoc.extraHoursWorked = request.calculated.extraHoursWorked || attendanceDoc.extraHoursWorked;
        }

        // ✅ CRITICAL FIX: Ensure leave days AND COMPOFF do not carry hours
        if (isLeaveStatus(request.toStatus) || request.toStatus === "COMPOFF") {
          attendanceDoc.hoursWorked = 0;
          attendanceDoc.extraMinutesWorked = 0;
          attendanceDoc.extraHoursWorked = 0;
          attendanceDoc.lateMinutes = 0;
          attendanceDoc.earlyLeaveMinutes = 0;
        }

        // Update manager decision
        attendanceDoc.managerDecision = {
          status: decision,
          decidedBy: req.user.id,
          decidedAt: new Date(),
          comment: comment || request.note || ""
        };

        await attendanceDoc.save();
      }

      // Update request status
      request.status = decision;
      request.decidedBy = req.user.id;
      request.decisionAt = new Date();
      await request.save();

      // Log the decision
      await createLog({
        type: "OPERATION",
        action: "ATTENDANCE_REQUEST_DECISION",
        entity: "ATTENDANCE_REQUEST",
        user: req.user.id,
        userName: req.user.fullName,
        userEmail: req.user.email,
        role: req.user.role,
        description: `Manager ${decision.toLowerCase()} attendance request on ${request.date} -> ${request.toStatus}`,
        status: "SUCCESS",
        ipAddress: getClientIp(req),
        details: {
          requestId: request._id,
          decision,
          date: request.date,
          toStatus: request.toStatus,
          employeeId: request.user._id,
          employeeName: request.user.fullName
        }
      });

      return res.json({
        message: attendanceDoc
          ? "Decision applied successfully"
          : "Decision stored, but attendance record could not be created"
      });

    } catch (err) {
      console.error("Decision on attendance request error:", err);
      return res.status(400).json({ 
        message: err.message || "Error applying decision" 
      });
    }
  }
);

/* ------------------------ DELETE /api/attendance/:id ------------------------ */
/**
 * Delete attendance record (manager only)
 */
router.delete(
  "/:id",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      const record = await Attendance.findByIdAndDelete(req.params.id)
        .populate("user", "fullName email role department");

      if (!record) {
        return res.status(404).json({ message: "Attendance record not found" });
      }

      // Delete associated attendance requests
      await AttendanceRequest.deleteMany({ attendance: record._id });

      // Log the deletion
      await createLog({
        type: "OPERATION",
        action: "ATTENDANCE_DELETE",
        entity: "ATTENDANCE",
        user: req.user.id,
        userName: req.user.fullName,
        userEmail: req.user.email,
        role: req.user.role,
        description: `Deleted attendance for ${record.user?.fullName || "employee"} on ${record.date}`,
        status: "SUCCESS",
        ipAddress: getClientIp(req),
        details: {
          attendanceId: record._id,
          employeeId: record.user?._id,
          employeeEmail: record.user?.email,
          date: record.date
        }
      });

      res.json({ 
        message: "Attendance record deleted successfully",
        deletedRecord: record
      });

    } catch (err) {
      console.error("Delete attendance error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
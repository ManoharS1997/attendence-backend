// routes/attendanceRoutes.js
import express from "express";
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import AttendanceRequest from "../models/AttendanceRequest.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";

const router = express.Router();

/* ------------------------ helpers ------------------------ */

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

const buildDateFilter = (month, year) => {
  const filter = {};
  if (month && year) {
    const regex = new RegExp(`-${month}-${year}$`);
    filter.date = { $regex: regex };
  } else if (year) {
    const regex = new RegExp(`-${year}$`);
    filter.date = { $regex: regex };
  }
  return filter;
};

const todayString = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

const isLeaveStatus = (status) =>
  [
    "EMERGENCY LEAVE",
    "CASUAL LEAVE",
    "PRESENT HALF DAY",
    "Half Day - Fun Thursday",
    "Half Day - Development",
    "COMPOFF",
    "ABSENT"
  ].includes(status);

/* ------------------------ POST /api/attendance ------------------------ */
/**
 * Employee marks / updates attendance for a day
 */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { date, status, workInTime, workOutTime, note, extraWork } = req.body;

    const existing = await Attendance.findOne({
      user: req.user.id,
      date
    });

    const isToday = date === todayString();
    const leaveLike = isLeaveStatus(status);

    // 1) simple same-day present (no approval required)
    if (!existing && isToday && !leaveLike && status === "PRESENT FULL DAY") {
      const payload = {
        user: req.user.id,
        date,
        status,
        workInTime,
        workOutTime,
        note,
        isLeaveRequest: false,
        managerDecision: {
          status: "APPROVED",
          decidedBy: req.user.id,
          decidedAt: new Date(),
          comment: "Self-marked present full day (auto-approved)"
        }
      };

      const record = await Attendance.create(payload);

      try {
        await Log.create({
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
          details: { date, status }
        });
      } catch (logErr) {
        console.error("Log MARK_ATTENDANCE error:", logErr.message);
      }

      return res.status(201).json({
        message: "Attendance saved",
        record
      });
    }

    // 2) everything else => AttendanceRequest (PENDING)
    const requestPayload = {
      user: req.user.id,
      date,
      type: existing ? "UPDATE" : "CREATE",
      toStatus: status,
      toWorkInTime: workInTime,
      toWorkOutTime: workOutTime,
      note
    };

    if (existing) {
      requestPayload.attendance = existing._id;
      requestPayload.fromStatus = existing.status;
      requestPayload.fromWorkInTime = existing.workInTime;
      requestPayload.fromWorkOutTime = existing.workOutTime;
    }

    if (status === "COMPOFF") {
      requestPayload.extraWork = extraWork || null;
    }

    const requestDoc = await AttendanceRequest.create(requestPayload);

    try {
      await Log.create({
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
          type: requestDoc.type
        }
      });
    } catch (logErr) {
      console.error("Log ATTENDANCE_REQUEST_CREATE error:", logErr.message);
    }

    return res.status(202).json({
      message:
        "Attendance / leave change sent to Manager for approval. It will reflect in dashboard after approval.",
      requestId: requestDoc._id
    });
  } catch (err) {
    console.error("Save attendance error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------ GET /api/attendance/my ------------------------ */

router.get("/my", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.query;
    const filter = {
      user: req.user.id,
      ...buildDateFilter(month, year)
    };

    const records = await Attendance.find(filter).sort({ date: 1 });
    res.json(records);
  } catch (err) {
    console.error("My attendance error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ------------------------ GET /api/attendance (manager/admin) ------------------------ */

router.get(
  "/",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;
      const filter = buildDateFilter(month, year);

      const records = await Attendance.find(filter)
        .populate("user")
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
 * Manager – list PENDING attendance / leave change requests
 */
router.get(
  "/requests",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const pending = await AttendanceRequest.find({ status: "PENDING" })
        .populate("user", "fullName email role")
        .sort({ createdAt: 1 });

      res.json(pending);
    } catch (err) {
      console.error("List attendance requests error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ------------------------ PATCH /api/attendance/requests/:id/decision ------------------------ */

router.patch(
  "/requests/:id/decision",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { decision } = req.body; // "APPROVED" or "REJECTED"

      if (!["APPROVED", "REJECTED"].includes(decision)) {
        return res.status(400).json({ message: "Invalid decision value" });
      }

      // Load the request with as much info as possible
      const request = await AttendanceRequest.findById(id)
        .populate("attendance")
        .populate("user");

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      let attendanceDoc = null;

      // 1) direct ref
      if (request.attendance) {
        attendanceDoc = request.attendance;
      }

      // 2) fallback by user+date
      if (!attendanceDoc && request.user && request.date) {
        const userId = request.user._id || request.user;
        attendanceDoc = await Attendance.findOne({
          user: userId,
          date: request.date
        });
      }

      // 3) if still not found and APPROVED, create a new Attendance record
      if (!attendanceDoc && decision === "APPROVED") {
        const userId = request.user._id || request.user;
        attendanceDoc = await Attendance.create({
          user: userId,
          date: request.date,
          status: request.toStatus,
          workInTime: request.toWorkInTime || "",
          workOutTime: request.toWorkOutTime || "",
          note: request.note || "",
          isLeaveRequest: isLeaveStatus(request.toStatus),
          extraWork:
            request.toStatus === "COMPOFF" && request.extraWork
              ? request.extraWork
              : undefined,
          managerDecision: {
            status: "APPROVED",
            decidedBy: req.user._id,
            decidedAt: new Date(),
            comment: request.note || ""
          }
        });
      }

      // ---- APPLY DECISION ON ATTENDANCE (if we have one) ----
      if (attendanceDoc) {
        if (decision === "APPROVED") {
          if (request.toStatus) {
            attendanceDoc.status = request.toStatus;
          }

          if (request.toStatus === "COMPOFF" && request.extraWork) {
            attendanceDoc.extraWork = request.extraWork;
            attendanceDoc.isLeaveRequest = true;
          } else if (isLeaveStatus(request.toStatus)) {
            attendanceDoc.isLeaveRequest = true;
          }

          attendanceDoc.managerDecision = {
            status: "APPROVED",
            decidedBy: req.user._id,
            decidedAt: new Date(),
            comment: request.note || ""
          };
        } else if (decision === "REJECTED") {
          attendanceDoc.managerDecision = {
            status: "REJECTED",
            decidedBy: req.user._id,
            decidedAt: new Date(),
            comment: request.note || ""
          };
        }

        await attendanceDoc.save();
      } else {
        console.warn(
          "Decision on attendance request: attendance not found and not created",
          id
        );
      }

      // ---- UPDATE REQUEST ITSELF ----
      request.status = decision; // no longer PENDING
      request.decidedBy = req.user._id;
      request.decisionAt = new Date();
      await request.save();

      try {
        await Log.create({
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
            toStatus: request.toStatus
          }
        });
      } catch (logErr) {
        console.error("Log ATTENDANCE_REQUEST_DECISION error:", logErr.message);
      }

      return res.json({
        message: attendanceDoc
          ? "Decision applied successfully"
          : "Decision stored, but attendance record could not be created"
      });
    } catch (err) {
      console.error("Decision on attendance request error:", err);
      return res
        .status(400)
        .json({ message: err.message || "Error applying decision" });
    }
  }
);

/* ------------------------ DELETE /api/attendance/:id ------------------------ */

router.delete(
  "/:id",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const record = await Attendance.findByIdAndDelete(req.params.id).populate(
        "user",
        "fullName email role"
      );

      if (record) {
        try {
          await Log.create({
            type: "OPERATION",
            action: "ATTENDANCE_DELETE",
            entity: "ATTENDANCE",
            user: req.user.id,
            userName: req.user.fullName,
            userEmail: req.user.email,
            role: req.user.role,
            description: `Manager deleted attendance for ${
              record.user?.fullName || "employee"
            } on ${record.date}`,
            status: "SUCCESS",
            ipAddress: getClientIp(req),
            details: {
              attendanceId: record._id,
              employeeId: record.user?._id,
              employeeEmail: record.user?.email
            }
          });
        } catch (logErr) {
          console.error("Log ATTENDANCE_DELETE error:", logErr.message);
        }
      }

      res.json({ message: "Deleted" });
    } catch (err) {
      console.error("Delete attendance error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;

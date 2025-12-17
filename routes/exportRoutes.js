// routes/exportRoutes.js
import express from "express";
import Attendance from "../models/Attendance.js";
import AttendanceRequest from "../models/AttendanceRequest.js";
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import {
  countWeekendHolidays,
  countMandatoryPublicHolidays,
} from "../utils/holidays.js";

const router = express.Router();

// helper: "DD-MM-YYYY"
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

// helper: escape CSV fields
const csvEscape = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",;\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/* 1️⃣ ATTENDANCE CSV */
router.get(
  "/attendance/csv",
  authMiddleware,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;
      const filter = buildDateFilter(month, year);

      const records = await Attendance.find(filter)
        .populate("user")
        .sort({ date: 1 });

      const header = [
        "Date",
        "Employee Name",
        "Email",
        "Status",
        "Work In Time",
        "Work Out Time",
        "Manager Decision",
        "Note / Extra Work",
      ];

      const rows = records.map((r) => {
        let extra = r.note || "";
        if (r.status === "COMPOFF" && r.extraWork) {
          extra = `Extra: ${r.extraWork.hours} hrs on ${r.extraWork.workedDate} → Comp-off ${r.extraWork.compOffDate}`;
        }

        return [
          csvEscape(r.date),
          csvEscape(r.user?.fullName || ""),
          csvEscape(r.user?.email || ""),
          csvEscape(r.status),
          csvEscape(r.workInTime || ""),
          csvEscape(r.workOutTime || ""),
          csvEscape(r.managerDecision?.status || ""),
          csvEscape(extra),
        ].join(",");
      });

      const csv = [header.join(","), ...rows].join("\r\n");
      const filename = `attendance-${month || "ALL"}-${year || "ALL"}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err) {
      console.error("CSV export error:", err);
      res.status(500).json({ message: "Failed to export CSV" });
    }
  }
);

/* 2️⃣ TASKS CSV */
router.get(
  "/tasks/csv",
  authMiddleware,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { projectId } = req.query;

      const q = {};
      if (projectId) q.projectId = projectId;

      const tasks = await Task.find(q)
        .populate("assignedUserId", "fullName email")
        .populate("projectId", "name code")
        .sort({ createdAt: 1 });

      const header = [
        "Project",
        "Project Code",
        "Requirement",
        "Type",
        "Assigned To",
        "Assigned Email",
        "Status",
        "Scope",
        "Notes",
        "Discussed Date",
        "Start",
        "Close",
        "Working Days",
        "Client Priority",
        "Priority Source",
        "Created By",
        "Created At",
      ];

      const rows = tasks.map((t) => {
        return [
          csvEscape(t.projectId?.name || "-"),
          csvEscape(t.projectId?.code || "-"),
          csvEscape(t.recentRequirement || "-"),
          csvEscape(t.requirementType || "-"),
          csvEscape(t.assignedUserId?.fullName || "-"),
          csvEscape(t.assignedUserId?.email || "-"),
          csvEscape(t.status || "-"),
          csvEscape(t.scope || "-"),
          csvEscape(t.notes || "-"),
          csvEscape(t.discussedDate || "-"),
          csvEscape(t.originalClosureDate || "-"),
          csvEscape(t.estimatedDate || "-"),
          csvEscape(t.noOfDays || 0),
          csvEscape(t.clientPriority || "-"),
          csvEscape(t.prioritySource || "-"),
          csvEscape(t.createdBy || "-"),
          csvEscape(t.createdAt ? t.createdAt.toISOString() : "-"),
        ].join(",");
      });

      const csv = [header.join(","), ...rows].join("\r\n");
      const filename = `tasks-${projectId || "ALL"}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err) {
      console.error("Tasks CSV export error:", err);
      res.status(500).json({ message: "Failed to export tasks CSV" });
    }
  }
);

/* 3️⃣ LEAVES CSV */
router.get(
  "/leaves/csv",
  authMiddleware,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;
      const filter = buildDateFilter(month, year);

      const leaveStatuses = [
        "EMERGENCY LEAVE",
        "CASUAL LEAVE",
        "PRESENT HALF DAY",
        "Half Day - Fun Thursday",
        "Half Day - Development",
        "COMPOFF",
        "ABSENT",
        "SICK LEAVE",
      ];

      const attendanceRows = await Attendance.find({
        ...filter,
        status: { $in: leaveStatuses },
      })
        .populate("user")
        .sort({ date: 1 });

      const requests = await AttendanceRequest.find({ ...filter })
        .populate("user", "fullName email")
        .sort({ createdAt: 1 });

      const header = [
        "Type",
        "Date",
        "Employee",
        "Email",
        "Status",
        "Is Leave Request",
        "Manager Decision",
        "Note / Extra",
        "Request Type",
        "Request CreatedAt",
      ];

      const rows = [];

      // Attendance leave rows
      for (const r of attendanceRows) {
        let extra = r.note || "";
        if (r.status === "COMPOFF" && r.extraWork) {
          extra = `Extra: ${r.extraWork.hours} hrs → Comp-off ${r.extraWork.compOffDate}`;
        }

        rows.push(
          [
            "ATTENDANCE",
            csvEscape(r.date),
            csvEscape(r.user?.fullName),
            csvEscape(r.user?.email),
            csvEscape(r.status),
            csvEscape(r.isLeaveRequest ? "YES" : "NO"),
            csvEscape(r.managerDecision?.status || ""),
            csvEscape(extra),
            "-",
            csvEscape(r.updatedAt?.toISOString() || "-"),
          ].join(",")
        );
      }

      // Attendance requests
      for (const rq of requests) {
        const extra = rq.extraWork
          ? `Extra: ${rq.extraWork.hours} hrs on ${rq.extraWork.workedDate}`
          : rq.note || "";

        rows.push(
          [
            "REQUEST",
            csvEscape(rq.date),
            csvEscape(rq.user?.fullName),
            csvEscape(rq.user?.email),
            csvEscape(rq.toStatus),
            csvEscape(rq.status || "PENDING"),
            csvEscape(rq.status || "PENDING"),
            csvEscape(extra),
            csvEscape(rq.type || "-"),
            csvEscape(rq.createdAt?.toISOString() || "-"),
          ].join(",")
        );
      }

      const csv = [header.join(","), ...rows].join("\r\n");
      const filename = `leaves-${month || "ALL"}-${year || "ALL"}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err) {
      console.error("Leaves CSV export error:", err);
      res.status(500).json({ message: "Failed to export leaves CSV" });
    }
  }
);

/* 4️⃣ MONTHLY LEAVE SUMMARY CSV */
router.get(
  "/leave-summary/csv",
  authMiddleware,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { month, year } = req.query;

      const employees = await User.find({ role: "employee" }).sort("fullName");
      const filter = {
        user: { $in: employees.map((e) => e._id) },
        ...buildDateFilter(month, year),
      };
      const records = await Attendance.find(filter);

      const accumulate = (list) => {
        let full = 0;
        let half = 0;

        for (const r of list) {
          if (
            ["EMERGENCY LEAVE", "CASUAL LEAVE", "SICK LEAVE"].includes(r.status)
          ) {
            full += 1;
          } else if (
            [
              "PRESENT HALF DAY",
              "Half Day - Fun Thursday",
              "Half Day - Development",
            ].includes(r.status)
          ) {
            half += 1;
          }
        }
        return { full, half };
      };

      const header = [
        "Employee",
        "Email",
        "Entitlement",
        "Public Holidays",
        "Weekend Holidays",
        "Carry Forward",
        "Leaves Taken",
        "Half Days",
        "Balance Leaves",
        "Final Balance After Half-Day Adjust",
      ];

      const rows = [];

      for (const u of employees) {
        const userRecords = records.filter(
          (r) => String(r.user) === String(u._id)
        );
        const { full, half } = accumulate(userRecords);

        const weekend = countWeekendHolidays(month, year);
        const mandatory = countMandatoryPublicHolidays(month, year);

        const publicHolidays = mandatory + (u.publicHolidays || 0);

        const entitlement = (u.totalLeaveEntitlement || 0) + (u.carryForward2025 || 0);

        const leavesTaken = full + half * 0.5;

        rows.push(
          [
            csvEscape(u.fullName),
            csvEscape(u.email),
            entitlement,
            publicHolidays,
            weekend,
            u.carryForward2025 || 0,
            leavesTaken,
            half,
            entitlement - full,
            entitlement - leavesTaken,
          ].join(",")
        );
      }

      const csv = [header.join(","), ...rows].join("\r\n");
      const filename = `leave-summary-${month}-${year}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err) {
      console.error("Summary CSV error:", err);
      res.status(500).json({ message: "Failed to export summary CSV" });
    }
  }
);

export default router;

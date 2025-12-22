// routes/employeeRoutes.js
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";
import { generateEmployeeId } from "../utils/generateEmployeeId.js";

const router = express.Router();

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
};

/**
 * POST /api/employees
 * Manager creates an employee login with leave config
 */
router.post(
  "/",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const {
        fullName,
        email,
        laptopId,
        password,
        totalLeaveEntitlement,
        carryForward2025,
      } = req.body;

      // Check if email exists
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }

      // Generate unique employee ID
      const employeeId = await generateEmployeeId();

      // Check if generated employeeId already exists
      const existingId = await User.findOne({ employeeId });
      if (existingId) {
        return res.status(400).json({ message: "Employee ID already exists. Please try again." });
      }

      const hash = await bcrypt.hash(password || "Emp@123", 10);

      const user = await User.create({
        employeeId,
        fullName,
        email,
        laptopId,
        role: "employee",
        passwordHash: hash,

        totalLeaveEntitlement: Number(totalLeaveEntitlement ?? 16),

        // publicHolidays + weekendHolidays are now system-driven
        publicHolidays: 0,
        weekendHolidays: 0,

        carryForward2025: Number(carryForward2025 ?? 0),
        mustChangePassword: true,
      });

      // ---- LOG OPERATION ----
      try {
        await Log.create({
          type: "OPERATION",
          action: "CREATE_EMPLOYEE",
          entity: "EMPLOYEE",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Created employee ${user.fullName} (${user.email}) with ID ${employeeId}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            employeeId: user._id,
            email: user.email,
            employeeCode: employeeId,
          },
        });
      } catch (logErr) {
        console.error("Log CREATE_EMPLOYEE error:", logErr.message);
      }

      res.status(201).json(user);
    } catch (err) {
      console.error("Create employee error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * GET /api/employees
 * Manager lists employees
 */
router.get("/", authMiddleware, requireRole(["manager"]), async (req, res) => {
  try {
    const employees = await User.find({ role: "employee" }).sort("fullName");
    res.json(employees);
  } catch (err) {
    console.error("List employees error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/employees/:id/deactivate
 * Manager deactivates employee (login disabled)
 */
router.patch(
  "/:id/deactivate",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { new: true }
      );

      // ---- LOG OPERATION ----
      if (user) {
        try {
          await Log.create({
            type: "OPERATION",
            action: "DEACTIVATE_EMPLOYEE",
            entity: "EMPLOYEE",
            user: req.user.id,
            userName: req.user.fullName,
            userEmail: req.user.email,
            role: req.user.role,
            description: `Deactivated employee ${user.fullName} (${user.email})`,
            status: "SUCCESS",
            ipAddress: getClientIp(req),
            details: {
              employeeId: user._id,
              email: user.email,
            },
          });
        } catch (logErr) {
          console.error("Log DEACTIVATE_EMPLOYEE error:", logErr.message);
        }
      }

      res.json(user);
    } catch (err) {
      console.error("Deactivate employee error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * PATCH /api/employees/:id/leave-config
 * Manager updates employee leave configuration.
 * NOTE: public/weekend holidays are system driven – not editable here.
 */
router.patch(
  "/:id/leave-config",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const {
        totalLeaveEntitlement,
        carryForward2025,
      } = req.body;

      const update = {};

      if (totalLeaveEntitlement !== undefined) {
        update.totalLeaveEntitlement = Number(totalLeaveEntitlement);
      }
      if (carryForward2025 !== undefined) {
        update.carryForward2025 = Number(carryForward2025);
      }

      const user = await User.findByIdAndUpdate(req.params.id, update, {
        new: true,
      });

      // ---- LOG OPERATION ----
      if (user) {
        try {
          await Log.create({
            type: "OPERATION",
            action: "UPDATE_EMPLOYEE_LEAVE_CONFIG",
            entity: "EMPLOYEE",
            user: req.user.id,
            userName: req.user.fullName,
            userEmail: req.user.email,
            role: req.user.role,
            description: `Updated leave config for ${user.fullName} (${user.email})`,
            status: "SUCCESS",
            ipAddress: getClientIp(req),
            details: {
              employeeId: user._id,
              email: user.email,
              totalLeaveEntitlement: user.totalLeaveEntitlement,
              publicHolidays: user.publicHolidays,
              carryForward2025: user.carryForward2025,
            },
          });
        } catch (logErr) {
          console.error(
            "Log UPDATE_EMPLOYEE_LEAVE_CONFIG error:",
            logErr.message
          );
        }
      }

      res.json(user);
    } catch (err) {
      console.error("Update leave config error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
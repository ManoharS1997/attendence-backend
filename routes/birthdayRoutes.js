import express from "express";
import Birthday from "../models/Birthday.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * CREATE BIRTHDAY
 * POST /api/birthday
 */
router.post(
  "/",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { employeeId, dob } = req.body;

      if (!employeeId || !dob) {
        return res.status(400).json({
          message: "employeeId and dob are required"
        });
      }

      const emp = await User.findById(employeeId);
      if (!emp) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const existing = await Birthday.findOne({ employee: emp._id });
      if (existing) {
        return res.status(400).json({
          message: "Birthday already exists for this employee"
        });
      }

      const [dd, mm, yyyy] = dob.split("-").map(Number);

      const birthday = await Birthday.create({
        employee: emp._id,
        fullName: emp.fullName,
        email: emp.email,
        dob,
        day: dd,
        month: mm,
        year: yyyy
      });

      res.json({ success: true, birthday });
    } catch (err) {
      console.error("Birthday create error:", err);
      res.status(500).json({ message: "Failed to create birthday" });
    }
  }
);

/**
 * GET ALL BIRTHDAYS
 * GET /api/birthday
 */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const birthdays = await Birthday.find()
        .populate("employee", "employeeId fullName email")
        .sort({ month: 1, day: 1 });

      res.json(birthdays);
    } catch (err) {
      console.error("Fetch birthdays error:", err);
      res.status(500).json({ message: "Failed to fetch birthdays" });
    }
  }
);

export default router;

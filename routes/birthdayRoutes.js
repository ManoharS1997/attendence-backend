import express from "express";
import Birthday from "../models/Birthday.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * =========================================================
 * CREATE BIRTHDAY
 * POST /api/birthday
 * =========================================================
 */
router.post(
  "/",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { employeeId, dob, note } = req.body;

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
        year: yyyy,
        note,
        wished: false
      });

      res.json({ success: true, birthday });
    } catch (err) {
      console.error("Birthday create error:", err);
      res.status(500).json({ message: "Failed to create birthday" });
    }
  }
);

/**
 * =========================================================
 * GET ALL BIRTHDAYS
 * GET /api/birthday
 * =========================================================
 */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager", "employee"]),
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

/**
 * =========================================================
 * CHECK TODAY'S BIRTHDAY (EMPLOYEE LOGIN)
 * GET /api/birthday/today
 * =========================================================
 */
router.get(
  "/today",
  authMiddleware,
  requireRole(["employee", "manager"]),
  async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;

      const today = new Date();
      const day = today.getDate();
      const month = today.getMonth() + 1;

      const birthday = await Birthday.findOne({
        employee: userId,
        day,
        month
      }).populate("employee", "fullName email");

      if (!birthday) {
        return res.json({ isBirthday: false });
      }

      res.json({
        isBirthday: true,
        birthday: {
          id: birthday._id,
          fullName: birthday.employee.fullName,
          email: birthday.employee.email,
          day: birthday.day,
          month: birthday.month,
          wished: birthday.wished
        }
      });
    } catch (err) {
      console.error("Birthday today check error:", err);
      res.status(500).json({ message: "Failed to check birthday" });
    }
  }
);

/**
 * =========================================================
 * DELETE BIRTHDAY
 * DELETE /api/birthday/:id
 * =========================================================
 */
router.delete(
  "/:id",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const deleted = await Birthday.findByIdAndDelete(req.params.id);

      if (!deleted) {
        return res.status(404).json({ message: "Birthday not found" });
      }

      res.json({
        success: true,
        message: "Birthday deleted successfully"
      });
    } catch (err) {
      console.error("Delete birthday error:", err);
      res.status(500).json({ message: "Failed to delete birthday" });
    }
  }
);

/**
 * =========================================================
 * SEND BIRTHDAY WISH
 * POST /api/birthday/:id/wish
 * =========================================================
 */
router.post(
  "/:id/wish",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const birthday = await Birthday.findById(req.params.id).populate(
        "employee",
        "fullName email"
      );

      if (!birthday) {
        return res.status(404).json({
          message: "Birthday record not found"
        });
      }

      birthday.wished = true;
      birthday.wishedAt = new Date();
      birthday.wishedBy = req.user.fullName;

      await birthday.save();

      res.json({
        success: true,
        message: `Birthday wish sent to ${birthday.employee.fullName}`
      });
    } catch (err) {
      console.error("Birthday wish error:", err);
      res.status(500).json({ message: "Failed to send birthday wish" });
    }
  }
);

export default router;

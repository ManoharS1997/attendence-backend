import express from "express";
import Notification from "../models/Notification.js";
import { authMiddleware } from "../middleware/auth.js";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import Task from "../models/Task.js";

const router = express.Router();

/**
 * ======================================================
 * GET /api/notifications/my
 * Get logged-in user's notifications
 * ======================================================
 */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const { month, year, unreadOnly } = req.query;

    const filter = { user: req.user.id };

    if (unreadOnly === "true") {
      filter.read = false;
    }

    if (month && year) {
      filter.month = parseInt(month);
      filter.year = parseInt(year);
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1, priority: -1 })
      .limit(100);

    res.json(notifications);
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ======================================================
 * POST /api/notifications/monthly-welcome
 * Monthly welcome notification
 * ======================================================
 */
router.post("/monthly-welcome", authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.body;
    const currentDate = new Date();
    const currentMonth = month || currentDate.getMonth() + 1;
    const currentYear = year || currentDate.getFullYear();

    const existing = await Notification.findOne({
      user: req.user.id,
      month: currentMonth,
      year: currentYear,
      title: { $regex: /welcome/i },
    });

    if (!existing) {
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];

      await Notification.create({
        user: req.user.id,
        type: "info",
        title: `Welcome to ${monthNames[currentMonth - 1]} ${currentYear}`,
        message: `This is your attendance dashboard for ${monthNames[currentMonth - 1]} ${currentYear}. Please mark your attendance daily.`,
        month: currentMonth,
        year: currentYear,
        priority: 2,
      });
    }

    res.json({ message: "Notification check completed" });
  } catch (err) {
    console.error("Monthly welcome notification error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ======================================================
 * POST /api/notifications/manager/daily-summary
 * Generate daily employee summary notifications
 * ======================================================
 */
router.post("/manager/daily-summary", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "manager") {
      return res.status(403).json({ message: "Access denied" });
    }

    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = today.getFullYear();
    const formattedDate = `${day}-${month}-${year}`;

    const employees = await User.find({ role: "employee" });

    for (let emp of employees) {
      const attendance = await Attendance.findOne({
        user: emp._id,
        date: formattedDate,
      });

      const completedTasks = await Task.countDocuments({
        assignedUserId: emp._id,
        status: "COMPLETED",
        createdAt: {
          $gte: new Date(year, today.getMonth(), today.getDate()),
        },
      });

      const hours = attendance?.hoursWorked || 0;
      const lunch = attendance?.lunchBreakMinutes || 0;
      const status = attendance?.status || "NO RECORD";

      const title = `Daily Summary - ${emp.name} - ${formattedDate}`;

      // Prevent duplicate notifications
      const existing = await Notification.findOne({
        user: req.user.id,
        title,
      });

      if (!existing) {
        await Notification.create({
          user: req.user.id,
          type: "info",
          title,
          message: `Hours: ${hours} hrs | Lunch: ${lunch} mins | Tasks: ${completedTasks} | Status: ${status}`,
          month: today.getMonth() + 1,
          year: year,
          priority: 3,
        });
      }
    }

    res.json({ message: "Daily summary notifications generated" });
  } catch (err) {
    console.error("Manager daily summary error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ======================================================
 * PATCH /api/notifications/:id/read
 * Mark single notification as read
 * ======================================================
 */
router.patch("/:id/read", authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    notification.read = true;
    notification.readAt = new Date();
    await notification.save();

    res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("Mark notification read error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ======================================================
 * PATCH /api/notifications/read-all
 * Mark all notifications as read
 * ======================================================
 */
router.patch("/read-all", authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.id, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("Mark all read error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
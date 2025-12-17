// attendance-backend/routes/holidayRoutes.js
import express from "express";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import HolidaySetting from "../models/HolidaySetting.js";

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

export default router;

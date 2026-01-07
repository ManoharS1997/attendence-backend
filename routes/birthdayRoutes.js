import express from "express";
import Birthday from "../models/Birthday.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * CREATE BIRTHDAY
 */
router.post(
  "/",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    const { employeeId, dob } = req.body;

    const emp = await User.findById(employeeId);
    if (!emp) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const [dd, mm, yyyy] = dob.split("-").map(Number);

    const birthday = await Birthday.create({
      employee: emp._id,
      fullName: emp.fullName,
      email: emp.email,
      dob,
      day: dd,
      month: mm
    });

    res.json({ success: true, birthday });
  }
);

export default router;

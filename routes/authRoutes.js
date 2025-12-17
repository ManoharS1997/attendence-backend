// routes/authRoutes.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Log from "../models/Log.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  const { email, password, role } = req.body;
  const ipAddress = getClientIp(req);

  try {
    const user = await User.findOne({ email, role });

    if (!user || !user.isActive) {
      await Log.create({
        type: "LOGIN",
        action: "LOGIN_FAILED",
        entity: "AUTH",
        user: user?._id || null,
        userName: user?.fullName || "",
        userEmail: email,
        role: role || user?.role || "",
        description: "Invalid credentials (user not found or inactive)",
        status: "FAILED",
        ipAddress,
        details: {
          reason: !user ? "USER_NOT_FOUND" : "USER_INACTIVE",
        },
      });

      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await Log.create({
        type: "LOGIN",
        action: "LOGIN_FAILED",
        entity: "AUTH",
        user: user._id,
        userName: user.fullName,
        userEmail: user.email,
        role: user.role,
        description: "Invalid credentials (wrong password)",
        status: "FAILED",
        ipAddress,
        details: { reason: "WRONG_PASSWORD" },
      });

      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    await Log.create({
      type: "LOGIN",
      action: "LOGIN_SUCCESS",
      entity: "AUTH",
      user: user._id,
      userName: user.fullName,
      userEmail: user.email,
      role: user.role,
      description: "User logged in successfully",
      status: "SUCCESS",
      ipAddress,
    });

    res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (err) {
    console.error("Login error:", err);

    try {
      await Log.create({
        type: "ERROR",
        action: "LOGIN_ERROR",
        entity: "AUTH",
        userEmail: email,
        role,
        description: "Unhandled error during login",
        status: "ERROR",
        ipAddress,
        details: { errorMessage: err.message },
      });
    } catch (logErr) {
      console.error("Failed to write login error log:", logErr);
    }

    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", authMiddleware, async (req, res) => {
  const ipAddress = getClientIp(req);

  try {
    await Log.create({
      type: "LOGOUT",
      action: "LOGOUT",
      entity: "AUTH",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: "User logged out",
      status: "SUCCESS",
      ipAddress,
    });
  } catch (err) {
    console.error("Logout log error:", err);
  }

  res.json({ message: "Logged out" });
});

/**
 * PATCH /api/auth/change-password
 */
router.patch("/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const ipAddress = getClientIp(req);

  try {
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "currentPassword and newPassword are required" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      await Log.create({
        type: "OPERATION",
        action: "CHANGE_PASSWORD_FAILED",
        entity: "AUTH",
        user: user._id,
        userName: user.fullName,
        userEmail: user.email,
        role: user.role,
        description: "Change password failed - wrong current password",
        status: "FAILED",
        ipAddress,
      });

      return res.status(400).json({ message: "Current password incorrect" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = hash;
    user.mustChangePassword = false;
    await user.save();

    await Log.create({
      type: "OPERATION",
      action: "CHANGE_PASSWORD",
      entity: "AUTH",
      user: user._id,
      userName: user.fullName,
      userEmail: user.email,
      role: user.role,
      description: "User changed password successfully",
      status: "SUCCESS",
      ipAddress,
    });

    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("Change password error:", err);

    try {
      await Log.create({
        type: "ERROR",
        action: "CHANGE_PASSWORD_ERROR",
        entity: "AUTH",
        user: req.user?.id || null,
        userName: req.user?.fullName || "",
        userEmail: req.user?.email || "",
        role: req.user?.role || "",
        description: "Unhandled error during change-password",
        status: "ERROR",
        ipAddress,
        details: { errorMessage: err.message },
      });
    } catch (logErr) {
      console.error("Failed to write change-password error log:", logErr);
    }

    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/auth/reset-by-admin
 */
router.patch(
  "/reset-by-admin",
  authMiddleware,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    const ipAddress = getClientIp(req);

    try {
      const { email, role, newPassword } = req.body;

      if (!email || !role || !newPassword) {
        return res
          .status(400)
          .json({ message: "email, role and newPassword are required" });
      }

      if (req.user.role === "manager" && role !== "employee") {
        return res
          .status(403)
          .json({ message: "Managers can only reset employee passwords" });
      }

      const adminUser = await User.findById(req.user.id);

      const user = await User.findOne({ email, role });
      if (!user) {
        await Log.create({
          type: "OPERATION",
          action: "RESET_PASSWORD_BY_ADMIN_FAILED",
          entity: "AUTH",
          user: adminUser?._id || null,
          userName: adminUser?.fullName || "",
          userEmail: adminUser?.email || "",
          role: adminUser?.role || "",
          description: `Password reset failed - target user not found (${email}, ${role})`,
          status: "FAILED",
          ipAddress,
        });

        return res.status(404).json({ message: "User not found" });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      user.passwordHash = hash;
      user.mustChangePassword = true;
      await user.save();

      await Log.create({
        type: "OPERATION",
        action: "RESET_PASSWORD_BY_ADMIN",
        entity: "AUTH",
        user: adminUser?._id || null,
        userName: adminUser?.fullName || "",
        userEmail: adminUser?.email || "",
        role: adminUser?.role || "",
        description: `Password reset for ${user.email} (${user.role})`,
        status: "SUCCESS",
        ipAddress,
        details: {
          targetUserId: user._id,
          targetEmail: user.email,
          targetRole: user.role,
        },
      });

      res.json({
        message: `Password reset for ${user.email}. Share the new password with the user.`,
      });
    } catch (err) {
      console.error("Admin reset password error:", err);

      try {
        await Log.create({
          type: "ERROR",
          action: "RESET_PASSWORD_BY_ADMIN_ERROR",
          entity: "AUTH",
          user: req.user?.id || null,
          userName: req.user?.fullName || "",
          userEmail: req.user?.email || "",
          role: req.user?.role || "",
          description: "Unhandled error during admin reset password",
          status: "ERROR",
          ipAddress,
          details: { errorMessage: err.message },
        });
      } catch (logErr) {
        console.error("Failed to write reset-by-admin error log:", logErr);
      }

      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;

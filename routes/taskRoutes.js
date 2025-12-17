// routes/taskRoutes.js
import express from "express";
import Task from "../models/Task.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { countWorkingDaysInRange } from "../utils/holidays.js";

const router = express.Router();

// all task routes require login
router.use(authMiddleware);

// helper: manager/admin only (for admin view we also allow admin)
const requireManager = requireRole(["manager", "admin"]);

/**
 * POST /api/tasks
 * Manager or Employee creates / allocates task
 */
router.post("/", async (req, res) => {
  try {
    const {
      projectId,
      assignedUserId,
      recentRequirement,
      requirementType,
      status,
      scope,
      notes,
      discussedDate,
      originalClosureDate,
      estimatedDate,
      noOfDays,
      clientPriority,
      prioritySource,
      hoursAllocated,
      createdBy
    } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const requirementText =
      recentRequirement && recentRequirement.trim().length > 0
        ? recentRequirement
        : "Requirement not specified";

    const isManager = req.user.role === "manager";

    let finalAssignedUserId = assignedUserId;
    let finalHoursAllocated = Number(hoursAllocated || 0);

    // Employees can only assign task to themselves, and not allocate hours
    if (!isManager) {
      finalAssignedUserId = req.user.id || req.user._id;
      finalHoursAllocated = 0;
    }

    const start = originalClosureDate || "";
    const end = estimatedDate || "";

    // auto-calculate working days between start & end, excluding weekends/holidays
    let workingDays = Number(noOfDays || 0);
    if (start && end) {
      workingDays = countWorkingDaysInRange(start, end);
    }

    const task = await Task.create({
      projectId,
      assignedUserId: finalAssignedUserId || undefined,
      recentRequirement: requirementText,
      requirementType: requirementType || "NEW",
      status: status || "OPEN",
      scope: scope || "AGREED",
      notes: notes || "",
      discussedDate: discussedDate || "",
      originalClosureDate: start,
      estimatedDate: end,
      noOfDays: workingDays,
      clientPriority: clientPriority || "P3",
      prioritySource: (prioritySource || "CLIENT").toUpperCase(),
      hoursAllocated: finalHoursAllocated,
      createdBy: createdBy || req.user.fullName || req.user.email
    });

    res.status(201).json(task);
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ message: err.message || "Error creating task" });
  }
});

/**
 * GET /api/tasks/project/:projectId
 * Manager/Admin: all tasks for a project
 */
router.get("/project/:projectId", requireManager, async (req, res) => {
  try {
    const { projectId } = req.params;

    const tasks = await Task.find({ projectId })
      .populate("assignedUserId", "fullName email")
      .sort({ createdAt: 1 });

    res.json(
      tasks.map((t) => ({
        ...t.toObject(),
        assignedUser: t.assignedUserId
      }))
    );
  } catch (err) {
    console.error("Get project tasks error:", err);
    res.status(500).json({ message: "Error fetching project tasks" });
  }
});

/**
 * GET /api/tasks/my
 * Employee / Manager: tasks assigned to me (or created by me with no assignee)
 */
router.get("/my", async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userEmail = req.user.email;

    const tasks = await Task.find({
      $or: [
        { assignedUserId: userId },
        { assignedUserId: null, createdBy: userEmail }
      ]
    })
      .populate("projectId", "name code description totalEstimatedHours")
      .sort({ createdAt: 1 });

    res.json(
      tasks.map((t) => ({
        ...t.toObject(),
        project: t.projectId
      }))
    );
  } catch (err) {
    console.error("Get my tasks error:", err);
    res.status(500).json({ message: "Error fetching tasks" });
  }
});

/**
 * NEW: GET /api/tasks/all-admin
 * Manager/Admin: all project tasks across organisation (Admin uses this, view-only)
 */
router.get("/all-admin", requireManager, async (req, res) => {
  try {
    const tasks = await Task.find({})
      .populate("projectId", "name code description totalEstimatedHours")
      .populate("assignedUserId", "fullName email")
      .sort({ createdAt: 1 });

    res.json(
      tasks.map((t) => ({
        ...t.toObject(),
        project: t.projectId,
        assignedUser: t.assignedUserId
      }))
    );
  } catch (err) {
    console.error("Get all tasks for admin error:", err);
    res
      .status(500)
      .json({ message: "Error loading all project tasks for admin" });
  }
});

/**
 * PATCH /api/tasks/:id
 */
router.patch("/:id", async (req, res) => {
  try {
    const isManager = req.user.role === "manager" || req.user.role === "admin";
    const userId = req.user.id || req.user._id;

    // if both dates present in body, recalc working days
    if (req.body.originalClosureDate && req.body.estimatedDate) {
      const start = req.body.originalClosureDate;
      const end = req.body.estimatedDate;
      req.body.noOfDays = countWorkingDaysInRange(start, end);
    }

    // Manager/Admin can update whole task
    if (isManager) {
      const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
        new: true
      });
      if (!task) return res.status(404).json({ message: "Task not found" });
      return res.json(task);
    }

    // Employee update: only if assigned to them, and only some fields
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    if (String(task.assignedUserId) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const allowedForEmployee = [
      "recentRequirement",
      "requirementType",
      "status",
      "scope",
      "notes",
      "discussedDate",
      "originalClosureDate",
      "estimatedDate",
      "noOfDays",
      "clientPriority",
      "prioritySource"
    ];

    const updates = {};
    Object.keys(req.body || {}).forEach((key) => {
      if (allowedForEmployee.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const updated = await Task.findByIdAndUpdate(req.params.id, updates, {
      new: true
    });
    return res.json(updated);
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ message: "Error updating task" });
  }
});

/**
 * DELETE /api/tasks/:id
 * Only manager/admin
 */
router.delete("/:id", requireManager, async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json({ message: "Task deleted" });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ message: "Error deleting task" });
  }
});

export default router;

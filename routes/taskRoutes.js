// routes/taskRoutes.js
import express from "express";
import Task from "../models/Task.js";
import { authMiddleware } from "../middleware/auth.js";
import { countWorkingDaysInRange } from "../utils/holidays.js";

const router = express.Router();

// 🔐 Apply auth middleware
router.use(authMiddleware);

/**
 * 🔐 Permission checker for task edit
 */
const canEditTask = (user, task) => {
  // Admin → view only
  if (user.role === "admin") return false;

  // Manager-created task → editable ONLY by assigned employee
  if (task.createdByRole === "manager") {
    return (
      user.role === "employee" &&
      task.assignedUserId?.toString() === user._id.toString()
    );
  }

  // Employee-created task → editable ONLY by manager
  if (task.createdByRole === "employee") {
    return user.role === "manager";
  }

  // Admin-created task → no edits
  return false;
};

/**
 * ✅ CREATE TASK
 */
router.post("/", async (req, res) => {
  try {
    const isManager =
      req.user.role === "manager" || req.user.role === "admin";

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
      clientPriority,
      prioritySource,
      estimateHours
    } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    // Employees can assign task only to themselves
    const finalAssignedUserId = isManager
      ? assignedUserId || null
      : req.user._id;

    let workingDays = 0;
    if (originalClosureDate && estimatedDate) {
      workingDays = await countWorkingDaysInRange(
        originalClosureDate,
        estimatedDate
      );
    }

    const task = await Task.create({
      projectId,
      assignedUserId: finalAssignedUserId,
      createdByUserId: req.user._id,
      createdByRole: req.user.role,
      recentRequirement:
        recentRequirement?.trim() || "Requirement not specified",
      requirementType: requirementType || "NEW",
      status: status || "OPEN",
      scope: scope || "AGREED",
      notes: notes || "",
      discussedDate: discussedDate || "",
      originalClosureDate: originalClosureDate || "",
      estimatedDate: estimatedDate || "",
      noOfDays: workingDays,
      estimateHours:
        Number(estimateHours) > 0 ? Number(estimateHours) : 8,
      clientPriority: clientPriority || "P3",
      prioritySource: (prioritySource || "CLIENT").toUpperCase()
    });

    res.status(201).json(task);
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ message: "Error creating task" });
  }
});

/**
 * 👁️ MY TASKS
 * - Employee → only assigned tasks
 * - Manager/Admin → all tasks
 */
router.get("/my", async (req, res) => {
  try {
    const query =
      req.user.role === "employee"
        ? { assignedUserId: req.user._id }
        : {};

    const tasks = await Task.find(query)
      .populate("projectId", "name code")
      .populate("assignedUserId", "fullName email")
      .sort({ createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: "Error fetching tasks" });
  }
});

/**
 * 👁️ PROJECT TASKS
 */
router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    const query =
      req.user.role === "employee"
        ? { projectId, assignedUserId: req.user._id }
        : { projectId };

    const tasks = await Task.find(query)
      .populate("assignedUserId", "fullName email")
      .sort({ createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: "Error fetching project tasks" });
  }
});

/**
 * ✏️ UPDATE TASK (STRICT RULES)
 */
router.patch("/:id", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // 🔐 Permission enforcement
    if (!canEditTask(req.user, task)) {
      return res.status(403).json({
        message: "You do not have permission to edit this task"
      });
    }

    // Recalculate working days if dates change
    if (req.body.originalClosureDate && req.body.estimatedDate) {
      req.body.noOfDays = await countWorkingDaysInRange(
        req.body.originalClosureDate,
        req.body.estimatedDate
      );
    }

    if (req.body.estimateHours !== undefined) {
      req.body.estimateHours =
        Number(req.body.estimateHours) > 0
          ? Number(req.body.estimateHours)
          : task.estimateHours;
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(updatedTask);
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ message: "Error updating task" });
  }
});

/**
 * ❌ DELETE TASK
 * Permanently disabled as per requirement
 */
router.delete("/:id", (req, res) => {
  res.status(403).json({
    message: "Task deletion is not allowed"
  });
});

export default router;

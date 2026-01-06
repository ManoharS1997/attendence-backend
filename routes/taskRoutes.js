// routes/taskRoutes.js
import express from "express";
import Task from "../models/Task.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { countWorkingDaysInRange } from "../utils/holidays.js";

const router = express.Router();

router.use(authMiddleware);

const requireManager = requireRole(["manager", "admin"]);

/**
 * CREATE TASK
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

    let finalAssignedUserId = assignedUserId || null;

    if (!isManager) {
      finalAssignedUserId = req.user._id;
    }

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
 * MY TASKS
 */
router.get("/my", async (req, res) => {
  try {
    const userId = req.user._id;

    const query =
      req.user.role === "employee"
        ? { assignedUserId: userId }
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
 * PROJECT TASKS
 */
router.get("/project/:projectId", async (req, res) => {
  const { projectId } = req.params;

  const query =
    req.user.role === "employee"
      ? { projectId, assignedUserId: req.user._id }
      : { projectId };

  const tasks = await Task.find(query)
    .populate("assignedUserId", "fullName email")
    .sort({ createdAt: -1 });

  res.json(tasks);
});

/**
 * UPDATE TASK
 */
router.patch("/:id", async (req, res) => {
  try {
    const isManager =
      req.user.role === "manager" || req.user.role === "admin";

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    if (
      !isManager &&
      task.assignedUserId?.toString() !== req.user._id.toString() &&
      task.createdByUserId.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

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
 * DELETE TASK
 */
router.delete("/:id", requireManager, async (req, res) => {
  await Task.findByIdAndDelete(req.params.id);
  res.json({ message: "Task deleted" });
});

export default router;

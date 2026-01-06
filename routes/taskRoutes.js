import express from "express";
import Task from "../models/Task.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { countWorkingDaysInRange } from "../utils/holidays.js";

const router = express.Router();

// all task routes require login
router.use(authMiddleware);

// helper: manager/admin only
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

    const isManager = req.user.role === "manager" || req.user.role === "admin";

    let finalAssignedUserId = assignedUserId;
    let finalHoursAllocated = Number(hoursAllocated || 0);

    // Employees: only assign to themselves
    if (!isManager) {
      finalAssignedUserId = req.user.id || req.user._id;
    }

    const start = originalClosureDate || "";
    const end = estimatedDate || "";

    // auto-calculate working days
    let workingDays = Number(noOfDays || 0);
    if (start && end) {
      workingDays = await countWorkingDaysInRange(start, end);
    }

    // default hours = workingDays * 8 OR fallback 8
    if (!finalHoursAllocated || finalHoursAllocated <= 0) {
      finalHoursAllocated = workingDays > 0 ? workingDays * 8 : 8;
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
 * GET /api/tasks/my
 * Employee / Manager: tasks assigned to me
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
 * PATCH /api/tasks/:id
 * Update task
 */
router.patch("/:id", async (req, res) => {
  try {
    const isManager = req.user.role === "manager" || req.user.role === "admin";
    const userId = req.user.id || req.user._id;

    // recalc working days if dates changed
    if (req.body.originalClosureDate && req.body.estimatedDate) {
      req.body.noOfDays = await countWorkingDaysInRange(
        req.body.originalClosureDate,
        req.body.estimatedDate
      );
    }

    // MANAGER / ADMIN → full update allowed
    if (isManager) {
      const updates = { ...req.body };

      if (updates.hoursAllocated !== undefined) {
        updates.hoursAllocated =
          Number(updates.hoursAllocated) > 0
            ? Number(updates.hoursAllocated)
            : 8;
      }

      const task = await Task.findByIdAndUpdate(req.params.id, updates, {
        new: true
      });

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      return res.json(task);
    }

    // EMPLOYEE UPDATE (restricted)
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

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
      "prioritySource",
      "hoursAllocated"
    ];

    const updates = {};

    Object.keys(req.body || {}).forEach((key) => {
      if (allowedForEmployee.includes(key)) {
        if (key === "hoursAllocated") {
          updates.hoursAllocated =
            Number(req.body.hoursAllocated) > 0
              ? Number(req.body.hoursAllocated)
              : task.hoursAllocated;
        } else {
          updates[key] = req.body[key];
        }
      }
    });

    const updatedTask = await Task.findByIdAndUpdate(req.params.id, updates, {
      new: true
    });

    res.json(updatedTask);
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
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    res.json({ message: "Task deleted" });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ message: "Error deleting task" });
  }
});

export default router;

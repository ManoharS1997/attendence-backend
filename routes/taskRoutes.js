// routes/taskRoutes.js
import express from "express";
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import { authMiddleware } from "../middleware/auth.js";
import { countWorkingDaysInRange } from "../utils/holidays.js";

const router = express.Router();

// 🔐 Apply auth middleware
router.use(authMiddleware);

/* =====================================================
   HELPERS
   ===================================================== */

/**
 * Check if task can be edited by current user
 */
const canEditTask = (user, task) => {
  // Cannot edit approved tasks
  if (task.approvedByManager) return false;

  // Employee: can only edit tasks they created
  if (
    user.role === "employee" &&
    task.createdByRole === "employee" &&
    task.createdByUserId.toString() === user._id.toString()
  ) {
    return true;
  }

  // Manager: can edit employee-created tasks
  if (
    user.role === "manager" &&
    task.createdByRole === "employee"
  ) {
    return true;
  }

  // Manager: can edit tasks created by manager
  if (
    user.role === "manager" &&
    task.createdByRole === "manager"
  ) {
    return true;
  }

  // Admin: can edit any task
  if (user.role === "admin") {
    return true;
  }

  return false;
};

/**
 * Check if role is allowed in current project phase
 */
const isRoleAllowedForPhase = (role, phase) => {
  const map = {
    DEVELOPMENT: ["DEVELOPER", "TECH_LEAD"],
    DEPLOYMENT: ["DEVOPS"],
    TESTING: ["QA", "TESTER"],
    REVIEW: ["PRODUCT_MANAGER", "TECH_LEAD"],
    PLANNING: ["PROJECT_MANAGER", "ANALYST", "ARCHITECT"],
    COMPLETED: ["ALL"], // Completed phase - all roles can view
  };
  return map[phase]?.includes(role) || false;
};

/**
 * Validate task dates against project duration
 */
const validateTaskDates = (taskDate, projectStart, projectEnd) => {
  if (!taskDate || !projectStart || !projectEnd) return true;
  
  const date = new Date(taskDate);
  const start = new Date(projectStart);
  const end = new Date(projectEnd);
  
  return date >= start && date <= end;
};

/* =====================================================
   CREATE TASK
   ===================================================== */
router.post("/", async (req, res) => {
  try {
    const isManager = req.user.isManager || ["manager", "admin"].includes(req.user.role);
    
    const {
      projectId,
      assignedUserId,
      // New task system fields
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
      estimateHours,
      // Legacy task system fields
      role,
      phase,
      title,
      description,
      hoursWorked,
      workDate,
    } = req.body;

    // Basic validation
    if (!projectId) {
      return res.status(400).json({ 
        message: "Project ID is required" 
      });
    }

    // Get project
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ 
        message: "Project not found" 
      });
    }

    // Check if project is active
    if (project.status === "ARCHIVED") {
      return res.status(400).json({
        message: "Cannot create tasks for archived projects"
      });
    }

    // Role-phase validation (for legacy system)
    if (role && project.currentPhase) {
      if (!isRoleAllowedForPhase(role, project.currentPhase)) {
        return res.status(400).json({
          message: `Role '${role}' is not allowed in '${project.currentPhase}' phase`,
          allowedRoles: {
            DEVELOPMENT: ["DEVELOPER", "TECH_LEAD"],
            DEPLOYMENT: ["DEVOPS"],
            TESTING: ["QA", "TESTER"],
            REVIEW: ["PRODUCT_MANAGER", "TECH_LEAD"],
          }[project.currentPhase] || []
        });
      }
    }

    // Date validation for legacy system
    if (workDate) {
      if (!validateTaskDates(workDate, project.startDate, project.endDate)) {
        return res.status(400).json({
          message: "Task date is outside project duration",
          projectStartDate: project.startDate,
          projectEndDate: project.endDate
        });
      }
    }

    // Determine assigned user
    const finalAssignedUserId = isManager
      ? assignedUserId || req.user._id
      : req.user._id;

    // Calculate working days for new system
    let workingDays = 0;
    if (originalClosureDate && estimatedDate) {
      try {
        workingDays = await countWorkingDaysInRange(
          originalClosureDate,
          estimatedDate
        );
      } catch (err) {
        console.warn("Failed to calculate working days:", err.message);
      }
    }

    // Build task data
    const taskData = {
      projectId,
      assignedUserId: finalAssignedUserId,
      createdByUserId: req.user._id,
      createdByRole: req.user.role,
      approvedByManager: false,
    };

    // Determine schema based on provided fields
    const isNewSystem = recentRequirement !== undefined;
    
    if (isNewSystem) {
      // New task system
      Object.assign(taskData, {
        recentRequirement: recentRequirement?.trim() || "Requirement not specified",
        requirementType: requirementType || "NEW",
        status: status || "OPEN",
        scope: scope || "AGREED",
        notes: notes || "",
        discussedDate: discussedDate || null,
        originalClosureDate: originalClosureDate || null,
        estimatedDate: estimatedDate || null,
        noOfDays: workingDays,
        estimateHours: Math.max(Number(estimateHours) || 8, 0.5), // Minimum 0.5 hours
        clientPriority: clientPriority || "P3",
        prioritySource: (prioritySource || "CLIENT").toUpperCase(),
      });
    } else {
      // Legacy task system
      Object.assign(taskData, {
        role: role || "DEVELOPER",
        phase: phase || project.currentPhase || "DEVELOPMENT",
        title: title?.trim() || "Untitled Task",
        description: description?.trim() || "",
        hoursWorked: Math.max(Number(hoursWorked) || 0, 0),
        workDate: workDate || new Date(),
      });
    }

    const task = await Task.create(taskData);
    
    // Populate for response
    const populatedTask = await Task.findById(task._id)
      .populate("projectId", "name code currentPhase")
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email");

    res.status(201).json(populatedTask);
  } catch (err) {
    console.error("Create task error:", err);
    
    // Handle duplicate errors
    if (err.code === 11000) {
      return res.status(400).json({
        message: "Task with similar data already exists"
      });
    }
    
    // Handle validation errors
    if (err.name === "ValidationError") {
      return res.status(400).json({
        message: "Validation failed",
        errors: Object.values(err.errors).map(e => e.message)
      });
    }
    
    res.status(500).json({ 
      message: "Error creating task",
      error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
});

/* =====================================================
   GET MY TASKS
   ===================================================== */
router.get("/my", async (req, res) => {
  try {
    const query = req.user.role === "employee"
      ? { assignedUserId: req.user._id }
      : {};

    const tasks = await Task.find(query)
      .populate("projectId", "name code currentPhase status")
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email role")
      .populate("approvedBy", "fullName email")
      .sort({ createdAt: -1 });

    // Calculate statistics
    const stats = {
      total: tasks.length,
      approved: tasks.filter(t => t.approvedByManager).length,
      pending: tasks.filter(t => !t.approvedByManager).length,
    };

    res.json({ tasks, stats });
  } catch (err) {
    console.error("Fetch my tasks error:", err);
    res.status(500).json({ message: "Error fetching tasks" });
  }
});

/* =====================================================
   GET PROJECT TASKS
   ===================================================== */
router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    // Check project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Check if employee is assigned to project
    if (req.user.role === "employee") {
      const isAssigned = project.assignments?.some(
        assignment => assignment.user.toString() === req.user._id.toString()
      );
      if (!isAssigned) {
        return res.status(403).json({ 
          message: "You are not assigned to this project" 
        });
      }
    }

    const query = req.user.role === "employee"
      ? { projectId, assignedUserId: req.user._id }
      : { projectId };

    const tasks = await Task.find(query)
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email role")
      .populate("approvedBy", "fullName email")
      .sort({ createdAt: -1 });

    // Calculate project task statistics
    const stats = {
      total: tasks.length,
      approved: tasks.filter(t => t.approvedByManager).length,
      pending: tasks.filter(t => !t.approvedByManager).length,
      byPhase: {},
      byStatus: {},
    };

    tasks.forEach(task => {
      // For legacy system
      if (task.phase) {
        stats.byPhase[task.phase] = (stats.byPhase[task.phase] || 0) + 1;
      }
      // For new system
      if (task.status) {
        stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
      }
    });

    res.json({ tasks, stats, project: { name: project.name, code: project.code } });
  } catch (err) {
    console.error("Fetch project tasks error:", err);
    res.status(500).json({ message: "Error fetching project tasks" });
  }
});

/* =====================================================
   GET SINGLE TASK
   ===================================================== */
router.get("/:id", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate("projectId", "name code currentPhase startDate endDate status")
      .populate("assignedUserId", "fullName email department")
      .populate("createdByUserId", "fullName email role department")
      .populate("approvedBy", "fullName email");

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Check permissions
    if (req.user.role === "employee") {
      // Employee can only view tasks assigned to them
      if (task.assignedUserId._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ 
          message: "Access denied. You can only view your own tasks." 
        });
      }
    }

    res.json(task);
  } catch (err) {
    console.error("Get task error:", err);
    res.status(500).json({ message: "Error fetching task" });
  }
});

/* =====================================================
   UPDATE TASK
   ===================================================== */
router.patch("/:id", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Cannot modify approved tasks
    if (task.approvedByManager) {
      return res.status(400).json({
        message: "Cannot modify approved tasks",
        approvedAt: task.approvedAt,
        approvedBy: task.approvedBy
      });
    }

    // Check edit permissions
    if (!canEditTask(req.user, task)) {
      return res.status(403).json({
        message: "You do not have permission to edit this task",
        requiredRole: "manager or admin",
        yourRole: req.user.role,
        createdBy: task.createdByRole
      });
    }

    // Get project for validation
    const project = await Project.findById(task.projectId);
    if (project && project.status === "ARCHIVED") {
      return res.status(400).json({
        message: "Cannot modify tasks in archived projects"
      });
    }

    // Validate dates if being updated
    if (req.body.workDate && project) {
      if (!validateTaskDates(req.body.workDate, project.startDate, project.endDate)) {
        return res.status(400).json({
          message: "Task date is outside project duration"
        });
      }
    }

    // Validate role-phase if updating role
    if (req.body.role && project?.currentPhase) {
      if (!isRoleAllowedForPhase(req.body.role, project.currentPhase)) {
        return res.status(400).json({
          message: `Role '${req.body.role}' not allowed in current project phase '${project.currentPhase}'`
        });
      }
    }

    // Recalculate working days for new system
    if (req.body.originalClosureDate || req.body.estimatedDate) {
      const ocDate = req.body.originalClosureDate || task.originalClosureDate;
      const estDate = req.body.estimatedDate || task.estimatedDate;
      
      if (ocDate && estDate) {
        try {
          req.body.noOfDays = await countWorkingDaysInRange(ocDate, estDate);
        } catch (err) {
          console.warn("Failed to recalculate working days:", err.message);
        }
      }
    }

    // Validate estimate hours
    if (req.body.estimateHours !== undefined) {
      req.body.estimateHours = Math.max(Number(req.body.estimateHours), 0.5);
    }

    // Validate hours worked for legacy system
    if (req.body.hoursWorked !== undefined) {
      req.body.hoursWorked = Math.max(Number(req.body.hoursWorked), 0);
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      req.body,
      { 
        new: true,
        runValidators: true 
      }
    )
      .populate("projectId", "name code currentPhase")
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email");

    res.json(updatedTask);
  } catch (err) {
    console.error("Update task error:", err);
    
    if (err.name === "ValidationError") {
      return res.status(400).json({
        message: "Validation failed",
        errors: Object.values(err.errors).map(e => e.message)
      });
    }
    
    res.status(500).json({ message: "Error updating task" });
  }
});

/* =====================================================
   APPROVE TASK (MANAGER/ADMIN ONLY)
   ===================================================== */
router.patch("/:id/approve", async (req, res) => {
  try {
    // Authorization check
    if (!req.user.isManager && !["manager", "admin"].includes(req.user.role)) {
      return res.status(403).json({ 
        message: "Only managers and admins can approve tasks" 
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Check if already approved
    if (task.approvedByManager) {
      return res.status(400).json({
        message: "Task is already approved",
        approvedAt: task.approvedAt,
        approvedBy: task.approvedBy
      });
    }

    // Get project for validation
    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Check if project is active
    if (project.status === "ARCHIVED") {
      return res.status(400).json({
        message: "Cannot approve tasks in archived projects"
      });
    }

    // Final validations
    const errors = [];

    // Date validation for legacy system
    if (task.workDate && !validateTaskDates(task.workDate, project.startDate, project.endDate)) {
      errors.push("Task date is outside project duration");
    }

    // Role-phase validation for legacy system
    if (task.role && project.currentPhase) {
      if (!isRoleAllowedForPhase(task.role, project.currentPhase)) {
        errors.push(`Role '${task.role}' not allowed in '${project.currentPhase}' phase`);
      }
    }

    // Hours validation
    if (task.hoursWorked && task.hoursWorked <= 0) {
      errors.push("Hours worked must be greater than 0");
    }

    if (task.estimateHours && task.estimateHours <= 0) {
      errors.push("Estimated hours must be greater than 0");
    }

    if (errors.length > 0) {
      return res.status(400).json({
        message: "Task cannot be approved",
        errors
      });
    }

    // Approve the task
    task.approvedByManager = true;
    task.approvedBy = req.user._id;
    task.approvedAt = new Date();
    await task.save();

    // Get populated task for response
    const populatedTask = await Task.findById(task._id)
      .populate("projectId", "name code")
      .populate("assignedUserId", "fullName email")
      .populate("approvedBy", "fullName email");

    res.json({
      message: "Task approved successfully",
      task: populatedTask
    });
  } catch (err) {
    console.error("Approve task error:", err);
    res.status(500).json({ message: "Error approving task" });
  }
});

/* =====================================================
   UNAPPROVE TASK (MANAGER/ADMIN ONLY)
   ===================================================== */
router.patch("/:id/unapprove", async (req, res) => {
  try {
    if (!req.user.isManager && !["manager", "admin"].includes(req.user.role)) {
      return res.status(403).json({ 
        message: "Only managers and admins can unapprove tasks" 
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    if (!task.approvedByManager) {
      return res.status(400).json({
        message: "Task is not approved"
      });
    }

    task.approvedByManager = false;
    task.approvedBy = null;
    task.approvedAt = null;
    await task.save();

    res.json({
      message: "Task unapproved successfully",
      task
    });
  } catch (err) {
    console.error("Unapprove task error:", err);
    res.status(500).json({ message: "Error unapproving task" });
  }
});

/* =====================================================
   GET TASK STATISTICS
   ===================================================== */
router.get("/stats/overview", async (req, res) => {
  try {
    const query = req.user.role === "employee"
      ? { assignedUserId: req.user._id }
      : {};

    const tasks = await Task.find(query);

    const stats = {
      totalTasks: tasks.length,
      approvedTasks: tasks.filter(t => t.approvedByManager).length,
      pendingTasks: tasks.filter(t => !t.approvedByManager).length,
      totalHoursWorked: tasks.reduce((sum, t) => sum + (t.hoursWorked || 0), 0),
      totalEstimatedHours: tasks.reduce((sum, t) => sum + (t.estimateHours || 0), 0),
      byStatus: {},
      byPriority: {},
    };

    tasks.forEach(task => {
      if (task.status) {
        stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
      }
      if (task.clientPriority) {
        stats.byPriority[task.clientPriority] = (stats.byPriority[task.clientPriority] || 0) + 1;
      }
    });

    res.json(stats);
  } catch (err) {
    console.error("Get task stats error:", err);
    res.status(500).json({ message: "Error fetching task statistics" });
  }
});

/* =====================================================
   DELETE TASK (DISABLED)
   ===================================================== */
router.delete("/:id", (req, res) => {
  res.status(403).json({ 
    message: "Task deletion is disabled. Use archive/unapprove instead." 
  });
});

export default router;
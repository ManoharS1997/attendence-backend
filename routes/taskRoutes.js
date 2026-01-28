// routes/taskRoutes.js
import express from "express";
import mongoose from "mongoose"; // ✅ ADDED: import mongoose for ObjectId validation
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import { authMiddleware } from "../middleware/auth.js";
import { countWorkingDaysInRange } from "../utils/holidays.js";

const router = express.Router();

// 🔐 Apply auth middleware
router.use(authMiddleware);

/* =====================================================
   HELPER FUNCTIONS
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

/**
 * Apply task hours to project balance
 */
const applyTaskToProject = async (task, project) => {
  // SAFETY: do not double count
  if (task.countedInProject) return;

  // RULE 1: Developer tasks must NOT reduce project balance
  const taskRole = (task.requirementRole ?? task.role ?? "").toUpperCase();
  if (taskRole === "DEVELOPER") return;

  // RULE 2: Task must be COMPLETED
  const isCompleted =
    task.status === "COMPLETED" ||
    (task.phase && task.phase === "COMPLETED");

  if (!isCompleted) return;

  // RULE 3: Task date must be within project duration
  const taskDate = task.workDate || task.createdAt;
  if (taskDate) {
    const td = new Date(taskDate);
    const ps = new Date(project.startDate);
    const pe = new Date(project.endDate);
    if (td < ps || td > pe) return;
  }

  // RULE 4: Get hours safely
  const hours = task.estimateHours ?? task.hoursWorked ?? 0;
  if (hours <= 0) return;

  // RULE 5: Apply hours to project
  project.consumedHours += hours;

  const roleEntry = project.consumptionByRole.find(
    r => r.role === taskRole
  );

  if (roleEntry) {
    roleEntry.consumedHours += hours;
  } else {
    project.consumptionByRole.push({
      role: taskRole,
      consumedHours: hours
    });
  }

  await project.save();

  // RULE 6: Mark task as counted
  task.countedInProject = true;
  task.countedHours = hours;
  task.countedAt = new Date();
  await task.save();
};


/**
 * Revert task hours from project balance
 */
const revertTaskFromProject = async (task, project) => {
  if (!task.countedInProject) return;

  const hours = task.countedHours;
  const taskRole = task.requirementRole ?? task.role ?? "DEVELOPER";

  project.consumedHours -= hours;

  const roleEntry = project.consumptionByRole.find(
    r => r.role === taskRole
  );

  if (roleEntry) {
    roleEntry.consumedHours -= hours;
    // Optional: Remove role entry if consumedHours becomes 0
    if (roleEntry.consumedHours <= 0) {
      project.consumptionByRole = project.consumptionByRole.filter(
        r => r.role !== taskRole
      );
    }
  }

  await project.save();

  task.countedInProject = false;
  task.countedHours = 0;
  task.countedAt = null;
  await task.save();
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
      requirementRole, // ✅ ADDED: requirementRole from request body
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

    // ✅ CRITICAL FIX: Prevent employees from creating tasks in unapproved projects
    if (
      req.user.role === "employee" && 
      project.status !== "APPROVED"
    ) {
      return res.status(400).json({
        message: "Project must be approved before employees can create tasks"
      });
    }

    // Role-phase validation (for legacy system)
    if (role && project.currentPhase) {
      const normalizedRole = role.toUpperCase();
      if (!isRoleAllowedForPhase(normalizedRole, project.currentPhase)) {
        return res.status(400).json({
          message: `Role '${normalizedRole}' is not allowed in '${project.currentPhase}' phase`,
          allowedRoles: {
            DEVELOPMENT: ["DEVELOPER", "TECH_LEAD"],
            DEPLOYMENT: ["DEVOPS"],
            TESTING: ["QA", "TESTER"],
            REVIEW: ["PRODUCT_MANAGER", "TECH_LEAD"],
            PLANNING: ["PROJECT_MANAGER", "ANALYST", "ARCHITECT"],
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

    // ✅ FIX: Determine requirementRole from request or default
    let finalRequirementRole = "DEVELOPER"; // Default
    if (requirementRole) {
      finalRequirementRole = requirementRole;
    } else if (role) {
      finalRequirementRole = role;
    } else if (req.user.role === "manager") {
      finalRequirementRole = "PROJECT_MANAGER";
    } else if (req.user.role === "admin") {
      finalRequirementRole = "ADMINISTRATOR";
    }

    // Validate requirementRole value
    const validRequirementRoles = [
      "DEVELOPER", "TECH_LEAD", "DEVOPS", "QA", "TESTER",
      "PRODUCT_MANAGER", "PROJECT_MANAGER", "ANALYST", "ARCHITECT", "ADMINISTRATOR"
    ];
    const normalizedRequirementRole = finalRequirementRole.toUpperCase();
    if (!validRequirementRoles.includes(normalizedRequirementRole)) {
      return res.status(400).json({
        message: `Invalid requirement role: ${finalRequirementRole}`,
        validRoles: validRequirementRoles
      });
    }

    // Build task data
    const taskData = {
      projectId,
      assignedUserId: finalAssignedUserId,
      createdByUserId: req.user._id,
      createdByRole: req.user.role,
      approvedByManager: false,
      // ✅ FIX: Add the missing required field
      requirementRole: normalizedRequirementRole,
    };

    // ✅ CRITICAL FIX: Determine schema based on provided fields
    const isNewSystem = recentRequirement !== undefined || req.body.requirement !== undefined;
    
    if (isNewSystem) {
      Object.assign(taskData, {
        recentRequirement: recentRequirement?.trim() || "Requirement not specified",
        requirementType: requirementType || "NEW",
        status: status || "OPEN",
        scope: scope || "AGREED",
        notes: notes || "",
        discussedDate,
        originalClosureDate,
        estimatedDate,
        noOfDays: workingDays,
        estimateHours: Math.max(Number(estimateHours) || 8, 0.5),
        clientPriority: clientPriority || "P3",
        prioritySource: (prioritySource || "CLIENT").toUpperCase(),
        role: normalizedRequirementRole, // ✅ ADDED: Include role for new system
      });
    } else {
      // Legacy task system
      Object.assign(taskData, {
        role: role ? role.toUpperCase() : "DEVELOPER",
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
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({
        message: `Duplicate task detected. A task with this ${field} already exists.`
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
    let query = {};

    if (req.user.role === "employee") {
      query = { assignedUserId: req.user._id };
    }

    if (req.user.role === "manager") {
      query = {
        $or: [
          { assignedUserId: req.user._id },
          { createdByUserId: req.user._id }
        ]
      };
    }

    if (req.user.role === "admin") {
      query = { createdByUserId: req.user._id };
    }

    const tasks = await Task.find(query)
      .populate("projectId", "name code currentPhase status")
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email role")
      .populate("approvedBy", "fullName email")
      .sort({ createdAt: -1 });

    res.json({ tasks });
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
    const { id } = req.params;

    // ✅ FIX: prevent "all-admin" crash
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid task id"
      });
    }

    const task = await Task.findById(id)
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
      // Prevent changes to counted tasks (balance safety)
      if (task.countedInProject) {
        const blockedFields = ["hoursWorked", "estimateHours", "role", "requirementRole"]; // ✅ ADDED requirementRole
        for (const field of blockedFields) {
          if (req.body[field] !== undefined) {
            return res.status(400).json({
              message: `Cannot modify ${field} after task is approved`
            });
          }
        }
      }

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
      const normalizedRole = req.body.role.toUpperCase();
      if (!isRoleAllowedForPhase(normalizedRole, project.currentPhase)) {
        return res.status(400).json({
          message: `Role '${normalizedRole}' not allowed in current project phase '${project.currentPhase}'`
        });
      }
    }

    // Validate requirementRole if provided
    if (req.body.requirementRole) {
      const validRequirementRoles = [
        "DEVELOPER", "TECH_LEAD", "DEVOPS", "QA", "TESTER",
        "PRODUCT_MANAGER", "PROJECT_MANAGER", "ANALYST", "ARCHITECT", "ADMINISTRATOR"
      ];
      const normalizedRole = req.body.requirementRole.toUpperCase();
      if (!validRequirementRoles.includes(normalizedRole)) {
        return res.status(400).json({
          message: `Invalid requirement role: ${req.body.requirementRole}`,
          validRoles: validRequirementRoles
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

    // Normalize role if provided
    if (req.body.role) {
      req.body.role = req.body.role.toUpperCase();
    }

    // Normalize requirementRole if provided
    if (req.body.requirementRole) {
      req.body.requirementRole = req.body.requirementRole.toUpperCase();
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
    
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({
        message: `Duplicate task detected. A task with this ${field} already exists.`
      });
    }
    
    res.status(500).json({ message: "Error updating task" });
  }
});

/* =====================================================
   APPROVE TASK (MANAGER/ADMIN ONLY) - Updated with project balance
   ===================================================== */
router.patch("/:id/approve", async (req, res) => {
  try {
    // Authorization check
    if (!["manager", "admin"].includes(req.user.role)) {
      return res.status(403).json({ 
        message: "Only managers and admins can approve tasks" 
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // ✅ SAFETY FIX: Check if already counted in project
    if (task.countedInProject) {
      return res.status(400).json({
        message: "Task already counted in project balance"
      });
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

    // Check if project is approved
    if (project.status !== "APPROVED") {
      // Block task approval after project completion
      if (project.status === "COMPLETED") {
        return res.status(400).json({
          message: "Project is already COMPLETED. No further task approvals allowed."
        });
      }

      return res.status(400).json({
        message: "Project must be approved before approving tasks"
      });
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

    // Check if task is completed before approval
    const isCompleted = task.status === "COMPLETED" || (task.phase && task.phase === "COMPLETED");
    if (!isCompleted) {
      errors.push("Task must be COMPLETED before approval");
    }

    // Validate requirementRole exists
    if (!task.requirementRole) {
      errors.push("Task must have a valid requirementRole");
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

    // Apply task hours to project balance
    await applyTaskToProject(task, project);

    // Get populated task for response
    const populatedTask = await Task.findById(task._id)
      .populate("projectId", "name code consumedHours balanceHours")
      .populate("assignedUserId", "fullName email")
      .populate("approvedBy", "fullName email");

    res.json({
      message: "Task approved and project balance updated",
      task: populatedTask,
      projectBalance: project.balanceHours,
    });
  } catch (err) {
    console.error("Approve task error:", err);
    res.status(500).json({ message: "Error approving task" });
  }
});

/* =====================================================
   UNAPPROVE TASK (MANAGER/ADMIN ONLY) - Updated with project balance
   ===================================================== */
router.patch("/:id/unapprove", async (req, res) => {
  try {
    if (!["manager", "admin"].includes(req.user.role)) {
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

    // Get project
    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Revert task hours from project balance
    await revertTaskFromProject(task, project);

    task.approvedByManager = false;
    task.approvedBy = null;
    task.approvedAt = null;
    await task.save();

    res.json({
      message: "Task unapproved and project balance restored",
      task,
      projectBalance: project.balanceHours,
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
      byRequirementRole: {}, // ✅ ADDED: Statistics by requirementRole
    };

    tasks.forEach(task => {
      if (task.status) {
        stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
      }
      if (task.clientPriority) {
        stats.byPriority[task.clientPriority] = (stats.byPriority[task.clientPriority] || 0) + 1;
      }
      if (task.requirementRole) { // ✅ ADDED: Track requirementRole stats
        stats.byRequirementRole[task.requirementRole] = (stats.byRequirementRole[task.requirementRole] || 0) + 1;
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
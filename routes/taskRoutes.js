// routes/taskRoutes.js
import express from "express";
import mongoose from "mongoose";
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// 🔐 Apply auth middleware
router.use(authMiddleware);

/* =====================================================
   HELPER FUNCTIONS
   ===================================================== */

/**
 * Socket.IO emit helper for dashboard updates
 */
const emitDashboardUpdate = (req, type, payload = {}) => {
  const io = req.app.get("io");
  if (io) {
    io.emit("dashboard:update", {
      type,
      timestamp: new Date(),
      ...payload
    });
    console.log(`📡 Socket emitted: ${type}`);
  }
};

/**
 * Normalize role string to uppercase for consistent comparison
 */
const normalizeRole = (role) => {
  if (!role) return '';
  return role.toString().toUpperCase();
};

/**
 * Check if user can edit this task
 */
const canEditTask = (user, task) => {
  // Admin cannot edit
  if (user.role === "admin") return false;

  const userRole = normalizeRole(user.role);
  const taskCreatedByRole = normalizeRole(task.createdByRole);

  // Employee can edit tasks they created
  if (
    userRole === "EMPLOYEE" &&
    taskCreatedByRole === "EMPLOYEE" &&
    task.createdByUserId.toString() === user._id.toString()
  ) {
    return true;
  }

  // Manager can edit ANY task (employee or manager created)
  if (userRole === "MANAGER") {
    return true;
  }

  return false;
};

/**
 * Check if user can view this task
 */
const canViewTask = (user, task) => {
  // Admin can view everything
  if (user.role === "admin") return true;

  // Manager can view everything
  if (user.role === "manager") return true;

  // Employee can view tasks assigned to them or created by them
  if (user.role === "employee") {
    return (
      task.assignedUserId?.toString() === user._id.toString() ||
      task.createdByUserId.toString() === user._id.toString()
    );
  }

  return false;
};

/**
 * Update project balance when task is completed
 */
const applyCompletedTaskToProject = async (task, project) => {
  // Safety: do not double count
  if (task.countedInProject || task.status !== "COMPLETED") return;

  // Developer tasks do NOT reduce balance
  const taskRole = normalizeRole(task.assignedUserRole || task.role);
  if (taskRole === "DEVELOPER") return;

  const hours = task.estimateHours || 0;
  if (hours <= 0) return;

  // Find or create monthly consumption entry
  const month = task.month;
  const year = task.year;
  
  let monthlyEntry = project.monthlyConsumption.find(
    entry => entry.year === year && entry.month === month
  );
  
  if (!monthlyEntry) {
    monthlyEntry = { year, month, consumedHours: 0 };
    project.monthlyConsumption.push(monthlyEntry);
  }
  
  // Update project balance
  monthlyEntry.consumedHours += hours;
  project.consumedHours += hours;

  // Update role consumption
  const roleEntry = project.consumptionByRole?.find(
    r => normalizeRole(r.role) === taskRole
  );

  if (roleEntry) {
    roleEntry.consumedHours += hours;
  } else {
    if (!project.consumptionByRole) project.consumptionByRole = [];
    project.consumptionByRole.push({
      role: taskRole,
      consumedHours: hours
    });
  }

  await project.save();

  // Mark task as counted
  task.countedInProject = true;
  task.countedAt = new Date();
  await task.save();
};

// ===============================
// ADMIN – GET ALL TASKS (VIEW ONLY)
// ===============================
router.get("/all-admin", async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access only" });
    }

    const tasks = await Task.find({})
      .populate("projectId", "name code status")
      .populate("assignedUserId", "fullName email employeeId")
      .populate("createdByUserId", "fullName email employeeId")
      .sort({ createdAt: -1 });

    // Format tasks for admin view
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      project: task.projectId ? `${task.projectId.name} (${task.projectId.code})` : 'N/A',
      requirement: task.title || 'N/A',
      requirementType: task.requirementType || 'N/A',
      assignedTo: task.assignedUserId ? `${task.assignedUserId.fullName} (${task.assignedUserId.email})` : 'Unassigned',
      status: task.status || 'OPEN',
      scope: task.scope || 'AGREED',
      notes: task.notes || '',
      discussedDate: task.discussedDate || '',
      startDate: task.estimatedDate || '',
      closeDate: task.originalClosureDate || '',
      workingDays: task.noOfDays || 0,
      clientPriority: task.clientPriority || 'P3',
      givenBy: task.prioritySource === 'CLIENT' ? 'Client' : 'Internal',
      createdBy: task.createdByUserId ? `${task.createdByUserId.fullName}` : 'Unknown',
      createdByRole: task.createdByRole,
      createdAt: task.createdAt,
      estimateHours: task.estimateHours || 0,
      month: task.month,
      year: task.year
    }));

    res.json(formattedTasks);
  } catch (err) {
    console.error("Admin fetch tasks error:", err);
    res.status(500).json({ message: "Failed to load admin tasks" });
  }
});

/* =====================================================
   CREATE TASK - FIXED FOR EMPLOYEE & MANAGER
   ===================================================== */
router.post("/", async (req, res) => {
  try {
    const {
      projectId,
      assignedUserId,
      assignedUserRole,
      title,
      description,
      estimateHours,
      month,
      year,
      notes,
      recentRequirement,
      requirementType,
      scope,
      discussedDate,
      originalClosureDate,
      estimatedDate,
      clientPriority,
      prioritySource
    } = req.body;

    const userRole = req.user.role;
    const userId = req.user._id;

    // VALIDATION BASED ON USER ROLE
    let validationErrors = [];

    if (userRole === "employee") {
      // Employee: Only require estimateHours
      if (!estimateHours) {
        validationErrors.push("estimateHours");
      }
      
      // Auto-fill missing fields for employees
      let finalProjectId = projectId;
      if (!finalProjectId) {
        // Get employee's first assigned project
        const userProjects = await Project.find({
          "assignments.user": userId,
          status: "APPROVED"
        });
        
        if (userProjects.length === 0) {
          return res.status(400).json({
            message: "You are not assigned to any approved project"
          });
        }
        finalProjectId = userProjects[0]._id;
      }

      // Validate project exists and user is assigned
      const project = await Project.findById(finalProjectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const isAssigned = project.assignments?.some(
        assignment => assignment.user.toString() === userId.toString()
      );
      if (!isAssigned) {
        return res.status(403).json({
          message: "You are not assigned to this project"
        });
      }

      // Auto-fill task title if not provided
      const finalTitle = title || `Task ${new Date().toLocaleDateString()} ${Date.now().toString().slice(-4)}`;
      
      // Auto-set current month/year
      const now = new Date();
      const finalMonth = month || now.getMonth() + 1;
      const finalYear = year || now.getFullYear();

      // Create task data for employee
      const taskData = {
        projectId: finalProjectId,
        assignedUserId: userId,
        assignedUserRole: "EMPLOYEE",
        createdByUserId: userId,
        createdByRole: "employee", // lowercase as per schema
        title: finalTitle.trim(),
        description: description?.trim() || "",
        estimateHours: Math.max(Number(estimateHours), 0.5),
        month: finalMonth,
        year: finalYear,
        notes: notes?.trim() || "",
        recentRequirement: recentRequirement?.trim() || "General task",
        requirementType: requirementType || "NEW",
        status: "OPEN",
        scope: scope || "AGREED",
        discussedDate: discussedDate || "",
        originalClosureDate: originalClosureDate || "",
        estimatedDate: estimatedDate || "",
        noOfDays: 0,
        clientPriority: clientPriority || "P3",
        prioritySource: prioritySource || "CLIENT"
      };

      // Calculate noOfDays if dates provided
      if (originalClosureDate && estimatedDate) {
        const start = new Date(originalClosureDate);
        const end = new Date(estimatedDate);
        const diffTime = Math.abs(end - start);
        taskData.noOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      const task = await Task.create(taskData);
      const populatedTask = await Task.findById(task._id)
        .populate("projectId", "name code")
        .populate("assignedUserId", "fullName email")
        .populate("createdByUserId", "fullName email");

      // 🚀 Emit socket event for instant dashboard update
      emitDashboardUpdate(req, "TASK_CREATED", {
        taskId: populatedTask._id,
        projectId: finalProjectId,
        createdBy: userId,
        role: "employee"
      });

      return res.status(201).json(populatedTask);

    } else if (userRole === "manager") {
      // Manager: Require basic fields
      if (!projectId) validationErrors.push("projectId");
      if (!title) validationErrors.push("title");
      if (!estimateHours) validationErrors.push("estimateHours");
      
      if (validationErrors.length > 0) {
        return res.status(400).json({
          message: `Missing required fields: ${validationErrors.join(", ")}`
        });
      }

      // Validate project exists
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Auto-set current month/year if not provided
      const now = new Date();
      const finalMonth = month || now.getMonth() + 1;
      const finalYear = year || now.getFullYear();

      // Determine assigned user and role
      let finalAssignedUserId = assignedUserId || userId;
      let finalAssignedUserRole = assignedUserRole || "EMPLOYEE";
      
      // If manager is assigning to someone else, use provided role
      if (assignedUserId && assignedUserId !== userId.toString()) {
        finalAssignedUserRole = assignedUserRole || "EMPLOYEE";
      } else {
        // Manager creating task for themselves
        finalAssignedUserRole = "MANAGER";
      }

      // Validate role
      const validRoles = ["EMPLOYEE", "MANAGER", "ADMIN"];
      if (!validRoles.includes(finalAssignedUserRole.toUpperCase())) {
        return res.status(400).json({ 
          message: "assignedUserRole must be one of: EMPLOYEE, MANAGER, ADMIN" 
        });
      }

      // Create task data for manager
      const taskData = {
        projectId,
        assignedUserId: finalAssignedUserId,
        assignedUserRole: finalAssignedUserRole.toUpperCase(),
        createdByUserId: userId,
        createdByRole: "manager", // lowercase as per schema
        title: title.trim(),
        description: description?.trim() || "",
        estimateHours: Math.max(Number(estimateHours), 0.5),
        month: finalMonth,
        year: finalYear,
        notes: notes?.trim() || "",
        recentRequirement: recentRequirement?.trim() || "Manager task",
        requirementType: requirementType || "NEW",
        status: "OPEN",
        scope: scope || "AGREED",
        discussedDate: discussedDate || "",
        originalClosureDate: originalClosureDate || "",
        estimatedDate: estimatedDate || "",
        noOfDays: 0,
        clientPriority: clientPriority || "P3",
        prioritySource: prioritySource || "MANAGER"
      };

      // Calculate noOfDays if dates provided
      if (originalClosureDate && estimatedDate) {
        const start = new Date(originalClosureDate);
        const end = new Date(estimatedDate);
        const diffTime = Math.abs(end - start);
        taskData.noOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      const task = await Task.create(taskData);
      const populatedTask = await Task.findById(task._id)
        .populate("projectId", "name code")
        .populate("assignedUserId", "fullName email")
        .populate("createdByUserId", "fullName email");

      // 🚀 Emit socket event for instant dashboard update
      emitDashboardUpdate(req, "TASK_CREATED", {
        taskId: populatedTask._id,
        projectId,
        createdBy: userId,
        role: "manager"
      });

      return res.status(201).json(populatedTask);

    } else if (userRole === "admin") {
      return res.status(403).json({ 
        message: "Admin cannot create tasks" 
      });
    } else {
      return res.status(403).json({ 
        message: "Unauthorized access" 
      });
    }

  } catch (err) {
    console.error("Create task error:", err);
    
    if (err.name === "ValidationError") {
      return res.status(400).json({
        message: "Validation failed",
        errors: Object.values(err.errors).map(e => e.message)
      });
    }
    
    if (err.code === 11000) {
      return res.status(400).json({
        message: "Duplicate task found"
      });
    }
    
    res.status(500).json({
      message: "Error creating task",
      error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
});

/* =====================================================
   GET MY TASKS - ENHANCED WITH ALL FIELDS
   ===================================================== */
router.get("/my", async (req, res) => {
  try {
    let query = {};

    // Employee: see tasks assigned to them or created by them
    if (req.user.role === "employee") {
      query = {
        $or: [
          { assignedUserId: req.user._id },
          { createdByUserId: req.user._id }
        ]
      };
    }
    
    // Manager: see all tasks in their managed projects
    if (req.user.role === "manager") {
      const managedProjects = await Project.find({ manager: req.user._id }).select("_id");
      const projectIds = managedProjects.map(p => p._id);
      
      if (projectIds.length === 0) {
        return res.json({ tasks: [] });
      }
      
      query = { projectId: { $in: projectIds } };
    }
    
    // Admin: see all tasks (handled in /all-admin)
    if (req.user.role === "admin") {
      query = {};
    }

    const tasks = await Task.find(query)
      .populate("projectId", "name code status")
      .populate("assignedUserId", "fullName email employeeId")
      .populate("createdByUserId", "fullName email employeeId")
      .sort({ createdAt: -1 });

    // Format tasks with all fields
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      sno: tasks.indexOf(task) + 1,
      project: task.projectId ? `${task.projectId.name} (${task.projectId.code})` : 'N/A',
      projectStatus: task.projectId?.status || 'N/A',
      requirement: task.title || 'N/A',
      requirementType: task.requirementType || 'N/A',
      assignedTo: task.assignedUserId ? task.assignedUserId.fullName : 'Unassigned',
      assignedToEmail: task.assignedUserId?.email || '',
      status: task.status || 'OPEN',
      scope: task.scope || 'AGREED',
      notes: task.notes || '',
      discussedDate: task.discussedDate || '',
      startDate: task.estimatedDate || '',
      closeDate: task.originalClosureDate || '',
      workingDays: task.noOfDays || 0,
      clientPriority: task.clientPriority || 'P3',
      givenBy: task.prioritySource === 'CLIENT' ? 'Client' : 'Internal',
      createdBy: task.createdByUserId ? task.createdByUserId.fullName : 'Unknown',
      createdByEmail: task.createdByUserId?.email || '',
      createdByRole: task.createdByRole,
      createdAt: task.createdAt,
      estimateHours: task.estimateHours || 0,
      month: task.month,
      year: task.year,
      canEdit: canEditTask(req.user, task)
    }));

    res.json({ tasks: formattedTasks });
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

    // Check project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Check permissions
    // Manager of this project
    if (req.user.role === "manager" && project.manager.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "You are not the manager of this project"
      });
    }

    // Employee must be assigned to project
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

    let query = { projectId };
    
    // Employee can only see their own tasks
    if (req.user.role === "employee") {
      query = {
        projectId,
        $or: [
          { assignedUserId: req.user._id },
          { createdByUserId: req.user._id }
        ]
      };
    }

    const tasks = await Task.find(query)
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email")
      .sort({ createdAt: -1 });

    // Format tasks
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      sno: tasks.indexOf(task) + 1,
      project: `${project.name} (${project.code})`,
      requirement: task.title,
      type: task.requirementType,
      assignedTo: task.assignedUserId?.fullName || 'Unassigned',
      status: task.status,
      scope: task.scope,
      notes: task.notes,
      discussedDate: task.discussedDate,
      startDate: task.estimatedDate,
      closeDate: task.originalClosureDate,
      workingDays: task.noOfDays,
      clientPriority: task.clientPriority,
      givenBy: task.prioritySource === 'CLIENT' ? 'Client' : 'Internal',
      createdBy: task.createdByUserId?.fullName || 'Unknown',
      estimateHours: task.estimateHours,
      canEdit: canEditTask(req.user, task)
    }));

    // Calculate statistics
    const stats = {
      total: tasks.length,
      byStatus: {
        OPEN: tasks.filter(t => t.status === "OPEN").length,
        IN_PROGRESS: tasks.filter(t => t.status === "IN_PROGRESS").length,
        ON_HOLD: tasks.filter(t => t.status === "ON_HOLD").length,
        COMPLETED: tasks.filter(t => t.status === "COMPLETED").length,
      }
    };

    res.json({ tasks: formattedTasks, stats, project: { name: project.name, code: project.code } });
  } catch (err) {
    console.error("Fetch project tasks error:", err);
    res.status(500).json({ message: "Error fetching project tasks" });
  }
});

/* =====================================================
   GET ALL TASKS FOR MANAGER (WITH ALL FIELDS)
   ===================================================== */
router.get("/all-manager", async (req, res) => {
  try {
    if (req.user.role !== "manager") {
      return res.status(403).json({ message: "Manager access only" });
    }

    // Get all projects managed by this manager
    const managedProjects = await Project.find({ manager: req.user._id }).select("_id");
    const projectIds = managedProjects.map(p => p._id);
    
    if (projectIds.length === 0) {
      return res.json({ tasks: [] });
    }

    // Get all tasks from managed projects
    const tasks = await Task.find({ projectId: { $in: projectIds } })
      .populate("projectId", "name code status")
      .populate("assignedUserId", "fullName email employeeId")
      .populate("createdByUserId", "fullName email employeeId")
      .sort({ createdAt: -1 });

    // Format with all fields for manager view
    const formattedTasks = tasks.map((task, index) => ({
      sno: index + 1,
      _id: task._id,
      project: task.projectId ? `${task.projectId.name} (${task.projectId.code})` : 'N/A',
      requirement: task.title || 'N/A',
      requirementType: task.requirementType || 'N/A',
      employee: task.assignedUserId ? `${task.assignedUserId.fullName}` : 'Unassigned',
      status: task.status || 'OPEN',
      scope: task.scope || 'AGREED',
      notes: task.notes || '',
      discussedDate: task.discussedDate || '',
      startDate: task.estimatedDate || '',
      closeDate: task.originalClosureDate || '',
      workingDays: task.noOfDays || 0,
      clientPriority: task.clientPriority || 'P3',
      givenBy: task.prioritySource === 'CLIENT' ? 'Client' : 'Internal',
      createdBy: task.createdByUserId ? task.createdByUserId.fullName : 'Unknown',
      createdByEmail: task.createdByUserId?.email || '',
      createdByRole: task.createdByRole,
      createdAt: task.createdAt,
      estimateHours: task.estimateHours || 0,
      canEdit: true // Manager can edit all tasks
    }));

    res.json(formattedTasks);
  } catch (err) {
    console.error("Manager fetch all tasks error:", err);
    res.status(500).json({ message: "Failed to load tasks" });
  }
});

/* =====================================================
   GET SINGLE TASK
   ===================================================== */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const task = await Task.findById(id)
      .populate("projectId", "name code status manager assignments")
      .populate("assignedUserId", "fullName email employeeId")
      .populate("createdByUserId", "fullName email employeeId");

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Check view permissions
    if (!canViewTask(req.user, task)) {
      return res.status(403).json({
        message: "You do not have permission to view this task"
      });
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
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Check edit permissions
    if (!canEditTask(req.user, task)) {
      return res.status(403).json({
        message: "You do not have permission to edit this task"
      });
    }

    // Get project for validation
    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Cannot edit tasks in archived/completed projects
    if (["ARCHIVED", "COMPLETED"].includes(project.status)) {
      return res.status(400).json({
        message: `Cannot edit tasks in ${project.status.toLowerCase()} projects`
      });
    }

    // Cannot edit counted tasks (balance safety)
    if (task.countedInProject) {
      const blockedFields = ["estimateHours", "assignedUserRole", "status", "month", "year"];
      for (const field of blockedFields) {
        if (updates[field] !== undefined) {
          return res.status(400).json({
            message: `Cannot modify ${field} after task is counted in project balance`
          });
        }
      }
    }

    // Validate assignedUserRole if provided
    if (updates.assignedUserRole) {
      const validRoles = ["EMPLOYEE", "MANAGER", "ADMIN"];
      if (!validRoles.includes(updates.assignedUserRole.toUpperCase())) {
        return res.status(400).json({ 
          message: "assignedUserRole must be one of: EMPLOYEE, MANAGER, ADMIN" 
        });
      }
      updates.assignedUserRole = updates.assignedUserRole.toUpperCase();
    }

    // Validate estimate hours
    if (updates.estimateHours !== undefined) {
      updates.estimateHours = Math.max(Number(updates.estimateHours), 0.5);
    }

    // Calculate noOfDays if dates are updated
    if (updates.originalClosureDate && updates.estimatedDate) {
      const start = new Date(updates.originalClosureDate);
      const end = new Date(updates.estimatedDate);
      const diffTime = Math.abs(end - start);
      updates.noOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // Track status change for socket emission
    const wasCompleted = task.status === "COMPLETED";
    const isNowCompleted = updates.status === "COMPLETED";

    // Update task
    const updatedTask = await Task.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    )
      .populate("projectId", "name code")
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email");

    // If task status changed to COMPLETED, update project balance
    if (!wasCompleted && isNowCompleted) {
      await applyCompletedTaskToProject(updatedTask, project);
      
      // 🚀 Emit socket event for project balance update
      emitDashboardUpdate(req, "PROJECT_BALANCE_UPDATED", {
        projectId: project._id,
        taskId: updatedTask._id,
        hours: updatedTask.estimateHours
      });
    }

    // 🚀 Emit socket event for task update
    emitDashboardUpdate(req, "TASK_UPDATED", {
      taskId: updatedTask._id,
      projectId: project._id,
      status: updatedTask.status,
      changes: updates
    });

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
   DELETE TASK (DISABLED)
   ===================================================== */
router.delete("/:id", (req, res) => {
  res.status(403).json({
    message: "Task deletion is disabled. Tasks are immutable records."
  });
});

export default router;
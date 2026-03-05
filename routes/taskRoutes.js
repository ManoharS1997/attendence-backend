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

  // Manager is view only
  if (userRole === "MANAGER") {
    return false;
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

  const hours = task.estHours || 0;
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

/* =====================================================
   ADMIN – GET ALL TASKS (VIEW ONLY)
   ===================================================== */
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

    // Format tasks for admin view with all fields
    const formattedTasks = await Promise.all(
      tasks.map(async (task) => ({
        _id: task._id,
        project:
          task.projectId?.name ||
          (await Project.findById(task.projectId))?.name ||
          task.projectName ||
          "N/A",
        projectCode: task.projectId?.code || "N/A",
        projectStatus: task.projectId?.status || "N/A",
        requirement: task.requirement || task.recentRequirement || "N/A",
        type: task.type || task.requirementType || "N/A",
        assignedTo: task.assignedUserId ? `${task.assignedUserId.fullName} (${task.assignedUserId.email})` : "Unassigned",
        assignedToEmail: task.assignedUserId?.email || "",
        assignedToId: task.assignedUserId?.employeeId || "",
        employeeName: task.employeeName || "N/A",
        status: task.status || "OPEN",
        scope: task.scope || "AGREED",
        notes: task.notes || "",
        discussedDate: task.discussedDate || "",
        startDate: task.startDate || task.estimatedDate || "",
        closeDate: task.closeDate || task.originalClosureDate || "",
        workingDays: task.workingDays || task.noOfDays || 0,
        clientPriority: task.clientPriority || "P3",
        givenBy: task.givenBy || "N/A",
        createdBy: task.createdByName || "Unknown",
        createdByEmail: task.createdByUserId?.email || "",
        createdByRole: task.createdByRole,
        createdAt: task.createdAt,
        estHours: task.estHours || task.estimateHours || 0,
        month: task.month,
        year: task.year,
        countedInProject: task.countedInProject || false
      }))
    );

    res.json(formattedTasks);
  } catch (err) {
    console.error("Admin fetch tasks error:", err);
    res.status(500).json({ message: "Failed to load admin tasks" });
  }
});

/* =====================================================
   CREATE TASK - ONLY EMPLOYEE
   ===================================================== */
router.post("/", async (req, res) => {
  try {
    const {
      projectId,
      projectName,
      assignedUserId,
      title,
      description,
      estHours,
      month,
      year,
      notes,
      requirement,
      type,
      scope,
      discussedDate,
      closeDate,
      startDate,
      clientPriority,
      prioritySource,
      employeeName,
      createdByName
    } = req.body;

    const userRole = req.user.role;
    const userId = req.user._id;

    // Only employees can create tasks
    if (userRole !== "employee") {
      return res.status(403).json({ 
        message: "Only employees can create tasks" 
      });
    }

    // Employee: Only require estHours
    if (!estHours) {
      return res.status(400).json({
        message: "Missing required field: estHours"
      });
    }
    
    // Auto-fill missing fields for employees
    let finalProjectId = projectId;
    let finalProjectName = projectName;
    
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
      finalProjectName = userProjects[0].name;
    } else {
      // Get project name from database if not provided
      if (!finalProjectName) {
        const project = await Project.findById(finalProjectId);
        if (project) {
          finalProjectName = project.name;
        }
      }
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
      projectName: finalProjectName,
      assignedUserId: userId,
      createdByUserId: userId,
      createdByRole: "employee",
      employeeName: employeeName || req.user.fullName || "Employee",
      createdByName: createdByName || req.user.fullName || "Employee",
      title: finalTitle.trim(),
      description: description?.trim() || "",
      estHours: Math.max(Number(estHours), 0.5),
      month: finalMonth,
      year: finalYear,
      notes: notes?.trim() || "",
      requirement: requirement?.trim() || "General task",
      type: type || "NEW",
      status: "OPEN",
      scope: scope || "AGREED",
      discussedDate: discussedDate || "",
      closeDate: closeDate || "",
      startDate: startDate || "",
      workingDays: 0,
      clientPriority: clientPriority || "P3",
      prioritySource: prioritySource || "CLIENT",
      givenBy: req.user.fullName || "Employee"
    };

    // Calculate workingDays if dates provided
    if (closeDate && startDate) {
      const start = new Date(startDate);
      const end = new Date(closeDate);
      const diffTime = Math.abs(end - start);
      taskData.workingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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
   GET MY TASKS - EMPLOYEE VIEW
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

    // Format tasks with all fields (Employee View) - PERMANENT FIX APPLIED
    const formattedTasks = await Promise.all(
      tasks.map(async (task, index) => ({
        _id: task._id,
        sno: index + 1,
        project:
          task.projectId?.name ||
          (await Project.findById(task.projectId))?.name ||
          task.projectName ||
          "N/A",
        projectStatus: task.projectId?.status || "N/A",
        requirement: task.requirement || task.recentRequirement || "N/A",
        type: task.type || task.requirementType || "N/A",
        assignedTo: task.assignedUserId ? task.assignedUserId.fullName : "Unassigned",
        assignedToEmail: task.assignedUserId?.email || "",
        assignedToId: task.assignedUserId?.employeeId || "",
        employeeName: task.employeeName || "N/A",
        status: task.status || "OPEN",
        scope: task.scope || "AGREED",
        notes: task.notes || "",
        discussedDate: task.discussedDate || "",
        startDate: task.startDate || task.estimatedDate || "",
        closeDate: task.closeDate || task.originalClosureDate || "",
        workingDays: task.workingDays || task.noOfDays || 0,
        clientPriority: task.clientPriority || "P3",
        givenBy: task.givenBy || "N/A",
        createdBy: task.createdByName || "Unknown",
        createdByEmail: task.createdByUserId?.email || "",
        createdByRole: task.createdByRole,
        createdAt: task.createdAt,
        estHours: task.estHours || task.estimateHours || 0,
        month: task.month,
        year: task.year,
        canEdit: canEditTask(req.user, task)
      }))
    );

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
    if (req.user.role === "manager" && project.manager.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "You are not the manager of this project"
      });
    }

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

    // Format tasks with project name
    const formattedTasks = await Promise.all(
      tasks.map(async (task, index) => ({
        _id: task._id,
        sno: index + 1,
        project:
          task.projectId?.name ||
          (await Project.findById(task.projectId))?.name ||
          task.projectName ||
          `${project.name} (${project.code})`,
        requirement: task.requirement || task.recentRequirement || "N/A",
        type: task.type || task.requirementType || "N/A",
        assignedTo: task.assignedUserId?.fullName || "Unassigned",
        assignedToEmail: task.assignedUserId?.email || "",
        employeeName: task.employeeName || "N/A",
        status: task.status || "OPEN",
        scope: task.scope || "AGREED",
        notes: task.notes || "",
        discussedDate: task.discussedDate || "",
        startDate: task.startDate || task.estimatedDate || "",
        closeDate: task.closeDate || task.originalClosureDate || "",
        workingDays: task.workingDays || task.noOfDays || 0,
        clientPriority: task.clientPriority || "P3",
        givenBy: task.givenBy || (task.prioritySource === "CLIENT" ? "Client" : "Internal"),
        createdBy: task.createdByName || "Unknown",
        createdByEmail: task.createdByUserId?.email || "",
        estHours: task.estHours || task.estimateHours || 0,
        canEdit: canEditTask(req.user, task)
      }))
    );

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

    res.json({ 
      tasks: formattedTasks, 
      stats, 
      project: { name: project.name, code: project.code } 
    });
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
    const tasks = await Task.find({
      projectId: { $in: projectIds },
      createdByRole: "employee"
    })
      .populate("projectId", "name code status")
      .populate("assignedUserId", "fullName email employeeId")
      .populate("createdByUserId", "fullName email employeeId")
      .sort({ createdAt: -1 });

    // Format with all fields for manager view - PERMANENT FIX APPLIED
    const formattedTasks = await Promise.all(
      tasks.map(async (task, index) => ({
        sno: index + 1,
        _id: task._id,
        project:
          task.projectId?.name ||
          (await Project.findById(task.projectId))?.name ||
          task.projectName ||
          "N/A",
        projectCode: task.projectId?.code || "N/A",
        projectStatus: task.projectId?.status || "N/A",
        requirement: task.requirement || task.recentRequirement || "N/A",
        type: task.type || task.requirementType || "N/A",
        employee: task.employeeName || "N/A",
        assignedTo: task.assignedUserId?.fullName || "Unassigned",
        assignedToEmail: task.assignedUserId?.email || "",
        assignedToId: task.assignedUserId?.employeeId || "",
        status: task.status || "OPEN",
        scope: task.scope || "AGREED",
        notes: task.notes || "",
        discussedDate: task.discussedDate || "",
        startDate: task.startDate || task.estimatedDate || "",
        closeDate: task.closeDate || task.originalClosureDate || "",
        workingDays: task.workingDays || task.noOfDays || 0,
        clientPriority: task.clientPriority || "P3",
        givenBy: task.givenBy || "N/A",
        createdBy: task.createdByName || "Unknown",
        createdByEmail: task.createdByUserId?.email || "",
        createdByRole: task.createdByRole,
        createdAt: task.createdAt,
        estHours: task.estHours || task.estimateHours || 0,
        month: task.month,
        year: task.year,
        countedInProject: task.countedInProject || false,
        canEdit: false // Manager view only
      }))
    );

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

    // Get project name if needed
    let projectName = task.projectName;
    if (!projectName && task.projectId) {
      const project = await Project.findById(task.projectId);
      projectName = project?.name || "N/A";
    }

    // Format single task with all fields
    const formattedTask = {
      ...task.toObject(),
      project: projectName,
      requirement: task.requirement || task.recentRequirement,
      type: task.type || task.requirementType,
      startDate: task.startDate || task.estimatedDate,
      closeDate: task.closeDate || task.originalClosureDate,
      workingDays: task.workingDays || task.noOfDays,
      estHours: task.estHours || task.estimateHours,
      projectName: projectName,
      employeeName: task.employeeName,
      createdByName: task.createdByName
    };

    res.json(formattedTask);
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
      const blockedFields = ["estHours", "assignedUserRole", "status", "month", "year"];
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

    // Validate est hours
    if (updates.estHours !== undefined) {
      updates.estHours = Math.max(Number(updates.estHours), 0.5);
    }

    // Handle legacy field mappings
    if (updates.recentRequirement && !updates.requirement) {
      updates.requirement = updates.recentRequirement;
    }
    if (updates.requirementType && !updates.type) {
      updates.type = updates.requirementType;
    }
    if (updates.estimateHours && !updates.estHours) {
      updates.estHours = updates.estimateHours;
    }
    if (updates.estimatedDate && !updates.startDate) {
      updates.startDate = updates.estimatedDate;
    }
    if (updates.originalClosureDate && !updates.closeDate) {
      updates.closeDate = updates.originalClosureDate;
    }
    if (updates.noOfDays && !updates.workingDays) {
      updates.workingDays = updates.noOfDays;
    }

    // Calculate workingDays if dates are updated
    if (updates.closeDate && updates.startDate) {
      const start = new Date(updates.startDate);
      const end = new Date(updates.closeDate);
      const diffTime = Math.abs(end - start);
      updates.workingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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
      
      emitDashboardUpdate(req, "PROJECT_BALANCE_UPDATED", {
        projectId: project._id,
        taskId: updatedTask._id,
        hours: updatedTask.estHours
      });
    }

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
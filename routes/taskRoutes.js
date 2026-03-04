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

  const hours = task.estHours || 0;                    // FIXED: estimateHours → estHours
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

    // Format tasks for admin view with NEW field names
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      project: task.projectId ? `${task.projectId.name} (${task.projectId.code})` : 'N/A',
      requirement: task.requirement || 'N/A',                    // FIXED: recentRequirement → requirement
      type: task.type || 'N/A',                                   // FIXED: requirementType → type
      assignedTo: task.assignedUserId ? `${task.assignedUserId.fullName} (${task.assignedUserId.email})` : 'Unassigned',
      employeeName: task.employeeName || 'N/A',                   // ADDED: employeeName
      status: task.status || 'OPEN',
      scope: task.scope || 'AGREED',
      notes: task.notes || '',
      discussedDate: task.discussedDate || '',
      startDate: task.startDate || '',                             // FIXED: estimatedDate → startDate
      closeDate: task.closeDate || '',                             // FIXED: originalClosureDate → closeDate
      workingDays: task.workingDays || 0,                          // FIXED: noOfDays → workingDays
      clientPriority: task.clientPriority || 'P3',
      givenBy: task.givenBy || 'N/A',
      createdBy: task.createdByName || 'Unknown',                  // ADDED: createdByName
      createdByRole: task.createdByRole,
      createdAt: task.createdAt,
      estHours: task.estHours || 0,                                 // FIXED: estimateHours → estHours
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
   CREATE TASK - ONLY EMPLOYEE
   ===================================================== */
router.post("/", async (req, res) => {
  try {
    const {
      projectId,
      projectName,                                         // ADDED: projectName
      assignedUserId,
      title,
      description,
      estHours,                                            // FIXED: estimateHours → estHours
      month,
      year,
      notes,
      requirement,                                         // FIXED: recentRequirement → requirement
      type,                                                // FIXED: requirementType → type
      scope,
      discussedDate,
      closeDate,                                           // FIXED: originalClosureDate → closeDate
      startDate,                                           // FIXED: estimatedDate → startDate
      clientPriority,
      prioritySource,
      employeeName,                                        // ADDED: employeeName
      createdByName                                        // ADDED: createdByName
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

    // Create task data for employee with NEW field names
    const taskData = {
      projectId: finalProjectId,
      projectName: finalProjectName,                       // ADDED: projectName
      assignedUserId: userId,
      createdByUserId: userId,
      createdByRole: "employee",
      employeeName: employeeName || req.user.fullName || "Employee",    // ADDED: employeeName
      createdByName: createdByName || req.user.fullName || "Employee",  // ADDED: createdByName
      title: finalTitle.trim(),
      description: description?.trim() || "",
      estHours: Math.max(Number(estHours), 0.5),           // FIXED: estimateHours → estHours
      month: finalMonth,
      year: finalYear,
      notes: notes?.trim() || "",
      requirement: requirement?.trim() || "General task",  // FIXED: recentRequirement → requirement
      type: type || "NEW",                                  // FIXED: requirementType → type
      status: "OPEN",
      scope: scope || "AGREED",
      discussedDate: discussedDate || "",
      closeDate: closeDate || "",                           // FIXED: originalClosureDate → closeDate
      startDate: startDate || "",                           // FIXED: estimatedDate → startDate
      workingDays: 0,                                        // FIXED: noOfDays → workingDays
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

    // Format tasks with all fields (Employee View)
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      sno: tasks.indexOf(task) + 1,
      project: task.projectName || (task.projectId ? task.projectId.name : 'N/A'),  // ADDED: projectName
      projectStatus: task.projectId?.status || 'N/A',
      requirement: task.requirement || 'N/A',                // FIXED: recentRequirement → requirement
      type: task.type || 'N/A',                               // FIXED: requirementType → type
      assignedTo: task.assignedUserId ? task.assignedUserId.fullName : 'Unassigned',
      assignedToEmail: task.assignedUserId?.email || '',
      employeeName: task.employeeName || 'N/A',               // ADDED: employeeName
      status: task.status || 'OPEN',
      scope: task.scope || 'AGREED',
      notes: task.notes || '',
      discussedDate: task.discussedDate || '',
      startDate: task.startDate || '',                         // FIXED: estimatedDate → startDate
      closeDate: task.closeDate || '',                         // FIXED: originalClosureDate → closeDate
      workingDays: task.workingDays || 0,                      // FIXED: noOfDays → workingDays
      clientPriority: task.clientPriority || 'P3',
      givenBy: task.givenBy || 'N/A',
      createdBy: task.createdByName || 'Unknown',              // ADDED: createdByName
      createdByEmail: task.createdByUserId?.email || '',
      createdByRole: task.createdByRole,
      createdAt: task.createdAt,
      estHours: task.estHours || 0,                             // FIXED: estimateHours → estHours
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

    // Format tasks with NEW field names
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      sno: tasks.indexOf(task) + 1,
      project: task.projectName || `${project.name} (${project.code})`,  // ADDED: projectName
      requirement: task.requirement,                                      // FIXED: recentRequirement → requirement
      type: task.type,                                                    // FIXED: requirementType → type
      assignedTo: task.assignedUserId?.fullName || 'Unassigned',
      employeeName: task.employeeName || 'N/A',                           // ADDED: employeeName
      status: task.status,
      scope: task.scope,
      notes: task.notes,
      discussedDate: task.discussedDate,
      startDate: task.startDate,                                          // FIXED: estimatedDate → startDate
      closeDate: task.closeDate,                                          // FIXED: originalClosureDate → closeDate
      workingDays: task.workingDays,                                      // FIXED: noOfDays → workingDays
      clientPriority: task.clientPriority,
      givenBy: task.givenBy || (task.prioritySource === 'CLIENT' ? 'Client' : 'Internal'),
      createdBy: task.createdByName || 'Unknown',                         // ADDED: createdByName
      estHours: task.estHours,                                            // FIXED: estimateHours → estHours
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

    // Format with all fields for manager view (Manager/Admin View)
    const formattedTasks = tasks.map((task, index) => ({
      sno: index + 1,
      _id: task._id,
      project: task.projectName || (task.projectId ? `${task.projectId.name} (${task.projectId.code})` : 'N/A'),  // ADDED: projectName
      requirement: task.requirement || 'N/A',                // FIXED: recentRequirement → requirement
      type: task.type || 'N/A',                               // FIXED: requirementType → type
      employee: task.employeeName || 'N/A',                   // ADDED: employeeName
      status: task.status || 'OPEN',
      scope: task.scope || 'AGREED',
      notes: task.notes || '',
      discussedDate: task.discussedDate || '',
      startDate: task.startDate || '',                         // FIXED: estimatedDate → startDate
      closeDate: task.closeDate || '',                         // FIXED: originalClosureDate → closeDate
      workingDays: task.workingDays || 0,                      // FIXED: noOfDays → workingDays
      clientPriority: task.clientPriority || 'P3',
      givenBy: task.givenBy || 'N/A',
      createdBy: task.createdByName || 'Unknown',              // ADDED: createdByName
      createdByEmail: task.createdByUserId?.email || '',
      createdByRole: task.createdByRole,
      createdAt: task.createdAt,
      estHours: task.estHours || 0,                             // FIXED: estimateHours → estHours
      canEdit: false // Manager view only
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

    // Format single task with NEW field names
    const formattedTask = {
      ...task.toObject(),
      requirement: task.requirement,
      type: task.type,
      startDate: task.startDate,
      closeDate: task.closeDate,
      workingDays: task.workingDays,
      estHours: task.estHours,
      projectName: task.projectName,
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
      
      // 🚀 Emit socket event for project balance update
      emitDashboardUpdate(req, "PROJECT_BALANCE_UPDATED", {
        projectId: project._id,
        taskId: updatedTask._id,
        hours: updatedTask.estHours
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
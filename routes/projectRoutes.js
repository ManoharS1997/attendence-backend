// routes/projectRoutes.js
import express from "express";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import Log from "../models/Log.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { countWorkingDaysInRange, calculateDurationMonths } from "../utils/holidays.js";

const router = express.Router();

/* =====================================================
   HELPERS
   ===================================================== */

/**
 * Socket.IO emit helper for dashboard updates (matches taskRoutes)
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

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
};

const getAssignmentUserIdString = (assignment) => {
  if (!assignment.user) return "";
  if (assignment.user._id) return assignment.user._id.toString();
  return assignment.user.toString();
};

/* =====================================================
   CREATE PROJECT WITH AUTO-CALCULATION
   ===================================================== */
router.post(
  "/",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const {
        name,
        code,
        description,
        startDate,          // "DD-MM-YYYY" or ISO string
        endDate,            // "DD-MM-YYYY" or ISO string
        totalEstimatedHours, // Can be overridden by manager
        durationMonths,      // Can be overridden by manager
        currentPhase = "PLANNING",
        status = "DRAFT",
      } = req.body;

      // Validate required fields
      if (!name || !startDate || !endDate) {
        return res.status(400).json({ 
          message: "Name, startDate and endDate are required" 
        });
      }

      // Parse dates
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        
        // Try DD-MM-YYYY format
        if (dateStr.includes('-') && dateStr.split('-').length === 3) {
          const [dd, mm, yyyy] = dateStr.split("-").map((p) => parseInt(p, 10));
          if (dd && mm && yyyy) return new Date(yyyy, mm - 1, dd);
        }
        
        // Try ISO format
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? null : date;
      };

      const start = parseDate(startDate);
      const end = parseDate(endDate);
      
      if (!start || !end) {
        return res.status(400).json({ 
          message: "Invalid date format. Use DD-MM-YYYY or ISO format" 
        });
      }

      if (end < start) {
        return res.status(400).json({ 
          message: "End date cannot be before start date" 
        });
      }

      // Format dates for calculation
      const formatDateForCalc = (date) => {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      };

      const startStr = formatDateForCalc(start);
      const endStr = formatDateForCalc(end);

      // Calculate working days (excludes holidays)
      const workingDays = await countWorkingDaysInRange(startStr, endStr);
      
      // Calculate total hours (working days × 8 hours per day)
      const calculatedTotalHours = workingDays * 8;
      
      // Calculate duration in months
      const calculatedDurationMonths = calculateDurationMonths(startStr, endStr);

      // Use manager's values if provided, otherwise use calculated values
      const finalTotalHours = totalEstimatedHours || calculatedTotalHours;
      const finalDurationMonths = durationMonths || calculatedDurationMonths;

      const project = await Project.create({
        name,
        code: code || name.replace(/\s+/g, '_').toUpperCase(),
        description,
        startDate: start,
        endDate: end,
        totalEstimatedHours: finalTotalHours,
        durationMonths: finalDurationMonths,
        currentPhase,
        status,
        consumedHours: 0,
        balanceHours: finalTotalHours,
        assignments: [],
        consumptionByRole: [],
        manager: req.user.id,
      });

      // 🚀 Socket emit for project creation
      emitDashboardUpdate(req, "PROJECT_CREATED", {
        projectId: project._id,
        projectName: project.name,
        projectCode: project.code,
        status: project.status
      });

      // Log creation
      try {
        await Log.create({
          type: "OPERATION",
          action: "CREATE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Created project ${project.name} (${project.code})`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            startDate: startStr,
            endDate: endStr,
            workingDays,
            totalEstimatedHours: finalTotalHours,
            durationMonths: finalDurationMonths,
            calculation: {
              workingDays,
              calculatedTotalHours,
              managerOverrideHours: totalEstimatedHours ? true : false,
              managerOverrideMonths: durationMonths ? true : false
            }
          },
        });
      } catch (logErr) {
        console.error("Log CREATE_PROJECT error:", logErr.message);
      }

      res.status(201).json({
        ...project.toObject(),
        workingDays,
        calculatedTotalHours,
        calculatedDurationMonths,
        calculationNotes: {
          workingDaysFormula: "Excludes: Sundays, 2nd Saturdays, Public Holidays, Optional Holidays marked as TAKEN",
          totalHoursFormula: "Working days × 8 hours per day",
          durationFormula: "Months between start and end dates"
        }
      });
    } catch (err) {
      console.error("Create project error:", err);
      
      if (err.code === 11000) {
        return res.status(400).json({
          message: "Project with this name or code already exists"
        });
      }
      
      res.status(500).json({ message: "Project creation failed" });
    }
  }
);

/* =====================================================
   GET MY PROJECTS (EMPLOYEE VIEW) - FIXED WITH ROLE DISPLAY
   ===================================================== */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let projects;
    
    if (userRole === "employee") {
      // Employee: Get projects they're assigned to
      projects = await Project.find({
        "assignments.user": userId,
        status: { $ne: "ARCHIVED" }
      })
      .populate({
        path: "assignments.user",
        select: "fullName email role"
      })
      .populate("manager", "fullName email")
      .sort({ createdAt: -1 });
    } else if (userRole === "manager") {
      // Manager: Get projects they manage
      projects = await Project.find({
        manager: userId,
        status: { $ne: "ARCHIVED" }
      })
      .populate("assignments.user", "fullName email role")
      .populate("manager", "fullName email")
      .sort({ createdAt: -1 });
    } else if (userRole === "admin") {
      // Admin: Get all non-archived projects
      projects = await Project.find({
        status: { $ne: "ARCHIVED" }
      })
      .populate("assignments.user", "fullName email role")
      .populate("manager", "fullName email")
      .sort({ createdAt: -1 });
    } else {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    // Format response with proper role display
    const response = await Promise.all(
      projects.map(async (project) => {
        const formatDate = (date) => {
          if (!date) return '';
          const d = new Date(date);
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          return `${dd}-${mm}-${yyyy}`;
        };

        const startStr = formatDate(project.startDate);
        const endStr = formatDate(project.endDate);
        
        let workingDays = 0;
        if (startStr && endStr) {
          workingDays = await countWorkingDaysInRange(startStr, endStr);
        }

        const calculatedTotalHours = workingDays * 8;

        // Find user's role in project
        let myRole = null;
        let myAssignment = null;

        if (userRole === "employee") {
          // For employees, find their specific assignment
          myAssignment = project.assignments.find(
            assignment => getAssignmentUserIdString(assignment) === userId.toString()
          );
          myRole = myAssignment?.role || null;
        } else if (userRole === "manager") {
          // For managers, check if they're the project manager
          if (project.manager && project.manager._id.toString() === userId.toString()) {
            myRole = "Manager";
          } else {
            // Check if manager is also assigned as an employee
            myAssignment = project.assignments.find(
              assignment => getAssignmentUserIdString(assignment) === userId.toString()
            );
            myRole = myAssignment?.role || null;
          }
        } else if (userRole === "admin") {
          myRole = "Admin";
        }

        // Format project for response
        const projectObj = project.toObject();
        
        return {
          _id: projectObj._id,
          name: projectObj.name,
          code: projectObj.code,
          description: projectObj.description,
          status: projectObj.status,
          startDate: projectObj.startDate,
          endDate: projectObj.endDate,
          totalEstimatedHours: projectObj.totalEstimatedHours,
          balanceHours: projectObj.balanceHours,
          consumedHours: projectObj.consumedHours,
          durationMonths: projectObj.durationMonths,
          manager: projectObj.manager,
          assignments: projectObj.assignments,
          workingDays,
          calculatedTotalHours,
          calculationDifference: projectObj.totalEstimatedHours - calculatedTotalHours,
          myRole: myRole || "Not assigned", // Ensure "Not assigned" is only for employees without role
          canCreateTask: myRole !== null && projectObj.status === "APPROVED"
        };
      })
    );

    res.json(response);
  } catch (err) {
    console.error("My projects error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
   GET ALL PROJECTS (MANAGER/ADMIN VIEW) - ENHANCED
   ===================================================== */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      let query = {};
      
      if (req.user.role === "manager") {
        // Manager sees only their projects
        query = { manager: req.user.id };
      }
      // Admin sees all projects

      const projects = await Project.find(query)
        .populate("assignments.user", "fullName email role employeeId")
        .populate("manager", "fullName email")
        .sort({ createdAt: -1 });

      // Format response with working days calculation
      const response = await Promise.all(
        projects.map(async (project) => {
          const formatDate = (date) => {
            if (!date) return '';
            const d = new Date(date);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}-${mm}-${yyyy}`;
          };

          const startStr = formatDate(project.startDate);
          const endStr = formatDate(project.endDate);
          
          let workingDays = 0;
          if (startStr && endStr) {
            workingDays = await countWorkingDaysInRange(startStr, endStr);
          }

          const calculatedTotalHours = workingDays * 8;

          return {
            ...project.toObject(),
            workingDays,
            calculatedTotalHours,
            calculationDifference: project.totalEstimatedHours - calculatedTotalHours,
          };
        })
      );

      res.json(response);
    } catch (err) {
      console.error("List projects error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* =====================================================
   GET SINGLE PROJECT DETAILS - FIXED ROLE DISPLAY
   ===================================================== */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("assignments.user", "fullName email role department employeeId")
      .populate("manager", "fullName email");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Check access permissions
    let hasAccess = false;
    
    if (userRole === "admin") {
      hasAccess = true;
    } else if (userRole === "manager") {
      // Manager can access if they manage the project or are assigned to it
      hasAccess = project.manager && project.manager._id.toString() === userId.toString();
      if (!hasAccess) {
        // Check if manager is assigned as an employee
        const isAssigned = project.assignments.some(
          assignment => getAssignmentUserIdString(assignment) === userId.toString()
        );
        hasAccess = isAssigned;
      }
    } else if (userRole === "employee") {
      // Employee can access only if assigned
      const isAssigned = project.assignments.some(
        assignment => getAssignmentUserIdString(assignment) === userId.toString()
      );
      hasAccess = isAssigned;
      
      if (!hasAccess) {
        return res.status(403).json({ 
          message: "You are not assigned to this project. Please contact your manager to get assigned a role before creating tasks." 
        });
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Calculate working days for display
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    };

    const startStr = formatDate(project.startDate);
    const endStr = formatDate(project.endDate);
    
    let workingDays = 0;
    if (startStr && endStr) {
      workingDays = await countWorkingDaysInRange(startStr, endStr);
    }

    const calculatedTotalHours = workingDays * 8;
    
    // Get project tasks
    const tasks = await Task.find({ projectId: project._id })
      .populate("assignedUserId", "fullName email employeeId")
      .populate("createdByUserId", "fullName email employeeId")
      .sort({ createdAt: -1 })
      .limit(50);

    // Determine user's role in this project
    let myRole = null;
    let myAssignment = null;

    if (userRole === "employee") {
      myAssignment = project.assignments.find(
        assignment => getAssignmentUserIdString(assignment) === userId.toString()
      );
      myRole = myAssignment?.role || null;
    } else if (userRole === "manager") {
      if (project.manager && project.manager._id.toString() === userId.toString()) {
        myRole = "Manager";
      } else {
        myAssignment = project.assignments.find(
          assignment => getAssignmentUserIdString(assignment) === userId.toString()
        );
        myRole = myAssignment?.role || null;
      }
    } else if (userRole === "admin") {
      myRole = "Admin";
    }

    // Get project statistics
    const stats = {
      totalTasks: tasks.length,
      openTasks: tasks.filter(t => t.status === "OPEN").length,
      inProgressTasks: tasks.filter(t => t.status === "IN_PROGRESS").length,
      completedTasks: tasks.filter(t => t.status === "COMPLETED").length,
      totalEstimatedHours: tasks.reduce((sum, task) => sum + (task.estimateHours || 0), 0)
    };

    res.json({
      ...project.toObject(),
      workingDays,
      calculatedTotalHours,
      calculationDifference: project.totalEstimatedHours - calculatedTotalHours,
      recentTasks: tasks,
      myRole: myRole || "Not assigned", // Important: This fixes the frontend display
      myAssignment,
      stats,
      canCreateTask: myRole !== null && project.status === "APPROVED"
    });
  } catch (err) {
    console.error("Get project error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
   GET PROJECTS FOR TASK CREATION DROPDOWN
   ===================================================== */
router.get("/for-task-creation", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let query = { status: "APPROVED" };
    
    if (userRole === "employee") {
      query["assignments.user"] = userId;
    } else if (userRole === "manager") {
      query.manager = userId;
    }
    // Admin doesn't create tasks, so not included

    const projects = await Project.find(query)
      .select("name code status assignments manager")
      .populate("assignments.user", "fullName email")
      .populate("manager", "fullName email")
      .sort({ name: 1 });

    // Format projects for dropdown
    const formattedProjects = projects.map(project => {
      let myRole = null;
      
      if (userRole === "employee") {
        const assignment = project.assignments.find(
          a => getAssignmentUserIdString(a) === userId.toString()
        );
        myRole = assignment?.role || null;
      } else if (userRole === "manager") {
        myRole = "Manager";
      }

      return {
        _id: project._id,
        name: project.name,
        code: project.code,
        status: project.status,
        myRole: myRole || "Not assigned",
        hasRole: myRole !== null,
        displayText: `${project.name} (${project.code}) - ${myRole || "No role"}`
      };
    });

    // Filter out projects where employee has no role
    const filteredProjects = userRole === "employee" 
      ? formattedProjects.filter(p => p.hasRole)
      : formattedProjects;

    res.json(filteredProjects);
  } catch (err) {
    console.error("Get projects for task creation error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
   GET PROJECT BALANCE DETAILS
   ===================================================== */
router.get("/:id/balance", authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .select("name code totalEstimatedHours balanceHours consumedHours monthlyConsumption consumptionByRole");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Get all tasks for this project
    const tasks = await Task.find({ projectId: project._id })
      .select("estimateHours status month year assignedUserRole")
      .sort({ month: 1, year: 1 });

    // Calculate consumption by month
    const monthlyConsumption = {};
    tasks.forEach(task => {
      if (task.status === "COMPLETED") {
        const key = `${task.year}-${task.month}`;
        if (!monthlyConsumption[key]) {
          monthlyConsumption[key] = {
            year: task.year,
            month: task.month,
            consumedHours: 0
          };
        }
        monthlyConsumption[key].consumedHours += task.estimateHours || 0;
      }
    });

    const monthlyData = Object.values(monthlyConsumption);

    res.json({
      projectName: project.name,
      projectCode: project.code,
      totalEstimatedHours: project.totalEstimatedHours,
      balanceHours: project.balanceHours,
      consumedHours: project.consumedHours,
      monthlyConsumption: monthlyData,
      consumptionByRole: project.consumptionByRole || [],
      tasksCount: tasks.length,
      completedTasks: tasks.filter(t => t.status === "COMPLETED").length
    });
  } catch (err) {
    console.error("Get project balance error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
   ASSIGN EMPLOYEE TO PROJECT - ENHANCED
   ===================================================== */
router.post(
  "/:id/assign",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { userId, role } = req.body;

      if (!userId || !role) {
        return res.status(400).json({ 
          message: "userId and role are required" 
        });
      }

      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Cannot assign to archived projects" 
        });
      }

      const employee = await User.findById(userId);
      if (!employee) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if already assigned
      const alreadyAssigned = project.assignments.find(
        assignment => getAssignmentUserIdString(assignment) === userId.toString()
      );
      
      if (alreadyAssigned) {
        // Update existing role
        alreadyAssigned.role = role;
        const now = new Date();
        alreadyAssigned.startMonth = now.getMonth() + 1;
        alreadyAssigned.startYear = now.getFullYear();
        alreadyAssigned.endMonth = null;
        alreadyAssigned.endYear = null;
      } else {
        // Add new assignment
        const now = new Date();
        project.assignments.push({
          user: userId,
          role,
          startMonth: now.getMonth() + 1,
          startYear: now.getFullYear(),
        });
      }

      await project.save();

      const populated = await Project.findById(project._id)
        .populate("assignments.user", "fullName email role employeeId")
        .populate("manager", "fullName email");

      // 🚀 Socket emit for assignment update
      emitDashboardUpdate(req, "PROJECT_ASSIGNMENT_UPDATED", {
        projectId: project._id,
        projectName: project.name,
        userId,
        role,
        action: alreadyAssigned ? "UPDATED" : "ASSIGNED"
      });

      // Log assignment
      try {
        await Log.create({
          type: "OPERATION",
          action: "ASSIGN_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Assigned ${employee.fullName} to project ${project.name} as ${role}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            employeeId: employee._id,
            employeeEmail: employee.email,
            assignedRole: role,
          },
        });
      } catch (logErr) {
        console.error("Log ASSIGN_PROJECT error:", logErr.message);
      }

      res.json({
        message: alreadyAssigned ? "Role updated" : "Employee assigned",
        project: populated,
        assignment: {
          userId,
          role,
          employeeName: employee.fullName,
          employeeEmail: employee.email
        }
      });
    } catch (err) {
      console.error("Assign project error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* =====================================================
   APPROVE PROJECT
   ===================================================== */
router.patch(
  "/:id/approve",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status === "APPROVED") {
        return res.status(400).json({ 
          message: "Project is already approved" 
        });
      }

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Cannot approve archived projects" 
        });
      }

      project.status = "APPROVED";
      await project.save();

      // 🚀 Socket emit for project approval
      emitDashboardUpdate(req, "PROJECT_APPROVED", {
        projectId: project._id,
        projectName: project.name,
        projectCode: project.code
      });

      // Log approval
      try {
        await Log.create({
          type: "OPERATION",
          action: "APPROVE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Approved project ${project.name}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            previousStatus: "DRAFT",
          },
        });
      } catch (logErr) {
        console.error("Log APPROVE_PROJECT error:", logErr.message);
      }

      res.json({ 
        message: "Project approved", 
        project 
      });
    } catch (err) {
      console.error("Approve project error:", err);
      res.status(500).json({ message: "Approval failed" });
    }
  }
);

/* =====================================================
   REJECT PROJECT
   ===================================================== */
router.patch(
  "/:id/reject",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status === "REJECTED") {
        return res.status(400).json({ 
          message: "Project is already rejected" 
        });
      }

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Cannot reject archived projects" 
        });
      }

      project.status = "REJECTED";
      await project.save();

      // 🚀 Socket emit for project rejection
      emitDashboardUpdate(req, "PROJECT_REJECTED", {
        projectId: project._id,
        projectName: project.name,
        projectCode: project.code
      });

      // Log rejection
      try {
        await Log.create({
          type: "OPERATION",
          action: "REJECT_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Rejected project ${project.name}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            previousStatus: project.status,
          },
        });
      } catch (logErr) {
        console.error("Log REJECT_PROJECT error:", logErr.message);
      }

      res.json({ 
        message: "Project rejected", 
        project 
      });
    } catch (err) {
      console.error("Reject project error:", err);
      res.status(500).json({ message: "Rejection failed" });
    }
  }
);

/* =====================================================
   COMPLETE PROJECT (WITH BALANCE CHECK & OVERRUN HANDLING)
   ===================================================== */
router.patch(
  "/:id/complete",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { overrunReason } = req.body;
      const project = await Project.findById(req.params.id);
      
      if (!project) return res.status(404).json({ message: "Project not found" });

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status !== "APPROVED") {
        return res.status(400).json({
          message: "Project must be approved before completion"
        });
      }

      // Handle negative balance with overrun reason
      if (project.balanceHours < 0) {
        if (!overrunReason || overrunReason.trim().length < 10) {
          return res.status(400).json({
            message: "Project has negative balance. Please provide a reason (minimum 10 characters) for the overrun.",
            balanceHours: project.balanceHours,
            requiresReason: true
          });
        }
        
        // Save overrun reason to project
        project.overrunReason = overrunReason.trim();
        project.overrunAt = new Date();
      }

      project.status = "COMPLETED";
      project.completedAt = new Date();
      await project.save();

      // 🚀 Socket emit for project completion
      emitDashboardUpdate(req, "PROJECT_COMPLETED", {
        projectId: project._id,
        projectName: project.name,
        projectCode: project.code,
        balanceHours: project.balanceHours,
        hadOverrun: project.balanceHours < 0
      });

      // Log completion
      try {
        await Log.create({
          type: "OPERATION",
          action: "COMPLETE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Completed project ${project.name}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            balanceHours: project.balanceHours,
            consumedHours: project.consumedHours,
            hadOverrun: project.balanceHours < 0,
            overrunReason: project.overrunReason || null,
          },
        });
      } catch (logErr) {
        console.error("Log COMPLETE_PROJECT error:", logErr.message);
      }

      res.json({ 
        message: project.balanceHours < 0 
          ? "Project completed (with overrun recorded)" 
          : "Project completed",
        project 
      });
    } catch (err) {
      console.error("Complete project error:", err);
      res.status(500).json({ message: "Completion failed" });
    }
  }
);

/* =====================================================
   UPDATE PROJECT
   ===================================================== */
router.patch(
  "/:id",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Cannot update archived projects" 
        });
      }

      const updates = { ...req.body };

      // If dates are being updated, recalculate totalEstimatedHours if not explicitly set
      if (updates.startDate || updates.endDate) {
        const newStartDate = updates.startDate ? new Date(updates.startDate) : project.startDate;
        const newEndDate = updates.endDate ? new Date(updates.endDate) : project.endDate;

        const formatDate = (date) => {
          const d = new Date(date);
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          return `${dd}-${mm}-${yyyy}`;
        };

        const startStr = formatDate(newStartDate);
        const endStr = formatDate(newEndDate);
        
        const workingDays = await countWorkingDaysInRange(startStr, endStr);
        const calculatedTotalHours = workingDays * 8;
        const calculatedDurationMonths = calculateDurationMonths(startStr, endStr);

        // Update calculated fields if not explicitly set
        if (!updates.totalEstimatedHours) {
          updates.totalEstimatedHours = calculatedTotalHours;
        }

        if (!updates.durationMonths) {
          updates.durationMonths = calculatedDurationMonths;
        }

        updates.startDate = newStartDate;
        updates.endDate = newEndDate;
      }

      // Update the project
      const updatedProject = await Project.findByIdAndUpdate(
        req.params.id,
        updates,
        { new: true, runValidators: true }
      ).populate("assignments.user").populate("manager");

      // 🚀 Socket emit for project update
      emitDashboardUpdate(req, "PROJECT_UPDATED", {
        projectId: updatedProject._id,
        projectName: updatedProject.name,
        projectCode: updatedProject.code,
        updatedFields: Object.keys(updates)
      });

      // Log update
      try {
        await Log.create({
          type: "OPERATION",
          action: "UPDATE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Updated project ${updatedProject.name}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: updatedProject._id,
            updates: Object.keys(updates),
          },
        });
      } catch (logErr) {
        console.error("Log UPDATE_PROJECT error:", logErr.message);
      }

      res.json(updatedProject);
    } catch (err) {
      console.error("Update project error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* =====================================================
   UNASSIGN EMPLOYEE FROM PROJECT
   ===================================================== */
router.delete(
  "/:id/assign/:userId",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id)
        .populate("assignments.user", "fullName email")
        .populate("manager");
      
      if (!project) return res.status(404).json({ message: "Project not found" });

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      const removed = project.assignments.find(
        (a) => getAssignmentUserIdString(a) === req.params.userId
      );

      // Update endMonth/endYear if assignment exists
      if (removed) {
        const now = new Date();
        removed.endMonth = now.getMonth() + 1;
        removed.endYear = now.getFullYear();
      }

      project.assignments = project.assignments.filter(
        (a) => getAssignmentUserIdString(a) !== req.params.userId
      );

      await project.save();

      const populated = await Project.findById(project._id)
        .populate("assignments.user")
        .populate("manager");

      // 🚀 Socket emit for assignment removal
      emitDashboardUpdate(req, "PROJECT_ASSIGNMENT_UPDATED", {
        projectId: project._id,
        projectName: project.name,
        userId: req.params.userId,
        action: "UNASSIGNED"
      });

      // Log unassignment
      if (removed) {
        const removedUser = removed.user;
        const removedName = removedUser?.fullName || removedUser?.email || "employee";
        
        try {
          await Log.create({
            type: "OPERATION",
            action: "UNASSIGN_PROJECT",
            entity: "PROJECT",
            user: req.user.id,
            userName: req.user.fullName,
            userEmail: req.user.email,
            role: req.user.role,
            description: `Unassigned ${removedName} from project ${project.name}`,
            status: "SUCCESS",
            ipAddress: getClientIp(req),
            details: {
              projectId: project._id,
              employeeId: removedUser?._id || req.params.userId,
              employeeEmail: removedUser?.email,
              endMonth: now.getMonth() + 1,
              endYear: now.getFullYear(),
            },
          });
        } catch (logErr) {
          console.error("Log UNASSIGN_PROJECT error:", logErr.message);
        }
      }

      res.json(populated);
    } catch (err) {
      console.error("Unassign project error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* =====================================================
   ARCHIVE PROJECT
   ===================================================== */
router.post(
  "/:id/archive",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Project is already archived" 
        });
      }

      project.status = "ARCHIVED";
      project.archivedAt = new Date();
      await project.save();

      // 🚀 Socket emit for project archive
      emitDashboardUpdate(req, "PROJECT_STATUS_CHANGED", {
        projectId: project._id,
        projectName: project.name,
        projectCode: project.code,
        newStatus: "ARCHIVED",
        action: "ARCHIVE"
      });

      // Log archiving
      try {
        await Log.create({
          type: "OPERATION",
          action: "ARCHIVE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Archived project ${project.name}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
          },
        });
      } catch (logErr) {
        console.error("Log ARCHIVE_PROJECT error:", logErr.message);
      }

      res.json(project);
    } catch (err) {
      console.error("Archive project error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* =====================================================
   UNARCHIVE PROJECT
   ===================================================== */
router.post(
  "/:id/unarchive",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is the project manager
      if (project.manager.toString() !== req.user.id.toString()) {
        return res.status(403).json({ 
          message: "You are not the manager of this project" 
        });
      }

      if (project.status !== "ARCHIVED") {
        return res.status(400).json({ 
          message: "Project is not archived" 
        });
      }

      project.status = "DRAFT";
      project.archivedAt = null;
      await project.save();

      // 🚀 Socket emit for project unarchive
      emitDashboardUpdate(req, "PROJECT_STATUS_CHANGED", {
        projectId: project._id,
        projectName: project.name,
        projectCode: project.code,
        newStatus: "DRAFT",
        action: "UNARCHIVE"
      });

      // Log unarchiving
      try {
        await Log.create({
          type: "OPERATION",
          action: "UNARCHIVE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Unarchived project ${project.name}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
          },
        });
      } catch (logErr) {
        console.error("Log UNARCHIVE_PROJECT error:", logErr.message);
      }

      res.json(project);
    } catch (err) {
      console.error("Unarchive project error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
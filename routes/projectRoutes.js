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
        balanceHours: finalTotalHours, // Will be auto-calculated by schema pre-save
        assignments: [],
        consumptionByRole: [],
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
// ⬇️⬇️⬇️ ADD REJECT ENDPOINT RIGHT HERE ⬇️⬇️⬇️

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

// ⬆️⬆️⬆️ ADD REJECT ENDPOINT RIGHT HERE ⬆️⬆️⬆️

/* =====================================================
   COMPLETE PROJECT (WITH BALANCE CHECK)
   ===================================================== */
router.patch(
  "/:id/complete",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      if (project.status !== "APPROVED") {
        return res.status(400).json({
          message: "Project must be approved before completion"
        });
      }

      if (project.balanceHours < 0) {
        return res.status(400).json({
          message: "Project has negative balance",
          balanceHours: project.balanceHours,
          consumptionByRole: project.consumptionByRole,
        });
      }

      project.status = "COMPLETED";
      project.completedAt = new Date();
      await project.save();

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
          },
        });
      } catch (logErr) {
        console.error("Log COMPLETE_PROJECT error:", logErr.message);
      }

      res.json({ 
        message: "Project completed", 
        project 
      });
    } catch (err) {
      console.error("Complete project error:", err);
      res.status(500).json({ message: "Completion failed" });
    }
  }
);

/* =====================================================
   GET ALL PROJECTS (MANAGER/ADMIN VIEW)
   ===================================================== */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      const projects = await Project.find()
        .populate("assignments.user", "fullName email role")
        .sort({ createdAt: -1 });

      // Format response with working days calculation (for info only - doesn't affect balance)
      const response = await Promise.all(
        projects.map(async (project) => {
          // Format dates for working days calculation (display purposes only)
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
   GET MY PROJECTS (EMPLOYEE VIEW)
   ===================================================== */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({
      "assignments.user": req.user.id,
      status: { $ne: "ARCHIVED" } // Don't show archived projects by default
    })
    .populate("assignments.user", "fullName email role")
    .sort({ createdAt: -1 });

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
   GET SINGLE PROJECT DETAILS
   ===================================================== */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("assignments.user", "fullName email role department");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Check if user has access
    const isAssigned = project.assignments.some(
      assignment => getAssignmentUserIdString(assignment) === req.user.id.toString()
    );
    
    if (req.user.role === "employee" && !isAssigned) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Calculate working days (for display purposes only)
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
    
    // Get recent tasks (without recalculating hours)
    const tasks = await Task.find({ projectId: project._id })
      .populate("assignedUserId", "fullName email")
      .populate("createdByUserId", "fullName email")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      ...project.toObject(),
      workingDays,
      calculatedTotalHours,
      calculationDifference: project.totalEstimatedHours - calculatedTotalHours,
      recentTasks: tasks,
    });
  } catch (err) {
    console.error("Get project error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

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
          // NOTE: balanceHours will be auto-calculated by schema pre-save
        }

        if (!updates.durationMonths) {
          updates.durationMonths = calculatedDurationMonths;
        }

        updates.startDate = newStartDate;
        updates.endDate = newEndDate;
      }

      // If totalEstimatedHours is being updated, DO NOT manually update balanceHours
      // The schema pre-save hook will handle it automatically
      if (updates.totalEstimatedHours !== undefined) {
        // Just update totalEstimatedHours, schema will handle the rest
        // No manual balanceHours calculation needed
      }

      // Update the project (schema pre-save will handle balanceHours)
      const updatedProject = await Project.findByIdAndUpdate(
        req.params.id,
        updates,
        { new: true, runValidators: true }
      ).populate("assignments.user");

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
   ASSIGN EMPLOYEE TO PROJECT
   ===================================================== */
router.post(
  "/:id/assign",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { userId, role } = req.body;

      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Cannot assign to archived projects" 
        });
      }

      const employee = await User.findById(userId);
      if (!employee || employee.role !== "employee") {
        return res.status(400).json({ message: "Invalid employee" });
      }

      const already = project.assignments.find(
        (a) => getAssignmentUserIdString(a) === userId
      );
      
      if (!already) {
        project.assignments.push({ user: userId, role });
        await project.save();
      }

      const populated = await Project.findById(project._id).populate(
        "assignments.user"
      );

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
          description: `Assigned ${employee.fullName} to project ${project.name}`,
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

      res.json(populated);
    } catch (err) {
      console.error("Assign project error:", err);
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
      const project = await Project.findById(req.params.id).populate(
        "assignments.user",
        "fullName email"
      );
      
      if (!project) return res.status(404).json({ message: "Project not found" });

      const removed = project.assignments.find(
        (a) => getAssignmentUserIdString(a) === req.params.userId
      );

      project.assignments = project.assignments.filter(
        (a) => getAssignmentUserIdString(a) !== req.params.userId
      );

      await project.save();

      const populated = await Project.findById(project._id).populate(
        "assignments.user"
      );

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

      if (project.status === "ARCHIVED") {
        return res.status(400).json({ 
          message: "Project is already archived" 
        });
      }

      project.status = "ARCHIVED";
      project.archivedAt = new Date();
      await project.save();

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

      if (project.status !== "ARCHIVED") {
        return res.status(400).json({ 
          message: "Project is not archived" 
        });
      }

      project.status = "DRAFT";
      project.archivedAt = null;
      await project.save();

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
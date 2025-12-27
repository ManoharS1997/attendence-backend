// routes/projectRoutes.js
import express from "express";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";
import { countWorkingDaysInRange, calculateDurationMonths } from "../utils/holidays.js";

const router = express.Router();

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
};

const getAssignmentUserIdString = (assignment) => {
  if (!assignment.user) return "";
  // handles both ObjectId and populated user document
  if (assignment.user._id) return assignment.user._id.toString();
  return assignment.user.toString();
};

/**
 * POST /api/projects
 * Manager creates a new project with start/end dates
 * Auto-calculates working days excluding:
 * - Sundays
 * - 2nd Saturdays
 * - Mandatory Public Holidays
 * - Optional Holidays marked as TAKEN
 */
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
        startDate,    // "DD-MM-YYYY"
        endDate,      // "DD-MM-YYYY"
        totalEstimatedHours, // Can be overridden by manager
        durationMonths,      // Can be overridden by manager
      } = req.body;

      // Validate required fields
      if (!name || !startDate || !endDate) {
        return res.status(400).json({ 
          message: "Name, startDate and endDate are required" 
        });
      }

      // Parse dates for validation
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const [dd, mm, yyyy] = dateStr.split("-").map((p) => parseInt(p, 10));
        if (!dd || !mm || !yyyy) return null;
        return new Date(yyyy, mm - 1, dd);
      };

      const start = parseDate(startDate);
      const end = parseDate(endDate);
      
      if (!start || !end) {
        return res.status(400).json({ 
          message: "Invalid date format. Use DD-MM-YYYY" 
        });
      }

      if (end < start) {
        return res.status(400).json({ 
          message: "End date cannot be before start date" 
        });
      }

      // Calculate working days between start and end dates
      // This excludes: Sundays, 2nd Saturdays, Mandatory Public Holidays, 
      // and Optional Holidays marked as TAKEN
      const workingDays = await countWorkingDaysInRange(startDate, endDate);
      
      // Calculate total hours (working days × 8 hours per day)
      const calculatedTotalHours = workingDays * 8;
      
      // Calculate duration in months
      const calculatedDurationMonths = calculateDurationMonths(startDate, endDate);

      // Use manager's values if provided, otherwise use calculated values
      const finalTotalHours = totalEstimatedHours || calculatedTotalHours;
      const finalDurationMonths = durationMonths || calculatedDurationMonths;

      const project = await Project.create({
        name,
        code,
        description,
        startDate,
        endDate,
        totalEstimatedHours: finalTotalHours,
        durationMonths: finalDurationMonths,
      });

      // ---- LOG OPERATION ----
      try {
        await Log.create({
          type: "OPERATION",
          action: "CREATE_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Created project ${project.name} (${project.code || "NO_CODE"}) from ${startDate} to ${endDate}`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            code: project.code,
            startDate,
            endDate,
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
        workingDays, // Include calculated working days in response
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
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * GET /api/projects
 * Manager/Admin: list all projects with assignments
 */
router.get(
  "/",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      const projects = await Project.find()
        .populate("assignments.user")
        .sort({ createdAt: -1 });

      // Calculate working days for each project
      const projectsWithDetails = await Promise.all(projects.map(async (project) => {
        const workingDays = await countWorkingDaysInRange(project.startDate, project.endDate);
        const calculatedTotalHours = workingDays * 8;
        return {
          ...project.toObject(),
          workingDays,
          calculatedTotalHours,
          calculationDifference: project.totalEstimatedHours - calculatedTotalHours
        };
      }));

      res.json(projectsWithDetails);
    } catch (err) {
      console.error("List projects error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/**
 * GET /api/projects/my
 * Employee: projects assigned to me
 */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({
      "assignments.user": req.user.id,
    }).sort({ createdAt: -1 });

    // Calculate working days for each project
    const projectsWithDetails = await Promise.all(projects.map(async (project) => {
      const workingDays = await countWorkingDaysInRange(project.startDate, project.endDate);
      const calculatedTotalHours = workingDays * 8;
      return {
        ...project.toObject(),
        workingDays,
        calculatedTotalHours
      };
    }));

    res.json(projectsWithDetails);
  } catch (err) {
    console.error("My projects error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/projects/:id
 * Manager: update project details including dates
 */
router.patch(
  "/:id",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const project = await Project.findById(id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // If dates are being updated, recalculate working days
      if (updates.startDate || updates.endDate) {
        const newStartDate = updates.startDate || project.startDate;
        const newEndDate = updates.endDate || project.endDate;
        
        const workingDays = await countWorkingDaysInRange(newStartDate, newEndDate);
        const calculatedTotalHours = workingDays * 8;
        const calculatedDurationMonths = calculateDurationMonths(newStartDate, newEndDate);

        // Update calculated fields if not explicitly set by manager
        if (!updates.totalEstimatedHours) {
          updates.totalEstimatedHours = calculatedTotalHours;
        }
        if (!updates.durationMonths) {
          updates.durationMonths = calculatedDurationMonths;
        }
      }

      const updatedProject = await Project.findByIdAndUpdate(
        id,
        updates,
        { new: true }
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
            updates: Object.keys(updates)
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

/**
 * POST /api/projects/:id/assign
 * Manager: assign employee to project with role
 */
router.post(
  "/:id/assign",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { userId, role } = req.body;

      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ message: "Not found" });

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

      // ---- LOG OPERATION ----
      try {
        await Log.create({
          type: "OPERATION",
          action: "ASSIGN_PROJECT",
          entity: "PROJECT",
          user: req.user.id,
          userName: req.user.fullName,
          userEmail: req.user.email,
          role: req.user.role,
          description: `Assigned ${employee.fullName} (${employee.email}) to project ${project.name}`,
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

/**
 * DELETE /api/projects/:id/assign/:userId
 * Manager: unassign employee from project
 */
router.delete(
  "/:id/assign/:userId",
  authMiddleware,
  requireRole(["manager"]),
  async (req, res) => {
    try {
      const { id, userId } = req.params;

      const project = await Project.findById(id).populate(
        "assignments.user",
        "fullName email"
      );
      if (!project) return res.status(404).json({ message: "Not found" });

      const removed = project.assignments.find(
        (a) => getAssignmentUserIdString(a) === userId
      );

      project.assignments = project.assignments.filter(
        (a) => getAssignmentUserIdString(a) !== userId
      );
      await project.save();

      const populated = await Project.findById(project._id).populate(
        "assignments.user"
      );

      // ---- LOG OPERATION ----
      if (removed) {
        const removedUser = removed.user;
        const removedName =
          removedUser?.fullName || removedUser?.email || "employee";
        const removedEmail = removedUser?.email || "";

        try {
          await Log.create({
            type: "OPERATION",
            action: "UNASSIGN_PROJECT",
            entity: "PROJECT",
            user: req.user.id,
            userName: req.user.fullName,
            userEmail: req.user.email,
            role: req.user.role,
            description: `Unassigned ${removedName} (${removedEmail}) from project ${project.name}`,
            status: "SUCCESS",
            ipAddress: getClientIp(req),
            details: {
              projectId: project._id,
              employeeId: removedUser?._id || userId,
              employeeEmail: removedEmail,
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

export default router;
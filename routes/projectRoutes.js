// routes/projectRoutes.js
import express from "express";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";

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
 * Manager creates a new project
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
        totalEstimatedHours,
        durationMonths,
      } = req.body;

      const project = await Project.create({
        name,
        code,
        description,
        totalEstimatedHours: totalEstimatedHours || 355,
        durationMonths: durationMonths || 1,
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
          description: `Created project ${project.name} (${
            project.code || "NO_CODE"
          })`,
          status: "SUCCESS",
          ipAddress: getClientIp(req),
          details: {
            projectId: project._id,
            code: project.code,
          },
        });
      } catch (logErr) {
        console.error("Log CREATE_PROJECT error:", logErr.message);
      }

      res.status(201).json(project);
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

      res.json(projects);
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

    res.json(projects);
  } catch (err) {
    console.error("My projects error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/projects/:id/assign
 * Manager: assign employee to project with role (Developer / Designer / etc.)
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

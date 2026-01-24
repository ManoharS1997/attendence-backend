// models/Project.js
import mongoose from "mongoose";

/**
 * Assignment Schema
 * - Multiple employees can be assigned to one project
 * - Each employee has a role (Developer, DevOps, QA, etc.)
 */
const assignmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      required: true, // Developer, DevOps, QA, Tester, PM, Tech Lead
    },
  },
  { _id: false }
);

/**
 * Project Schema
 */
const projectSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
    },
    description: {
      type: String,
    },

    /**
     * Project Duration
     * - Used to ensure hours reduce ONLY within this period
     */
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },

    /**
     * Estimated Hours
     * - Balance will be calculated from Task collection
     * - Can go negative
     */
    totalEstimatedHours: {
      type: Number,
      default: 0,
    },

    /**
     * Optional: for display only (not for calculation)
     */
    durationMonths: {
      type: Number,
      default: 0,
    },

    /**
     * Project Phase
     * - Controls which role can reduce hours
     */
    currentPhase: {
      type: String,
      enum: ["DEVELOPMENT", "DEPLOYMENT", "TESTING", "REVIEW"],
      default: "DEVELOPMENT",
    },

    /**
     * Assigned Employees with Roles
     */
    assignments: [assignmentSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Project", projectSchema);

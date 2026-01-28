// models/Task.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Task Schema
 * - Supports BOTH legacy & new task systems
 * - ONLY approved & completed tasks reduce project balance
 * - Reduction happens ONLY ONCE per task
 * - Tasks are immutable (no delete)
 */
const taskSchema = new Schema(
  {
    /* =====================================================
       PROJECT & USER REFERENCES
       ===================================================== */
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    assignedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /* =====================================================
       LEGACY TASK SYSTEM (OPTIONAL)
       ===================================================== */
  role: {
  type: String,
  enum: [
    "DEVELOPER",
    "DEVOPS",
    "QA",
    "TESTER",
    "PRODUCT_MANAGER",
    "TECH_LEAD",
    "SUPPORT",
    "OTHER",
  ],
  required: false   // ✅ MUST BE FALSE
},



    phase: {
      type: String,
      enum: ["DEVELOPMENT", "DEPLOYMENT", "TESTING", "REVIEW", "COMPLETED"],
    },

    title: {
      type: String,
    },

    description: {
      type: String,
      default: "",
    },

    hoursWorked: {
      type: Number,
      min: 0,
    },

    workDate: {
      type: Date,
    },

    /* =====================================================
       NEW TASK SYSTEM
       ===================================================== */
    recentRequirement: {
      type: String,
      trim: true,
    },

    requirementType: {
      type: String,
      enum: ["NEW", "OLD", "BUG"],
      default: "NEW",
    },
requirementRole: {
  type: String,
  enum: [
    "DEVELOPER",
    "DEVOPS",
    "QA",
    "TESTER",
    "PRODUCT_MANAGER",
    "PROJECT_MANAGER",
    "TECH_LEAD",
    "ANALYST",
    "ARCHITECT",
    "SUPPORT",
    "ADMINISTRATOR",
    "OTHER"
  ],
  required: true
},


    estimateHours: {
      type: Number,
      min: 0.5,
    },

    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED"],
      default: "OPEN",
    },

    /* =====================================================
       MANAGER APPROVAL
       ===================================================== */
    approvedByManager: {
      type: Boolean,
      default: false,
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    /* =====================================================
       PROJECT BALANCE SAFETY (VERY IMPORTANT)
       ===================================================== */
    countedInProject: {
      type: Boolean,
      default: false,
    },

    countedHours: {
      type: Number,
      default: 0,
    },

    countedAt: {
      type: Date,
      default: null,
    },

    /* =====================================================
       OPTIONAL NOTES
       ===================================================== */
    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);

// models/Task.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Task Schema
 * - ONLY approved task hours reduce project balance
 * - Attendance is NOT used here
 */
const taskSchema = new Schema(
  {
    /* ===========================
       PROJECT & USER REFERENCES
       =========================== */
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

    /* ===========================
       ROLE & PHASE CONTROL
       =========================== */
    role: {
      type: String,
      required: true,
      enum: [
        "DEVELOPER",
        "DEVOPS",
        "QA",
        "TESTER",
        "PRODUCT_MANAGER",
        "TECH_LEAD",
      ],
    },

    phase: {
      type: String,
      required: true,
      enum: ["DEVELOPMENT", "DEPLOYMENT", "TESTING", "REVIEW"],
    },

    /* ===========================
       TASK DETAILS
       =========================== */
    title: {
      type: String,
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    requirementType: {
      type: String,
      enum: ["NEW", "OLD", "BUG"],
      default: "NEW",
    },

    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "COMPLETED"],
      default: "OPEN",
    },

    /* ===========================
       HOURS & DATE (CORE LOGIC)
       =========================== */
    hoursWorked: {
      type: Number,
      required: true,
      min: 0,
    },

    workDate: {
      type: Date,
      required: true,
    },

    /* ===========================
       MANAGER APPROVAL
       =========================== */
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

    /* ===========================
       OPTIONAL NOTES
       =========================== */
    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);

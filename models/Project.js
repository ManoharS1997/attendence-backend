// models/Project.js
import mongoose from "mongoose";

/**
 * Assignment Schema
 * - Multiple employees can be assigned to one project
 * - Each employee has a role (Developer, DevOps, QA, Tester, PM, Tech Lead, etc.)
 * - Assignment itself does NOT reduce hours
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
      required: true, // Developer, DevOps, QA, Tester, PM, Tech Lead, Support, Other
      uppercase: true,
    },
  },
  { _id: false }
);

/**
 * Role-wise consumption tracking
 * - Used to explain negative balance (overrun responsibility)
 */
const roleConsumptionSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
    },
    consumedHours: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

/**
 * Project Schema
 */
const projectSchema = new mongoose.Schema(
  {
    /* =====================================================
       BASIC INFO
       ===================================================== */
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

    /* =====================================================
       PROJECT DURATION
       ===================================================== */
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },

    /* =====================================================
       ESTIMATION & BALANCE (SINGLE SOURCE OF TRUTH)
       ===================================================== */
    totalEstimatedHours: {
      type: Number,
      required: true,
      min: 0,
    },

    // Total hours consumed so far (developer + completed tasks)
    consumedHours: {
      type: Number,
      default: 0,
    },

    // Balance hours (can go negative)
    balanceHours: {
      type: Number,
      default: function () {
        return this.totalEstimatedHours;
      },
    },

    /* =====================================================
       ROLE-WISE CONSUMPTION (AUDIT & DELAY REASON)
       ===================================================== */
    consumptionByRole: {
      type: [roleConsumptionSchema],
      default: [],
    },

    /* =====================================================
       PROJECT STATUS & CONTROL
       ===================================================== */
    status: {
      type: String,
      enum: ["DRAFT", "APPROVED", "REJECTED", "COMPLETED", "ARCHIVED"]
,
      default: "DRAFT",
    },

    /* =====================================================
       PROJECT PHASE (OPTIONAL CONTROL)
       ===================================================== */
    currentPhase: {
  type: String,
  enum: [
    "PLANNING",      // ✅ ADD THIS
    "DEVELOPMENT",
    "TESTING",
    "DEPLOYMENT",
    "REVIEW",
    "COMPLETED"
  ],
  default: "PLANNING"
},


    /* =====================================================
       ASSIGNED EMPLOYEES WITH ROLES
       ===================================================== */
    assignments: [assignmentSchema],
  },
  { timestamps: true }
);

/* =====================================================
   SAFETY: AUTO SYNC BALANCE HOURS
   ===================================================== */
projectSchema.pre("save", function (next) {
  this.balanceHours = this.totalEstimatedHours - this.consumedHours;
  next();
});

export default mongoose.model("Project", projectSchema);

// models/Task.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    /* ===============================
       CORE REFERENCES
       =============================== */
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },

    assignedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    createdByRole: {
      type: String,
      enum: ["admin", "manager", "employee"],
      required: true,
    },

    /* ===============================
       TASK CONTENT (UI FRIENDLY)
       =============================== */
    title: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },

    recentRequirement: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    requirementType: {
      type: String,
      enum: ["NEW", "OLD", "BUG"],
      default: "NEW",
    },

    notes: {
      type: String,
      default: "",
      maxlength: 5000,
    },

    description: {
      type: String,
      default: "",
      maxlength: 2000,
    },

    /* ===============================
       STATUS & SCOPE
       =============================== */
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED"],
      default: "OPEN",
      index: true,
    },

    scope: {
      type: String,
      enum: ["AGREED", "NOT_AGREED"],
      default: "AGREED",
    },

    /* ===============================
       DATES
       =============================== */
    discussedDate: {
      type: String,
      default: "",
    },

    estimatedDate: {
      type: String,
      default: "",
    },

    originalClosureDate: {
      type: String,
      default: "",
    },

    noOfDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    /* ===============================
       HOURS & PRIORITY
       =============================== */
    estimateHours: {
      type: Number,
      min: 0.5,
      default: 0,
    },

    clientPriority: {
      type: String,
      enum: ["P1", "P2", "P3", "P4"],
      default: "P3",
    },

    prioritySource: {
      type: String,
      enum: ["CLIENT", "MANAGER", "SERVICE_PROVIDER", "THIRD_PARTY"],
      default: "CLIENT",
    },

    /* ===============================
       MONTH/YEAR (SYSTEM MANAGED)
       =============================== */
    month: {
      type: Number,
      min: 1,
      max: 12,
      index: true,
    },

    year: {
      type: Number,
      index: true,
    },

    /* ===============================
       PROJECT BALANCE SAFETY
       =============================== */
    countedInProject: {
      type: Boolean,
      default: false,
      index: true,
    },

    countedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/* ===============================
   AUTO SET MONTH / YEAR
   =============================== */
taskSchema.pre("save", function (next) {
  const now = new Date();
  if (!this.month) this.month = now.getMonth() + 1;
  if (!this.year) this.year = now.getFullYear();
  next();
});

/* ===============================
   INDEXES
   =============================== */
taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assignedUserId: 1, status: 1 });
taskSchema.index({ year: 1, month: 1, projectId: 1 });

export default mongoose.model("Task", taskSchema);

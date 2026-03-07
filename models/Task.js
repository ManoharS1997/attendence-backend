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

    // 1️⃣ ADDED: Project Name (for employee view)
    projectName: {
      type: String,
      required: true
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
      enum: ["employee"],
      required: true,
    },

    /* ===============================
       TASK CONTENT (UI FRIENDLY)
       =============================== */
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // 2️⃣ RENAMED: recentRequirement → requirement
    requirement: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    // 2️⃣ RENAMED: requirementType → type
    type: {
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
    attachment: {
  type: String,
  default: null
},

    /* ===============================
       STATUS & SCOPE
       =============================== */
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED"],
      required: true,
      default: "OPEN",
      index: true,
    },

    scope: {
      type: String,
      enum: ["AGREED", "NOT_AGREED"],
      required: true,
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

    // 4️⃣ ADDED: Start Date
    startDate: {
      type: String,
      required: true
    },

    // 5️⃣ ADDED: Close Date
    closeDate: {
      type: String,
      default: "",
    },

    // 7️⃣ REPLACED: noOfDays → workingDays
    workingDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    /* ===============================
       HOURS & PRIORITY
       =============================== */
    // 2️⃣ RENAMED: estimateHours → estHours
    estHours: {
      type: Number,
      required: true,
      min: 0.5,
    },

    clientPriority: {
      type: String,
      enum: ["P1", "P2", "P3", "P4"],
      required: true,
      default: "P3",
    },

    prioritySource: {
      type: String,
      enum: ["CLIENT", "MANAGER", "SERVICE_PROVIDER", "THIRD_PARTY"],
      default: "CLIENT",
    },

    givenBy: {
      type: String,
      required: true,
    },

    /* ===============================
       PEOPLE NAMES (FOR DISPLAY)
       =============================== */
    // 3️⃣ ADDED: Employee Name
    employeeName: {
      type: String,
      required: true
    },

    // 6️⃣ ADDED: Created By Name
    createdByName: {
      type: String,
      required: true
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
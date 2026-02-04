import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Allowed attendance statuses
 */
export const ATTENDANCE_STATUS = [
  "PRESENT FULL DAY",
  "PRESENT HALF DAY",   // ✅ REQUIRED
  "CASUAL LEAVE",
  "EMERGENCY LEAVE",
  "SICK LEAVE",
  "PUBLIC HOLIDAY",
  "SUNDAY",
  "2ND SATURDAY",
  "COMPOFF",
  "ABSENT"
];


/**
 * Extra work details (for Comp-Off reference only)
 */
const extraWorkSchema = new Schema(
  {
    workedDate: { type: String },     // dd-mm-yyyy
    workedMinutes: { type: Number },  // actual extra minutes worked
    approved: { type: Boolean, default: false }
  },
  { _id: false }
);

/**
 * Manager decision schema
 */
const managerDecisionSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    decidedAt: { type: Date },
    comment: { type: String, default: "" }
  },
  { _id: false }
);

/**
 * Attendance schema (MINUTE ACCURATE)
 */
const attendanceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // dd-mm-yyyy
    date: {
      type: String,
      required: true
    },

    status: {
      type: String,
      enum: ATTENDANCE_STATUS,
      required: true
    },

    /**
     * Work timings
     */
    workInTime: { type: String, default: "" },   // HH:mm
    workOutTime: { type: String, default: "" },  // HH:mm

    /**
     * Minute-accurate system fields
     */
    totalWorkedMinutes: {
      type: Number,
      default: 0
    },

    lunchBreakMinutes: {
      type: Number,
      default: 0   // 0 / 30 / 60
    },

    lateMinutes: {
      type: Number,
      default: 0
    },

    earlyLeaveMinutes: {
      type: Number,
      default: 0
    },

    /**
     * FINAL PAYABLE WORK MINUTES
     * RULES:
     * - Max = 480 minutes (8 hours)
     * - Never rounded
     */
    payableMinutes: {
      type: Number,
      default: 0,
      max: 480
    },

    /**
     * Derived hours (for UI display only)
     * Example: 125 mins → 2.08 hrs
     */
    hoursWorked: {
      type: Number,
      default: 0
    },

    /**
     * Extra hours (decimal, for UI)
     * Example: 1.5 = 1 hour 30 mins
     */
    extraHoursWorked: {
      type: Number,
      default: 0
    },
    /**
 * Working day count (0 or 1)
 */
workingDay: {
  type: Number,
  default: 0
},


    /**
     * Whether extra hours are approved by manager
     */
    extraHoursApproved: {
      type: Boolean,
      default: false
    },

    /**
     * Extra minutes (beyond 8 hours)
     * Used ONLY for comp-off eligibility
     */
    extraMinutesWorked: {
      type: Number,
      default: 0
    },

    /**
     * Half-day classification
     */
    halfDayType: {
      type: String,
      enum: ["FUN", "DEVELOPMENT", "PERSONAL"],
      default: null
    },

    /**
     * Is this attendance a leave request
     */
    isLeaveRequest: {
      type: Boolean,
      default: false
    },

    /**
     * Comp-off days earned from extra hours
     */
    compOffDaysEarned: {
      type: Number,
      default: 0
    },

    /**
     * Lock attendance once manager approves
     */
    isLocked: {
      type: Boolean,
      default: false
    },

    /**
     * Extra work reference (Sunday / Holiday / Late stay)
     */
    extraWork: extraWorkSchema,

    /**
     * Manager approval
     */
    managerDecision: {
      type: managerDecisionSchema,
      default: () => ({ status: "PENDING" })
    },

    /**
     * Notes
     */
    note: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

/**
 * Indexes
 */
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

const Attendance = mongoose.model("Attendance", attendanceSchema);

export default Attendance;
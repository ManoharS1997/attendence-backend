import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Allowed attendance statuses
 */
export const ATTENDANCE_STATUS = [
  "PRESENT FULL DAY",
  "PRESENT HALF DAY",
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
 * Extra work details (used for comp-off reference)
 */
const extraWorkSchema = new Schema(
  {
    workedDate: { type: String },      // dd-mm-yyyy
    workedHours: { type: Number },     // actual extra hours (>= 1 for comp-off)
    approved: { type: Boolean, default: false }
  },
  { _id: false }
);

/**
 * Manager approval schema
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
    decidedAt: {
      type: Date
    },
    comment: {
      type: String,
      default: ""
    }
  },
  { _id: false }
);

/**
 * Attendance schema
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

    // Work timing
    workInTime: { type: String, default: "" },   // HH:mm
    workOutTime: { type: String, default: "" },  // HH:mm

    /**
     * SYSTEM CALCULATED VALUES
     */

    // Lunch break in minutes (30 or 60)
    lunchBreakMinutes: {
      type: Number,
      default: 0
    },

    // Late coming minutes (10:10 -> 10 mins)
    lateMinutes: {
      type: Number,
      default: 0
    },

    // Early leaving minutes
    earlyLeaveMinutes: {
      type: Number,
      default: 0
    },

    /**
     * FINAL HOURS WORKED
     * IMPORTANT RULE:
     * - MAX = 8 hours
     * - Never increases beyond 8
     */
    hoursWorked: {
      type: Number,
      default: 0,
      max: 8
    },

    /**
     * Extra hours worked (only for comp-off eligibility)
     * Does NOT affect hoursWorked
     */
    extraHoursWorked: {
      type: Number,
      default: 0
    },

    // Extra hours approved by manager
    extraHoursApproved: {
      type: Boolean,
      default: false
    },

    /**
     * Half Day Details
     * Used only when status = PRESENT HALF DAY
     */
    halfDayType: {
      type: String,
      enum: ["FUN", "DEVELOPMENT", "PERSONAL"],
      default: null
    },

    /**
     * Attendance lock
     * Once manager approves half day / leave
     * attendance becomes immutable
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
     * Notes / reason
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

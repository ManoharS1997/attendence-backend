// models/Attendance.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * All allowed attendance statuses.
 * Make sure this list matches what your frontend uses.
 */
export const ATTENDANCE_STATUS = [
  "PRESENT FULL DAY",
  "PRESENT HALF DAY",
  "EMERGENCY LEAVE",
  "CASUAL LEAVE",
  "PUBLIC HOLIDAY",
  "2ND SATURDAY",
  "SUNDAY",
  "Half Day - Fun Thursday",
  "Half Day - Development",
  "COMPOFF",
  "PRESENT",
  "ABSENT",
  "SICK LEAVE"
];


/**
 * Extra work details for COMPOFF.
 * Example:
 *  - workedDate: "07-12-2025"
 *  - workedTime: "18:00"
 *  - hours: 6
 *  - compOffDate: "10-12-2025"
 *  - compOffTime: "10:00"
 */
const extraWorkSchema = new Schema(
  {
    workedDate: { type: String }, // dd-mm-yyyy (e.g. Sunday worked date)
    workedTime: { type: String }, // e.g. "18:00"
    hours: { type: Number },      // extra hours worked
    compOffDate: { type: String }, // dd-mm-yyyy (when comp-off is taken)
    compOffTime: { type: String }  // e.g. "10:00"
  },
  { _id: false }
);

/**
 * Manager decision for attendance / leave / comp-off
 * status:
 *  - PENDING
 *  - APPROVED
 *  - REJECTED
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
      type: String
    }
  },
  { _id: false }
);

/**
 * Main Attendance schema
 * This matches what your EmployeeDashboard / ManagerDashboard are sending:
 *  - date: "dd-mm-yyyy"
 *  - status: from ATTENDANCE_STATUS
 *  - workInTime / workOutTime: "HH:mm"
 *  - note: optional
 *  - isLeaveRequest: true for leave / comp-off requests
 *  - extraWork: for COMPOFF
 */
const attendanceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // dd-mm-yyyy (e.g. "09-12-2025")
    date: {
      type: String,
      required: true
    },

    // e.g. "PRESENT FULL DAY", "Half Day - Development", "COMPOFF"
    status: {
      type: String,
      enum: ATTENDANCE_STATUS,
      required: true
    },

    // "10:00"
    workInTime: {
      type: String,
      default: ""
    },

    // "18:00"
    workOutTime: {
      type: String,
      default: ""
    },

    note: {
      type: String,
      default: ""
    },

    // true if this entry is a leave / comp-off request needing manager approval
    isLeaveRequest: {
      type: Boolean,
      default: false
    },

    // For COMPOFF status only
    extraWork: extraWorkSchema,

    // Manager’s decision (PENDING / APPROVED / REJECTED)
    managerDecision: {
      type: managerDecisionSchema,
      default: () => ({ status: "PENDING" })
    }
  },
  {
    timestamps: true
  }
);

const Attendance = mongoose.model("Attendance", attendanceSchema);

export default Attendance;

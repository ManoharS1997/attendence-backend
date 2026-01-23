// models/AttendanceRequest.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Extra work details
 * Used only for approval reference (does NOT grant comp-off by itself)
 */
const extraWorkSchema = new Schema(
  {
    workedDate: { type: String },      // dd-mm-yyyy
    workedHours: { type: Number },     // actual extra hours (>=1 eligible)
    reason: { type: String, default: "" }
  },
  { _id: false }
);

/**
 * AttendanceRequest
 * One request = one manager decision
 */
const attendanceRequestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // Linked attendance record (optional for CREATE)
    attendance: {
      type: Schema.Types.ObjectId,
      ref: "Attendance"
    },

    // dd-mm-yyyy
    date: {
      type: String,
      required: true
    },

    /**
     * CREATE  → no attendance existed
     * UPDATE  → modifying existing attendance
     */
    type: {
      type: String,
      enum: ["CREATE", "UPDATE"],
      required: true
    },

    /**
     * Existing values (for audit)
     */
    fromStatus: { type: String },
    fromWorkInTime: { type: String },
    fromWorkOutTime: { type: String },

    /**
     * Requested values
     */
    toStatus: {
      type: String,
      required: true
    },
    toWorkInTime: { type: String },
    toWorkOutTime: { type: String },

    /**
     * System-calculated values (read-only intent)
     * Used by manager decision logic
     */
    calculated: {
      hoursWorked: { type: Number, default: 0 },       // capped at 8
      extraHoursWorked: { type: Number, default: 0 },  // for comp-off check
      lateMinutes: { type: Number, default: 0 },
      earlyLeaveMinutes: { type: Number, default: 0 }
    },

    /**
     * Half day purpose (only if toStatus = PRESENT HALF DAY)
     */
    halfDayType: {
      type: String,
      enum: ["FUN", "DEVELOPMENT", "PERSONAL"],
      default: null
    },

    /**
     * Extra work reference (approval only)
     */
    extraWork: extraWorkSchema,

    /**
     * Optional employee note / reason
     */
    note: {
      type: String,
      default: ""
    },

    /**
     * Request status
     */
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },

    /**
     * Manager decision
     */
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    decisionAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

attendanceRequestSchema.index({ user: 1, date: 1 });
attendanceRequestSchema.index({ status: 1 });

const AttendanceRequest = mongoose.model(
  "AttendanceRequest",
  attendanceRequestSchema
);

export default AttendanceRequest;

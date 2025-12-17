// models/AttendanceRequest.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Extra work details for COMPOFF.
 * Keep it aligned with models/Attendance.js extraWorkSchema.
 */
const extraWorkSchema = new Schema(
  {
    workedDate: { type: String },   // dd-mm-yyyy – the day extra work was done
    workedTime: { type: String },   // e.g. "18:00"
    hours: { type: Number },        // number of extra hours
    compOffDate: { type: String },  // dd-mm-yyyy – when comp-off will be taken
    compOffTime: { type: String }   // e.g. "10:00"
  },
  { _id: false }
);

/**
 * AttendanceRequest
 * Created whenever an employee posts attendance that needs manager approval
 * (non-simple cases, leaves, comp-offs, backdated/future dates, etc.)
 */
const attendanceRequestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // optional reference to an existing Attendance document
    attendance: {
      type: Schema.Types.ObjectId,
      ref: "Attendance"
    },

    // dd-mm-yyyy
    date: {
      type: String,
      required: true
    },

    // "CREATE" – no Attendance existed for that date
    // "UPDATE" – modify an existing Attendance
    type: {
      type: String,
      enum: ["CREATE", "UPDATE"],
      required: true
    },

    // current values (for UPDATE)
    fromStatus: { type: String },
    fromWorkInTime: { type: String },
    fromWorkOutTime: { type: String },

    // requested values (for CREATE / UPDATE)
    toStatus: {
      type: String,
      required: true
    },
    toWorkInTime: { type: String },
    toWorkOutTime: { type: String },

    // COMPOFF details if applicable
    extraWork: extraWorkSchema,

    // optional note from employee
    note: { type: String },

    /**
     * Request status:
     *  - PENDING   – waiting for manager decision
     *  - APPROVED  – manager approved and Attendance has been updated/created
     *  - REJECTED  – manager rejected, Attendance not changed
     */
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING"
    },

    // Who decided & when
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

const AttendanceRequest = mongoose.model(
  "AttendanceRequest",
  attendanceRequestSchema
);

export default AttendanceRequest;

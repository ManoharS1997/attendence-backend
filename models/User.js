// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      index: true,
      required: true
    },

    fullName: {
      type: String,
      required: true
    },

    email: {
      type: String,
      required: true,
      unique: true
    },

    passwordHash: {
      type: String,
      required: true
    },

    role: {
      type: String,
      enum: ["admin", "manager", "employee"],
      required: true
    },

    designation: {
      type: String,
      default: ""
    },

    // Leave configuration fields
    totalLeaveEntitlement: {
      type: Number,
      default: 16
    },

    publicHolidays: {
      type: Number,
      default: 0
    },

    weekendHolidays: {
      type: Number,
      default: 0
    },

    carryForward2025: {
      type: Number,
      default: 0
    },

    mustChangePassword: {
      type: Boolean,
      default: true
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: {
      type: String,
      enum: ["admin", "manager", "employee"],
      required: true,
    },
    passwordHash: { type: String, required: true },
    laptopId: { type: String },

    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },

    totalLeaveEntitlement: { type: Number, default: 16 },
    publicHolidays: { type: Number, default: 0 },
    weekendHolidays: { type: Number, default: 0 },
    carryForward2025: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);

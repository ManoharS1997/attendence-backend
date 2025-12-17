// models/Holiday.js
import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // "14-01-2026"
    yearRange: { type: String },                          // "2025-26"
    occasion: { type: String, required: true },
    infoDate: { type: String },

    type: {
      type: String,
      enum: ["MANDATORY", "OPTIONAL"],
      default: "OPTIONAL",
    },

    taken: {
      type: String,
      enum: ["TAKEN", "NOT_TAKEN"],
      default: "NOT_TAKEN",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Holiday", holidaySchema);

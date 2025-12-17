// models/HolidaySetting.js
import mongoose from "mongoose";

const holidaySettingSchema = new mongoose.Schema(
  {
    dateKey: { type: String, required: true, unique: true }, // "YYYY-MM-DD"
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    status: {
      type: String,
      enum: ["TAKEN", "NOT_TAKEN"],
      default: "NOT_TAKEN",
    },
  },
  { timestamps: true }
);

export default mongoose.model("HolidaySetting", holidaySettingSchema);

// models/Birthday.js
import mongoose from "mongoose";

const birthdaySchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    fullName: String,
    email: String,

    dob: {
      type: String, // DD-MM-YYYY (original DOB)
      required: true
    },

    day: Number,   // 16
    month: Number, // 11 (November)

    createdBy: {
      type: String,
      default: "MANAGER"
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

export default mongoose.model("Birthday", birthdaySchema);

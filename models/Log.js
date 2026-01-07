// models/Log.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const logSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: false },

    userName: String,
    userEmail: String,
    role: String,

    type: {
      type: String,
      required: true,
      enum: ["LOGIN", "LOGOUT", "OPERATION", "ERROR"],
    },

    action: { type: String, required: true },

    entity: { type: String, default: "SYSTEM" },

    description: String,
    details: Schema.Types.Mixed,

    ipAddress: String,

    status: { type: String, default: "SUCCESS" },

    // ✅ NEW FIELDS FOR AUTO ARCHIVAL
    archived: {
      type: Boolean,
      default: false
    },
    archivedMonth: {
      type: String // format: MM-YYYY (e.g. 01-2026)
    }
  },
  { timestamps: true }
);

const Log = mongoose.model("Log", logSchema);
export default Log;

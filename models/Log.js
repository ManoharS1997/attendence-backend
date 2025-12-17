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
  },
  { timestamps: true }
);

const Log = mongoose.model("Log", logSchema);
export default Log;

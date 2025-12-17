// models/Project.js
import mongoose from "mongoose";

const assignmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String }, // e.g. Developer, Designer, QA, etc.
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String },
    description: { type: String },

    // Manager can edit total hours + months when creating the project
    totalEstimatedHours: { type: Number, default: 355 },
    durationMonths: { type: Number, default: 1 },

    assignments: [assignmentSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Project", projectSchema);

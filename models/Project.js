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

    // NEW FIELDS: Start and End Dates
    startDate: { 
      type: String,  // Format: "DD-MM-YYYY"
      required: true 
    },
    endDate: { 
      type: String,  // Format: "DD-MM-YYYY"
      required: true 
    },
    
    // Manager can edit these fields
    totalEstimatedHours: { type: Number, default: 0 },
    durationMonths: { type: Number, default: 0 },

    assignments: [assignmentSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Project", projectSchema);
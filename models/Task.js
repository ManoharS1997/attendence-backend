// models/Task.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    assignedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    recentRequirement: {
      type: String,
      default: "Requirement not specified",
    },

    requirementType: {
      type: String,
      enum: ["NEW", "OLD", "BUG"],
      default: "NEW",
    },

    status: {
      type: String,
      default: "OPEN",
    },

    scope: {
      type: String,
      enum: ["AGREED", "NOT_AGREED"],
      default: "AGREED",
    },

    notes: { type: String, default: "" },

    discussedDate: { type: String, default: "" },
    originalClosureDate: { type: String, default: "" }, // start date
    estimatedDate: { type: String, default: "" },       // close date

    noOfDays: { type: Number, default: 0 },

    clientPriority: {
      type: String,
      enum: ["P1", "P2", "P3", "P4"],
      default: "P3",
    },

    prioritySource: {
      type: String,
      enum: ["CLIENT", "SERVICE_PROVIDER", "THIRD_PARTY"],
      default: "CLIENT",
    },

    hoursAllocated: { type: Number, default: 0 },

    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);

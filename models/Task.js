// models/Task.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true
    },

    assignedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    createdByRole: {
      type: String,
      enum: ["admin", "manager", "employee"],
      required: true
    },

    recentRequirement: {
      type: String,
      default: "Requirement not specified"
    },

    requirementType: {
      type: String,
      enum: ["NEW", "OLD", "BUG"],
      default: "NEW"
    },

    status: {
      type: String,
      default: "OPEN"
    },

    scope: {
      type: String,
      enum: ["AGREED", "NOT_AGREED"],
      default: "AGREED"
    },

    notes: { type: String, default: "" },

    discussedDate: { type: String, default: "" },
    originalClosureDate: { type: String, default: "" },
    estimatedDate: { type: String, default: "" },

    noOfDays: { type: Number, default: 0 },

    estimateHours: {
      type: Number,
      default: 8
    },

    clientPriority: {
      type: String,
      enum: ["P1", "P2", "P3", "P4"],
      default: "P3"
    },

    prioritySource: {
      type: String,
      enum: ["CLIENT", "SERVICE_PROVIDER", "THIRD_PARTY"],
      default: "CLIENT"
    }
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);

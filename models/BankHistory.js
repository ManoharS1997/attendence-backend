// models/BankHistory.js
import mongoose from "mongoose";

const bankHistorySchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    // Previous bank details
    previousBankName: String,
    previousAccountNumber: String,
    previousIfsc: String,
    previousBranch: String,
    previousAccountType: String,
    
    // New bank details
    newBankName: String,
    newAccountNumber: String,
    newIfsc: String,
    newBranch: String,
    newAccountType: String,
    
    // Change metadata
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    changedByName: {
      type: String,
      required: true
    },
    
    changedByRole: {
      type: String,
      enum: ["admin", "manager", "employee"],
      required: true
    },
    
    reason: {
      type: String,
      default: "Bank details updated",
      required: true
    },
    
    changeType: {
      type: String,
      enum: ["CREATE", "UPDATE", "VERIFY", "DEACTIVATE"],
      default: "UPDATE"
    },
    
    ipAddress: String,
    
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

// Indexes for faster queries
bankHistorySchema.index({ employee: 1 });
bankHistorySchema.index({ changedAt: -1 });
bankHistorySchema.index({ changedBy: 1 });
bankHistorySchema.index({ changeType: 1 });

export default mongoose.model("BankHistory", bankHistorySchema);
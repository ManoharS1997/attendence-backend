// models/BankDetails.js
import mongoose from "mongoose";

const bankDetailsSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    
    bankName: {
      type: String,
      required: [true, "Bank name is required"]
    },
    
    accountNumber: {
      type: String,
      required: [true, "Account number is required"],
      minlength: [9, "Account number must be at least 9 digits"],
      maxlength: [18, "Account number cannot exceed 18 digits"]
    },
    
    ifsc: {
      type: String,
      required: [true, "IFSC code is required"],
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code format"]
    },
    
    branch: {
      type: String,
      required: [true, "Branch address is required"]
    },
    
    accountType: {
      type: String,
      enum: ["Savings", "Current", "Salary"],
      default: "Savings"
    },
    
    isActive: {
      type: Boolean,
      default: true
    },
    
    verified: {
      type: Boolean,
      default: false
    },
    
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    verifiedAt: {
      type: Date
    },
    
    notes: {
      type: String
    }
  },
  { timestamps: true }
);

// Index for quick lookup
bankDetailsSchema.index({ employee: 1 }, { unique: true });
bankDetailsSchema.index({ accountNumber: 1 });
bankDetailsSchema.index({ ifsc: 1 });

export default mongoose.model("BankDetails", bankDetailsSchema);
import mongoose from "mongoose";

const payslipBankHistorySchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    bankName: String,
    accountNumber: String,
    ifscCode: String,
    branch: String,

    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    reason: {
      type: String,
      default: "Updated for payslip"
    }
  },
  { timestamps: true }
);

export default mongoose.model(
  "PayslipBankHistory",
  payslipBankHistorySchema
);

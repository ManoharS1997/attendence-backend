import mongoose from "mongoose";

const bankHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    bankName: String,
    accountNumber: String,
    ifsc: String,
    branch: String,
    changedBy: String
  },
  { timestamps: true }
);

export default mongoose.model("BankHistory", bankHistorySchema);

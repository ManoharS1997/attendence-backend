import mongoose from "mongoose";

const payslipSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    employeeId: {
      type: String,
      required: true
    },

    designation: String,

    month: Number,
    year: Number,

    workingDays: Number,

    bankSnapshot: {
      bankName: String,
      accountNumber: String,
      ifsc: String,
      branch: String
    },

    salary: {
      basic: Number,
      hra: Number,
      conveyance: Number,
      allowances: Number,
      pf: Number,
      esi: Number,
      professionalTax: Number,
      tds: Number,
      gross: Number,
      deductions: Number,
      netPay: Number
    },

    createdBy: String
  },
  { timestamps: true }
);

payslipSchema.index(
  { employee: 1, month: 1, year: 1 },
  { unique: true }
);

export default mongoose.model("Payslip", payslipSchema);

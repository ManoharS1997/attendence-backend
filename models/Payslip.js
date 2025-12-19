import mongoose from "mongoose";

const salarySchema = new mongoose.Schema(
  {
    basic: { type: Number, required: true },
    hra: { type: Number, default: 0 },
    conveyance: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },

    // deductions
    pf: { type: Number, default: 0 },
    esi: { type: Number, default: 0 },
    professionalTax: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },

    grossEarnings: { type: Number, required: true },
    totalDeductions: { type: Number, required: true },
    netPay: { type: Number, required: true }
  },
  { _id: false }
);

const bankSnapshotSchema = new mongoose.Schema(
  {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    branch: String
  },
  { _id: false }
);

const payslipSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    employeeType: {
      type: String,
      enum: ["REGULAR", "INTERN", "CONTRACT"],
      required: true
    },

    designation: {
      type: String,
      default: ""
    },

    month: {
      type: Number,
      required: true // 1-12
    },

    year: {
      type: Number,
      required: true
    },

    templateId: {
      type: String,
      required: true // template1, template2...
    },

    bankDetails: bankSnapshotSchema,

    salary: salarySchema,

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true // manager
    }
  },
  { timestamps: true }
);

// one payslip per employee per month
payslipSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model("Payslip", payslipSchema);

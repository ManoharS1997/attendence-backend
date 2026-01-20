// models/Payslip.js
import mongoose from "mongoose";

const payslipSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    employeeId: {
      type: String,
      required: true,
      index: true
    },

    // ✅ FIXED (was breaking production)
    jobTitle: {
      type: String,
      default: "N/A"
    },

    designation: {
      type: String,
      default: "N/A"
    },

    employeeType: {
      type: String,
      enum: ["Permanent", "Contract", "Intern", "Freelancer", "Consultant", "Temporary"],
      default: "Permanent"
    },

    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },

    year: {
      type: Number,
      required: true,
      min: 2000,
      max: 2100
    },

    workingDays: {
      type: Number,
      required: true,
      min: 0,
      max: 31
    },

    bankSnapshot: {
      bankName: { type: String, default: "N/A" },
      accountNumber: { type: String, default: "N/A" },
      ifsc: { type: String, default: "N/A" },
      branch: { type: String, default: "N/A" },
      accountType: { type: String, default: "Savings" }
    },

    salary: {
      basic: { type: Number, default: 0 },
      hra: { type: Number, default: 0 },
      conveyance: { type: Number, default: 0 },
      travelAllowance: { type: Number, default: 0 },
      medicalAllowance: { type: Number, default: 0 },
      specialAllowance: { type: Number, default: 0 },
      pf: { type: Number, default: 0 },
      esi: { type: Number, default: 0 },
      professionalTax: { type: Number, default: 0 },
      tds: { type: Number, default: 0 },
      gross: { type: Number, default: 0 },
      deductions: { type: Number, default: 0 },
      netPay: { type: Number, default: 0 }
    },

    status: {
      type: String,
      enum: ["draft", "generated", "sent", "viewed", "downloaded", "archived"],
      default: "generated"
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    createdByName: {
      type: String,
      required: true
    },

    notes: {
      type: String
    },

    version: {
      type: Number,
      default: 1
    }
  },
  { timestamps: true }
);

payslipSchema.index(
  { employee: 1, month: 1, year: 1 },
  { unique: true, name: "unique_payslip_per_month" }
);

export default mongoose.model("Payslip", payslipSchema);

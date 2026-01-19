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

    // ✅ ADD THIS (MISSING EARLIER)
    jobTitle: {
      type: String,
      required: true
    },

    designation: {
      type: String,
      required: true
    },

    employeeType: {
      type: String,
      enum: ["Permanent", "Contract", "Intern", "Freelancer", "Consultant", "Temporary"],
      required: true
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

    // Bank details at the time of payslip generation
    bankSnapshot: {
      bankName: {
        type: String,
        required: true
      },
      accountNumber: {
        type: String,
        required: true
      },
      ifsc: {
        type: String,
        required: true
      },
      branch: {
        type: String,
        required: true
      },
      accountType: {
        type: String,
        default: "Savings"
      }
    },

    salary: {
      basic: { type: Number, required: true, min: 0 },
      hra: { type: Number, required: true, min: 0 },
      conveyance: { type: Number, default: 0, min: 0 },
      travelAllowance: { type: Number, default: 0, min: 0 },
      medicalAllowance: { type: Number, default: 0, min: 0 },
      specialAllowance: { type: Number, default: 0, min: 0 },
      pf: { type: Number, default: 0, min: 0 },
      esi: { type: Number, default: 0, min: 0 },
      professionalTax: { type: Number, default: 0, min: 0 },
      tds: { type: Number, default: 0, min: 0 },
      gross: { type: Number, required: true, min: 0 },
      deductions: { type: Number, required: true, min: 0 },
      netPay: { type: Number, required: true, min: 0 }
    },

    // Status tracking
    status: {
      type: String,
      enum: ["draft", "generated", "sent", "viewed", "downloaded", "archived"],
      default: "generated"
    },

    sentToEmployee: {
      type: Boolean,
      default: false
    },

    sentToEmployeeAt: {
      type: Date
    },

    sentToAdmin: {
      type: Boolean,
      default: false
    },

    sentToAdminAt: {
      type: Date
    },

    viewedByEmployee: {
      type: Boolean,
      default: false
    },

    viewedByEmployeeAt: {
      type: Date
    },

    downloadedByEmployee: {
      type: Boolean,
      default: false
    },

    downloadedByEmployeeAt: {
      type: Date
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

    // For audit trail
    version: {
      type: Number,
      default: 1
    }
  },
  { timestamps: true }
);

// Compound unique index to prevent duplicate payslips
payslipSchema.index(
  { employee: 1, month: 1, year: 1 },
  { unique: true, name: "unique_payslip_per_month" }
);

// Index for status queries
payslipSchema.index({ status: 1 });
payslipSchema.index({ employee: 1, status: 1 });
payslipSchema.index({ month: 1, year: 1 });

export default mongoose.model("Payslip", payslipSchema);
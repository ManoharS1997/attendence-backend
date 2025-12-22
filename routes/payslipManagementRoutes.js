import express from "express";
import puppeteer from "puppeteer";
import Payslip from "../models/Payslip.js";
import User from "../models/User.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =====================================================
   CREATE / UPDATE PAYSLIP
===================================================== */
router.post("/", authMiddleware, async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ message: "Request body missing" });
    }

    const {
      employeeId,
      month,
      year,
      workingDays,
      salary = {},
      bankDetails = {},
      templateId
    } = req.body;

    if (!employeeId || !month || !year) {
      return res.status(400).json({
        message: "employeeId, month and year are required"
      });
    }

    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    let payslip = await Payslip.findOne({
      employee: employee._id,
      month: Number(month),
      year: Number(year)
    });

    const salaryData = {
      basic: salary.basic || 0,
      hra: salary.hra || 0,
      conveyance: salary.conveyance || 0,
      allowances: salary.allowances || 0,
      pf: salary.pf || 0,
      esi: salary.esi || 0,
      professionalTax: salary.professionalTax || 0,
      tds: salary.tds || 0,
    };

    salaryData.gross =
      salary.gross ??
      salaryData.basic +
        salaryData.hra +
        salaryData.conveyance +
        salaryData.allowances;

    salaryData.deductions =
      salary.deductions ??
      salaryData.pf +
        salaryData.esi +
        salaryData.professionalTax +
        salaryData.tds;

    salaryData.netPay =
      salary.netPay ?? salaryData.gross - salaryData.deductions;

    const payload = {
      employee: employee._id,
      employeeId:
        employee.employeeId || `EMP${employee._id.toString().slice(-4)}`,
      month: Number(month),
      year: Number(year),
      workingDays: Number(workingDays) || 0,
      designation: employee.designation || "Employee",
      bankSnapshot: bankDetails,
      salary: salaryData,
      templateId,
      createdBy: req.user.id
    };

    if (payslip) {
      Object.assign(payslip, payload);
      payslip = await payslip.save();
    } else {
      payslip = await Payslip.create(payload);
    }

    res.status(201).json({
      message: "Payslip generated successfully",
      payslip
    });
  } catch (error) {
    console.error("❌ Payslip create error:", error);
    res.status(500).json({
      message: "Failed to generate payslip",
      error: error.message
    });
  }
});

/* =====================================================
   GET LOGGED-IN EMPLOYEE PAYSLIPS
===================================================== */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const payslips = await Payslip.find({ employee: req.user.id })
      .sort({ year: -1, month: -1 })
      .lean();

    res.json(payslips);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   GET PAYSLIPS BY EMPLOYEE ID (MANAGER / ADMIN)
===================================================== */
router.get("/employee/:employeeId", authMiddleware, async (req, res) => {
  try {
    const payslips = await Payslip.find({
      employee: req.params.employeeId
    })
      .sort({ year: -1, month: -1 })
      .lean();

    res.json(payslips);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   DOWNLOAD PAYSLIP PDF
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id).populate(
      "employee",
      "fullName designation"
    );

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    const salary = payslip.salary || {};

    const html = `
      <html>
        <body style="font-family:Arial;padding:24px">
          <h2 style="text-align:center">Salary Slip</h2>
          <p><strong>Name:</strong> ${payslip.employee.fullName}</p>
          <p><strong>Month:</strong> ${payslip.month}/${payslip.year}</p>
          <table border="1" width="100%" cellpadding="8" cellspacing="0">
            <tr><th>Earnings</th><th>Amount</th></tr>
            <tr><td>Basic</td><td>${salary.basic}</td></tr>
            <tr><td>HRA</td><td>${salary.hra}</td></tr>
            <tr><td>Allowances</td><td>${salary.allowances}</td></tr>
            <tr><th>Gross</th><th>${salary.gross}</th></tr>
            <tr><td>Deductions</td><td>${salary.deductions}</td></tr>
            <tr><th>Net Pay</th><th>${salary.netPay}</th></tr>
          </table>
        </body>
      </html>
    `;

    await page.setContent(html);
    const pdf = await page.pdf({ format: "A4" });
    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.month}-${payslip.year}.pdf"`,
      "Content-Length": pdf.length
    });

    res.send(pdf);
  } catch (error) {
    console.error("PDF error:", error);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

export default router;

// routes/payslipManagementRoutes.js
import express from "express";
import puppeteer from "puppeteer";
import Payslip from "../models/Payslip.js";
import User from "../models/User.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/* =====================================================
   CREATE / UPDATE PAYSLIP (MANAGER / ADMIN)
===================================================== */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      employeeId,
      month,
      year,
      workingDays,
      salary = {},
      bankDetails = {}
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
      allowances: salary.allowances || 0,
      gross:
        salary.gross ??
        (salary.basic || 0) +
          (salary.hra || 0) +
          (salary.allowances || 0),
      deductions: salary.deductions || 0,
      netPay:
        salary.netPay ??
        ((salary.basic || 0) +
          (salary.hra || 0) +
          (salary.allowances || 0) -
          (salary.deductions || 0))
    };

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
  } catch (err) {
    console.error("Payslip create error:", err);
    res.status(500).json({ message: "Failed to generate payslip" });
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
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   DOWNLOAD PAYSLIP PDF (FINAL – SAFE)
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id).populate(
      "employee",
      "fullName email designation"
    );

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    const salary = payslip.salary || {};

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
body { font-family: Arial, sans-serif; padding: 24px; }
h2 { text-align: center; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { border: 1px solid #000; padding: 8px; }
th { background: #f0f0f0; }
</style>
</head>
<body>
<h2>Salary Slip</h2>
<p><strong>Name:</strong> ${payslip.employee.fullName}</p>
<p><strong>Employee ID:</strong> ${payslip.employeeId}</p>
<p><strong>Month:</strong> ${payslip.month}/${payslip.year}</p>

<table>
<tr><th>Earnings</th><th>Amount</th></tr>
<tr><td>Basic</td><td>${salary.basic || 0}</td></tr>
<tr><td>HRA</td><td>${salary.hra || 0}</td></tr>
<tr><td>Allowances</td><td>${salary.allowances || 0}</td></tr>
<tr><th>Gross</th><th>${salary.gross || 0}</th></tr>
<tr><td>Deductions</td><td>${salary.deductions || 0}</td></tr>
<tr><th>Net Pay</th><th>${salary.netPay || 0}</th></tr>
</table>
</body>
</html>
`;

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4" });
    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.month}-${payslip.year}.pdf"`,
      "Content-Length": pdfBuffer.length
    });

    res.end(pdfBuffer);
  } catch (err) {
    console.error("Payslip PDF error:", err);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
});

export default router;

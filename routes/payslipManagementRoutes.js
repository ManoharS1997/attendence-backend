import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import Payslip from "../models/Payslip.js";
import BankDetails from "../models/BankDetails.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";
import { fileURLToPath } from "url";

const router = express.Router();

/* ================= PATH FIX ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================= HELPERS ================= */
const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

const formatCurrency = (amount = 0) =>
  `₹${Number(amount).toLocaleString("en-IN")}`;

const convertNumberToWords = (num = 0) => {
  if (!num) return "Zero Rupees Only";

  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  if (num < 20) return `${a[num]} Rupees Only`;
  if (num < 100)
    return `${b[Math.floor(num / 10)]} ${a[num % 10]} Rupees Only`;

  if (num < 1000)
    return `${a[Math.floor(num / 100)]} Hundred ${convertNumberToWords(num % 100)}`;

  if (num < 100000)
    return `${convertNumberToWords(Math.floor(num / 1000))} Thousand ${convertNumberToWords(num % 1000)}`;

  if (num < 10000000)
    return `${convertNumberToWords(Math.floor(num / 100000))} Lakh ${convertNumberToWords(num % 100000)}`;

  return `${convertNumberToWords(Math.floor(num / 10000000))} Crore ${convertNumberToWords(num % 10000000)}`;
};

/* =====================================================
   GENERATE / REGENERATE PAYSLIP (AUTO DELETE OLD)
===================================================== */
router.post(
  "/",
  authMiddleware,
  requireRole(["manager", "admin"]),
  async (req, res) => {
    try {
      const { employeeId, month, year, workingDays, salary } = req.body;

      if (!employeeId || !month || !year || !salary) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const employee = await User.findById(employeeId);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const bankDetails = await BankDetails.findOne({ employee: employeeId });
      if (!bankDetails) {
        return res.status(400).json({ message: "Bank details not found" });
      }

      /* ===== Salary Calculations ===== */
      const gross =
        (salary.basic || 0) +
        (salary.hra || 0) +
        (salary.conveyance || 0) +
        (salary.travelAllowance || 0) +
        (salary.medicalAllowance || 0) +
        (salary.specialAllowance || 0);

      const deductions =
        (salary.pf || 0) +
        (salary.esi || 0) +
        (salary.professionalTax || 0) +
        (salary.tds || 0);

      const netPay = gross - deductions;

      /* 🔥 AUTO DELETE OLD PAYSLIP */
      await Payslip.findOneAndDelete({
        employee: employeeId,
        month: parseInt(month),
        year: parseInt(year)
      });

      /* ✅ CREATE NEW PAYSLIP */
      const payslip = await Payslip.create({
        employee: employeeId,
        employeeId: employee.employeeId,

        designation: employee.designation || employee.jobTitle || "Employee",
        employeeType: employee.employeeType || "Permanent",

        month: parseInt(month),
        year: parseInt(year),
        workingDays: parseInt(workingDays),

        bankSnapshot: {
          bankName: bankDetails.bankName,
          accountNumber: bankDetails.accountNumber,
          ifsc: bankDetails.ifsc,
          branch: bankDetails.branch,
          accountType: bankDetails.accountType
        },

        salary: {
          ...salary,
          gross,
          deductions,
          netPay
        },

        status: "generated",
        version: 1,
        createdBy: req.user.id,
        createdByName: req.user.fullName
      });

      await Log.create({
        type: "OPERATION",
        action: "REGENERATE_PAYSLIP",
        entity: "PAYSLIP",
        user: req.user.id,
        userName: req.user.fullName,
        role: req.user.role,
        description: `Generated payslip for ${employee.fullName} ${month}/${year}`,
        status: "SUCCESS",
        ipAddress: getClientIp(req)
      });

      res.status(201).json({
        message: "Payslip generated successfully",
        payslip
      });

    } catch (err) {
      console.error("Payslip generate error:", err);
      res.status(500).json({ message: "Failed to generate payslip" });
    }
  }
);

/* =====================================================
   DOWNLOAD PAYSLIP PDF (SINGLE SOURCE OF TRUTH)
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  let browser;

  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    if (
      req.user.role === "employee" &&
      req.user.id !== payslip.employee._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const logoPath = path.join(__dirname, "../assets/company-logo.jpg");
    let logoSrc = "";
    if (fs.existsSync(logoPath)) {
      logoSrc = `data:image/jpeg;base64,${fs.readFileSync(logoPath, "base64")}`;
    }

    const monthNames = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
body { font-family: Arial; font-size:12px; }
table { width:100%; border-collapse:collapse; }
th, td { border:1px solid #ccc; padding:6px; }
th { background:#f1f5f9; }
.netpay { margin:20px 0; padding:15px; border:2px solid #1e3a8a; text-align:center; font-size:20px; font-weight:bold; }
</style>
</head>
<body>

<div style="text-align:center">
${logoSrc ? `<img src="${logoSrc}" height="60"/>` : ""}
<h2>NOW IT SERVICES PVT LTD</h2>
<p>SALARY SLIP – ${monthNames[payslip.month - 1]} ${payslip.year}</p>
</div>

<table>
<tr><th>Employee Name</th><td>${payslip.employee.fullName}</td><th>Employee ID</th><td>${payslip.employeeId}</td></tr>
<tr><th>Designation</th><td>${payslip.designation}</td><th>Employee Status</th><td>${payslip.employeeType}</td></tr>
<tr><th>Working Days</th><td colspan="3">${payslip.workingDays}</td></tr>
</table>

<h4>Earnings</h4>
<table>
<tr><td>Basic</td><td>${formatCurrency(payslip.salary.basic)}</td></tr>
<tr><td>HRA</td><td>${formatCurrency(payslip.salary.hra)}</td></tr>
<tr><td>Special Allowance</td><td>${formatCurrency(payslip.salary.specialAllowance)}</td></tr>
<tr><th>Total Earnings</th><th>${formatCurrency(payslip.salary.gross)}</th></tr>
</table>

<h4>Deductions</h4>
<table>
<tr><td>PF</td><td>${formatCurrency(payslip.salary.pf)}</td></tr>
<tr><td>ESI</td><td>${formatCurrency(payslip.salary.esi)}</td></tr>
<tr><td>Professional Tax</td><td>${formatCurrency(payslip.salary.professionalTax)}</td></tr>
<tr><th>Total Deductions</th><th>${formatCurrency(payslip.salary.deductions)}</th></tr>
</table>

<div class="netpay">
NET PAYABLE AMOUNT<br/>
${formatCurrency(payslip.salary.netPay)}<br/>
(${convertNumberToWords(payslip.salary.netPay)})
</div>

<p style="text-align:center;font-size:10px">
This is a computer generated payslip and does not require signature.
</p>

</body>
</html>
`;

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.employee.fullName}-${payslip.month}-${payslip.year}.pdf"`
    });

    res.end(pdf);

  } catch (err) {
    if (browser) await browser.close();
    console.error("PDF error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

export default router;

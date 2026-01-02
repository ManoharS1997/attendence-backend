import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import Payslip from "../models/Payslip.js";
import { authMiddleware } from "../middleware/auth.js";
import { fileURLToPath } from "url";

const router = express.Router();

/* ================= PATH FIX ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =====================================================
   GENERATE / CREATE PAYSLIP  ✅ DUPLICATE SAFE
===================================================== */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      employeeId,
      month,
      year,
      workingDays,
      salary,
      bankDetails
    } = req.body;

    if (!employeeId || !month || !year || !salary) {
      return res.status(400).json({
        message: "employeeId, month, year and salary are required"
      });
    }

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

    const payslip = await Payslip.create({
      employee: employeeId,
      employeeId,
      month,
      year,
      workingDays,
      salary: {
        ...salary,
        gross,
        deductions,
        netPay
      },
      bankSnapshot: bankDetails,
      createdBy: req.user.id
    });

    return res.status(201).json({
      message: "Payslip generated successfully",
      payslip
    });

  } catch (err) {
    /* ✅ DUPLICATE PAYSLIP HANDLING */
    if (err.code === 11000) {
      return res.status(409).json({
        message:
          "Payslip already generated for this employee for this month"
      });
    }

    console.error("❌ Generate payslip error:", err);
    return res.status(500).json({
      message: "Failed to generate payslip"
    });
  }
});

/* =====================================================
   DOWNLOAD PAYSLIP PDF (WITH COMPANY LOGO)
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  let browser;

  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email designation employeeId");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    /* ================= LOGO ================= */
    const logoPath = path.join(__dirname, "../assets/company-logo.jpg");
    const logoBase64 = fs.readFileSync(logoPath, "base64");
    const logoSrc = `data:image/jpeg;base64,${logoBase64}`;

    const monthNames = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];

    const inr = (n) =>
      "₹" + Number(n || 0).toLocaleString("en-IN");

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
body { font-family: Arial, sans-serif; font-size:12px; }
.header { text-align:center; }
.logo { height:65px; margin-bottom:6px; }
.company { font-size:22px; font-weight:bold; color:#1e3a8a; }
.subtitle { color:#555; }

table { width:100%; border-collapse:collapse; margin-top:10px; }
th, td { border:1px solid #cbd5e1; padding:6px; }
th { background:#f1f5f9; }

.section { background:#e5edff; color:#1e3a8a; font-weight:bold; padding:6px; margin-top:12px; }
.flex { display:flex; gap:10px; }
.flex table { width:50%; }
.amount { text-align:right; }

.netpay {
  margin:20px 0;
  border:2px solid #1e3a8a;
  padding:15px;
  text-align:center;
  font-size:22px;
  font-weight:bold;
  color:#1e3a8a;
}

.footer { margin-top:25px; text-align:center; font-size:10px; color:#555; }
.sign { display:flex; justify-content:space-between; margin-top:30px; }
</style>
</head>

<body>

<div class="header">
  <img src="${logoSrc}" class="logo"/>
  <div class="company">NOW IT SERVICES PVT LTD</div>
  <div class="subtitle">SALARY SLIP</div>
  <div class="subtitle">
    For the month of ${monthNames[payslip.month - 1]} ${payslip.year}
  </div>
</div>

<table>
<tr>
  <th>Employee ID</th><td>${payslip.employeeId}</td>
  <th>Employee Name</th><td>${payslip.employee.fullName}</td>
</tr>
<tr>
  <th>Email</th><td>${payslip.employee.email}</td>
  <th>Designation</th><td>${payslip.designation}</td>
</tr>
<tr>
  <th>Working Days</th><td>${payslip.workingDays} days</td>
  <th>Employee Type</th><td>Permanent</td>
</tr>
</table>

<div class="section">Bank Details</div>
<table>
<tr>
  <th>Bank Name</th><td>${payslip.bankSnapshot?.bankName || ""}</td>
  <th>Account Number</th>
  <td>****${String(payslip.bankSnapshot?.accountNumber || "").slice(-4)}</td>
</tr>
<tr>
  <th>IFSC Code</th><td>${payslip.bankSnapshot?.ifscCode || ""}</td>
  <th>Branch</th><td>${payslip.bankSnapshot?.branch || ""}</td>
</tr>
</table>

<div class="flex">
<table>
<tr><th colspan="2">Earnings</th></tr>
<tr><td>Basic Pay</td><td class="amount">${inr(payslip.salary.basic)}</td></tr>
<tr><td>HRA</td><td class="amount">${inr(payslip.salary.hra)}</td></tr>
<tr><td>Conveyance</td><td class="amount">${inr(payslip.salary.conveyance)}</td></tr>
<tr><td>Travel</td><td class="amount">${inr(payslip.salary.travelAllowance)}</td></tr>
<tr><td>Medical</td><td class="amount">${inr(payslip.salary.medicalAllowance)}</td></tr>
<tr><td>Special</td><td class="amount">${inr(payslip.salary.specialAllowance)}</td></tr>
<tr><th>Total Earnings</th><th class="amount">${inr(payslip.salary.gross)}</th></tr>
</table>

<table>
<tr><th colspan="2">Deductions</th></tr>
<tr><td>PF</td><td class="amount">${inr(payslip.salary.pf)}</td></tr>
<tr><td>ESI</td><td class="amount">${inr(payslip.salary.esi)}</td></tr>
<tr><td>Professional Tax</td><td class="amount">${inr(payslip.salary.professionalTax)}</td></tr>
<tr><td>Income Tax</td><td class="amount">${inr(payslip.salary.tds)}</td></tr>
<tr><th>Total Deductions</th><th class="amount">${inr(payslip.salary.deductions)}</th></tr>
</table>
</div>

<div class="netpay">
  NET PAYABLE AMOUNT<br/>
  ${inr(payslip.salary.netPay)} only
</div>

<div class="sign">
  <div>Employee Signature</div>
  <div>Authorized Signatory</div>
</div>

<div class="footer">
  NOW IT SERVICES PVT LTD<br/>
  6-284-1, Uma Shankar Nagar, Revenue Ward-17, YSR Tadigadapa, 520007<br/>
  Phone: 7893536373 | Email: hr@nowitservices.com<br/><br/>
  This is a computer generated payslip and does not require signature.<br/>
  Generated on ${new Date().toLocaleString("en-IN")}
</div>

</body>
</html>
`;

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true
    });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.employee.fullName}.pdf"`,
      "Content-Length": pdf.length
    });

    return res.end(pdf);

  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ PDF error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

export default router;

// routes/payslipRoutes.js
import express from "express";
import puppeteer from "puppeteer";
import { authMiddleware } from "../middleware/auth.js";
import Payslip from "../models/Payslip.js";

const router = express.Router();

// ✅ INR formatter (FIXES ₹ ISSUE EVERYWHERE)
const formatINR = (value = 0) => `₹${Number(value).toLocaleString("en-IN")}`;

/**
 * 📄 DOWNLOAD PAYSLIP PDF
 * - Employee: only own payslip
 * - Manager/Admin: any payslip
 */
router.get("/:id/download", authMiddleware, async (req, res) => {
  let browser;

  try {
    const payslip = await Payslip.findById(req.params.id).populate("employee");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // 🔐 Employee can download ONLY their own payslip
    if (
      req.user.role === "employee" &&
      payslip.employee?._id?.toString() !== req.user._id
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // ✅ NORMALIZE DATA
    const salary = payslip.salary || {};

    // ✅ STRONG FALLBACK (FIXES N/A ISSUE)
    const designation =
      payslip.designation ||
      payslip.employee?.designation ||
      payslip.employee?.jobTitle ||
      "N/A";

    const employeeType =
      payslip.employeeType ||
      payslip.employee?.employeeType ||
      payslip.employee?.employmentType ||
      "N/A";

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process"
      ]
    });

    const page = await browser.newPage();

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Payslip</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap" rel="stylesheet">
<style>
body { font-family: Arial, sans-serif; background: #f4f7fb; padding: 24px; }
.payslip { max-width: 900px; margin: auto; background: #fff; border-radius: 10px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
.header { text-align: center; border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; font-size: 14px; }
.box { border: 1px solid #dbeafe; padding: 10px; border-radius: 6px; background: #f8fbff; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; }
th { background: #2563eb; color: #fff; padding: 10px; }
td { border: 1px solid #dbeafe; padding: 8px; }
.total { font-weight: bold; background: #eff6ff; }
.netpay { margin-top: 24px; background: linear-gradient(90deg, #1e40af, #2563eb); color: #fff; padding: 18px; border-radius: 8px; text-align: center; font-size: 22px; font-weight: bold; }
.footer { margin-top: 40px; font-size: 12px; text-align: center; color: #666; }
</style>
</head>

<body>
<div class="payslip">
  <div class="header">
    <h1>NOW IT SERVICES PVT LTD</h1>
    <p>SALARY SLIP</p>
    <p>For the month of ${payslip.month} / ${payslip.year}</p>
  </div>

  <div class="info">
    <div class="box"><strong>Name:</strong> ${payslip.employee?.fullName || "N/A"}</div>
    <div class="box"><strong>Employee ID:</strong> ${payslip.employeeId || "N/A"}</div>
    <div class="box"><strong>Email:</strong> ${payslip.employee?.email || "N/A"}</div>
    <div class="box"><strong>Designation:</strong> ${designation}</div>
    <div class="box"><strong>Employee Status:</strong> ${employeeType}</div>
    <div class="box"><strong>Working Days:</strong> ${payslip.workingDays ?? 0}</div>
  </div>

  <table>
    <tr><th>Earnings</th><th>Amount</th></tr>
    <tr><td>Basic Pay</td><td>${formatINR(salary.basic)}</td></tr>
    <tr><td>HRA</td><td>${formatINR(salary.hra)}</td></tr>
    <tr><td>Special Allowance</td><td>${formatINR(salary.specialAllowance)}</td></tr>
    <tr class="total"><td>Total Earnings</td><td>${formatINR(salary.gross)}</td></tr>
  </table>

  <table>
    <tr><th>Deductions</th><th>Amount</th></tr>
    <tr><td>PF</td><td>${formatINR(salary.pf)}</td></tr>
    <tr><td>ESI</td><td>${formatINR(salary.esi)}</td></tr>
    <tr><td>Professional Tax</td><td>${formatINR(salary.professionalTax)}</td></tr>
    <tr><td>TDS</td><td>${formatINR(salary.tds)}</td></tr>
    <tr class="total"><td>Total Deductions</td><td>${formatINR(salary.deductions)}</td></tr>
  </table>

  <div class="netpay">
    NET PAY ${formatINR(salary.netPay)}
  </div>

  <div class="footer">
    This is a system generated payslip and does not require signature.<br/>
    © ${new Date().getFullYear()} NOW IT SERVICES PVT LTD
  </div>
</div>
</body>
</html>
`;

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm" }
    });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.employee?.fullName || "Employee"}-${payslip.month}-${payslip.year}.pdf"`,
      "Content-Length": pdfBuffer.length
    });

    return res.end(pdfBuffer);
  } catch (error) {
    if (browser) await browser.close();
    console.error("Payslip download error:", error);
    return res.status(500).json({ message: "Failed to generate payslip PDF" });
  }
});

export default router;

import express from "express";
import puppeteer from "puppeteer";
import authMiddleware from "../middleware/authMiddleware.js";
import Payslip from "../models/Payslip.js";

const router = express.Router();

/**
 * DOWNLOAD PAYSLIP PDF (SINGLE & SAFE)
 */
router.get("/:id/download", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Employee can download ONLY their own payslip
    if (
      req.user.role === "EMPLOYEE" &&
      payslip.employee._id.toString() !== req.user.id
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Payslip</title>
  <style>
    body {
      font-family: "Segoe UI", Arial, sans-serif;
      background: #f4f7fb;
      padding: 24px;
    }
    .payslip {
      max-width: 900px;
      margin: auto;
      background: #fff;
      border-radius: 10px;
      padding: 24px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0;
      color: #1e3a8a;
      font-size: 26px;
    }
    .header p {
      margin: 4px 0;
      font-size: 13px;
      color: #555;
    }
    .info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .box {
      border: 1px solid #dbeafe;
      padding: 10px;
      border-radius: 6px;
      background: #f8fbff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
    }
    th {
      background: #2563eb;
      color: #fff;
      padding: 10px;
      font-size: 14px;
    }
    td {
      border: 1px solid #dbeafe;
      padding: 8px;
      font-size: 14px;
    }
    .total {
      font-weight: bold;
      background: #eff6ff;
    }
    .netpay {
      margin-top: 24px;
      background: linear-gradient(90deg, #1e40af, #2563eb);
      color: #fff;
      padding: 18px;
      border-radius: 8px;
      text-align: center;
      font-size: 22px;
      font-weight: bold;
    }
    .footer {
      margin-top: 40px;
      font-size: 12px;
      text-align: center;
      color: #666;
    }
    .sign {
      display: flex;
      justify-content: space-between;
      margin-top: 50px;
    }
    .sign div {
      width: 40%;
      text-align: center;
      border-top: 1px solid #333;
      padding-top: 6px;
      font-size: 13px;
    }
  </style>
</head>

<body>
  <div class="payslip">
    <div class="header">
      <h1>NOW IT SERVICES PVT LTD</h1>
      <p>SALARY SLIP</p>
      <p>For the month of ${payslip.month}/${payslip.year}</p>
    </div>

    <div class="info">
      <div class="box"><strong>Name:</strong> ${payslip.employee?.fullName}</div>
      <div class="box"><strong>Employee ID:</strong> ${payslip.employee?.employeeId}</div>
      <div class="box"><strong>Email:</strong> ${payslip.employee?.email}</div>
      <div class="box"><strong>Designation:</strong> ${payslip.employee?.designation || "Employee"}</div>
    </div>

    <table>
      <tr><th>Earnings</th><th>Amount (₹)</th></tr>
      <tr><td>Basic Pay</td><td>${payslip.basicSalary}</td></tr>
      <tr><td>HRA</td><td>${payslip.hra || 0}</td></tr>
      <tr><td>Allowances</td><td>${payslip.allowances || 0}</td></tr>
      <tr class="total"><td>Total Earnings</td><td>${payslip.grossSalary}</td></tr>
    </table>

    <table>
      <tr><th>Deductions</th><th>Amount (₹)</th></tr>
      <tr><td>Deductions</td><td>${payslip.deductions || 0}</td></tr>
      <tr class="total"><td>Total Deductions</td><td>${payslip.deductions || 0}</td></tr>
    </table>

    <div class="netpay">
      NET PAYABLE AMOUNT ₹${payslip.netPay}
    </div>

    <div class="sign">
      <div>Employee Signature</div>
      <div>Authorized Signatory</div>
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
      "Content-Disposition": `attachment; filename="Payslip-${payslip.employee?.fullName}-${payslip.month}-${payslip.year}.pdf"`,
      "Content-Length": pdfBuffer.length
    });

    return res.end(pdfBuffer);
  } catch (error) {
    console.error("Payslip download error:", error);
    return res.status(500).json({ message: "Failed to generate payslip PDF" });
  }
});

export default router;

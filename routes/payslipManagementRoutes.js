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
      conveyance: salary.conveyance || 0,
      travelAllowance: salary.travelAllowance || 0,
      medicalAllowance: salary.medicalAllowance || 0,
      specialAllowance: salary.specialAllowance || 0,
      pf: salary.pf || 0,
      esi: salary.esi || 0,
      professionalTax: salary.professionalTax || 0,
      tds: salary.tds || 0,
      gross: salary.gross || 0,
      deductions: salary.deductions || 0,
      netPay: salary.netPay || 0
    };

    // Calculate if not provided
    if (!salaryData.gross) {
      salaryData.gross = (salaryData.basic || 0) +
        (salaryData.hra || 0) +
        (salaryData.conveyance || 0) +
        (salaryData.travelAllowance || 0) +
        (salaryData.medicalAllowance || 0) +
        (salaryData.specialAllowance || 0);
    }

    if (!salaryData.deductions) {
      salaryData.deductions = (salaryData.pf || 0) +
        (salaryData.esi || 0) +
        (salaryData.professionalTax || 0) +
        (salaryData.tds || 0);
    }

    if (!salaryData.netPay) {
      salaryData.netPay = salaryData.gross - salaryData.deductions;
    }

    const payload = {
      employee: employee._id,
      employeeId: employee.employeeId || `EMP${employee._id.toString().slice(-4)}`,
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
    console.error("Get my payslips error:", err);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   GET PAYSLIP BY ID (for preview)
===================================================== */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email designation employeeId");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Check if user has permission to view this payslip
    const isOwner = String(payslip.employee._id) === String(req.user.id);
    const isManagerOrAdmin = req.user.role === 'manager' || req.user.role === 'admin';
    
    if (!isOwner && !isManagerOrAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(payslip);
  } catch (err) {
    console.error("Get payslip error:", err);
    res.status(500).json({ message: "Failed to fetch payslip" });
  }
});

/* =====================================================
   DOWNLOAD PAYSLIP PDF - FIXED VERSION
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email designation employeeId");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Check if user has permission to download this payslip
    const isOwner = String(payslip.employee._id) === String(req.user.id);
    const isManagerOrAdmin = req.user.role === 'manager' || req.user.role === 'admin';
    
    if (!isOwner && !isManagerOrAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Month names for display
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    
    const monthName = monthNames[payslip.month - 1] || payslip.month;
    const generatedDate = new Date().toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Format amount in Indian Rupees
    const formatINR = (amount) => {
      if (!amount && amount !== 0) return '₹0';
      return '₹' + amount.toLocaleString('en-IN');
    };

    // Get the amount in words
    const getAmountInWords = (num) => {
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      
      if (num === 0) return 'Zero';
      
      let result = '';
      
      if (num >= 100000) {
        const lakhs = Math.floor(num / 100000);
        result += convertLessThanOneThousand(lakhs) + ' Lakh ';
        num %= 100000;
      }
      
      if (num >= 1000) {
        const thousands = Math.floor(num / 1000);
        result += convertLessThanOneThousand(thousands) + ' Thousand ';
        num %= 1000;
      }
      
      if (num > 0) {
        result += convertLessThanOneThousand(num);
      }
      
      return result.trim() + ' Rupees Only';
    };

    const convertLessThanOneThousand = (num) => {
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      
      let result = '';
      
      if (num >= 100) {
        result += ones[Math.floor(num / 100)] + ' Hundred ';
        num %= 100;
      }
      
      if (num >= 20) {
        result += tens[Math.floor(num / 10)] + ' ';
        num %= 10;
      } else if (num >= 10) {
        result += teens[num - 10] + ' ';
        return result;
      }
      
      if (num > 0) {
        result += ones[num] + ' ';
      }
      
      return result;
    };

    // Generate HTML matching your sample PDF
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Payslip - ${payslip.employee.fullName}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm 20mm;
    }
    body {
      font-family: 'Arial', sans-serif;
      margin: 0;
      padding: 0;
      color: #000;
      background-color: #fff;
      font-size: 12px;
      line-height: 1.4;
    }
    .container {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      padding: 5mm;
      box-sizing: border-box;
    }
    .header {
      text-align: center;
      margin-bottom: 10mm;
      padding-bottom: 3mm;
      border-bottom: 3px solid #1e40af;
    }
    .company-name {
      font-size: 22px;
      font-weight: bold;
      color: #1e40af;
      margin: 3mm 0 1mm 0;
      letter-spacing: 0.5px;
    }
    .payslip-title {
      font-size: 18px;
      font-weight: bold;
      margin: 2mm 0;
      color: #374151;
    }
    .period {
      font-size: 14px;
      color: #666;
      margin: 1mm 0 3mm 0;
      font-weight: 500;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
      margin: 5mm 0;
      font-size: 11px;
      border: 1px solid #cbd5e1;
    }
    .info-table th, .info-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      vertical-align: top;
    }
    .info-table th {
      background-color: #f1f5f9;
      font-weight: 600;
      color: #374151;
      width: 20%;
    }
    .amount {
      text-align: right;
      font-weight: 500;
    }
    .salary-section {
      display: flex;
      gap: 10mm;
      margin: 5mm 0;
    }
    .earnings, .deductions {
      flex: 1;
      min-width: 0;
    }
    .section-title {
      font-size: 14px;
      font-weight: bold;
      color: #1e40af;
      margin-bottom: 3mm;
      padding-bottom: 2mm;
      border-bottom: 2px solid #3b82f6;
    }
    .salary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      border: 1px solid #cbd5e1;
    }
    .salary-table th, .salary-table td {
      border: 1px solid #cbd5e1;
      padding: 5px 8px;
    }
    .salary-table th {
      background-color: #f8fafc;
      font-weight: 600;
    }
    .total-row {
      font-weight: bold;
      background-color: #f1f5f9;
      border-top: 2px solid #cbd5e1;
    }
    .net-pay-section {
      background: linear-gradient(135deg, #1e40af, #3b82f6);
      color: white;
      padding: 8mm 5mm;
      border-radius: 6px;
      text-align: center;
      margin: 8mm 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .net-pay-label {
      font-size: 14px;
      margin-bottom: 2mm;
      opacity: 0.9;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .net-pay-amount {
      font-size: 28px;
      font-weight: bold;
      margin: 3mm 0;
      letter-spacing: 0.5px;
    }
    .net-pay-words {
      font-size: 11px;
      opacity: 0.9;
      font-style: italic;
    }
    .signature-section {
      display: flex;
      justify-content: space-between;
      margin: 10mm 0 5mm 0;
      padding-top: 5mm;
      border-top: 1px solid #cbd5e1;
    }
    .signature-box {
      text-align: center;
      width: 45%;
    }
    .signature-line {
      border-top: 1px solid #000;
      width: 70%;
      margin: 15mm auto 2mm;
    }
    .signature-label {
      font-size: 11px;
      color: #666;
    }
    .footer {
      text-align: center;
      font-size: 10px;
      color: #666;
      margin-top: 5mm;
      padding-top: 3mm;
      border-top: 1px solid #e5e7eb;
      line-height: 1.5;
    }
    .company-address {
      font-size: 10px;
      color: #6b7280;
      margin: 1mm 0;
    }
    .generated-date {
      text-align: right;
      font-size: 9px;
      color: #9ca3af;
      margin-top: 2mm;
    }
    .note {
      font-size: 10px;
      color: #666;
      font-style: italic;
      margin: 2mm 0;
    }
    @media print {
      body {
        padding: 0;
        margin: 0;
      }
      .container {
        padding: 0;
        box-shadow: none;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="company-name">NOW IT SERVICES PVT LTD</div>
      <div class="payslip-title">SALARY SLIP</div>
      <div class="period">For the month of ${monthName} ${payslip.year}</div>
    </div>

    <!-- Employee Information -->
    <table class="info-table">
      <tr>
        <th>Employee ID</th>
        <td>${payslip.employeeId || 'N/A'}</td>
        <th>Employee Name</th>
        <td>${payslip.employee.fullName}</td>
      </tr>
      <tr>
        <th>Email</th>
        <td>${payslip.employee.email}</td>
        <th>Designation</th>
        <td>${payslip.designation || 'Employee'}</td>
      </tr>
      <tr>
        <th>Working Days</th>
        <td>${payslip.workingDays || 0} days</td>
        <th>Employee Type</th>
        <td>Permanent</td>
      </tr>
    </table>

    <!-- Bank Information -->
    <table class="info-table">
      <tr>
        <th>Bank Name</th>
        <td>${payslip.bankSnapshot?.bankName || 'City Union Bank'}</td>
        <th>Account Number</th>
        <td>****${(payslip.bankSnapshot?.accountNumber || '1215').slice(-4)}</td>
      </tr>
      <tr>
        <th>IFSC Code</th>
        <td>${payslip.bankSnapshot?.ifsc || 'CIUB0001234'}</td>
        <th>Branch</th>
        <td>${payslip.bankSnapshot?.branch || 'Vijayawada'}</td>
      </tr>
    </table>

    <!-- Salary Breakdown -->
    <div class="salary-section">
      <div class="earnings">
        <div class="section-title">Earnings</div>
        <table class="salary-table">
          <tr>
            <td>Basic Pay</td>
            <td class="amount">${formatINR(payslip.salary?.basic || 0)}</td>
          </tr>
          <tr>
            <td>House Rent Allowance (HRA)</td>
            <td class="amount">${formatINR(payslip.salary?.hra || 0)}</td>
          </tr>
          <tr>
            <td>Conveyance Allowance</td>
            <td class="amount">${formatINR(payslip.salary?.conveyance || 0)}</td>
          </tr>
          <tr>
            <td>Travel Allowance</td>
            <td class="amount">${formatINR(payslip.salary?.travelAllowance || 0)}</td>
          </tr>
          <tr>
            <td>Medical Allowance</td>
            <td class="amount">${formatINR(payslip.salary?.medicalAllowance || 0)}</td>
          </tr>
          <tr>
            <td>Special Allowance</td>
            <td class="amount">${formatINR(payslip.salary?.specialAllowance || 0)}</td>
          </tr>
          <tr class="total-row">
            <td><strong>Total Earnings</strong></td>
            <td class="amount"><strong>${formatINR(payslip.salary?.gross || 0)}</strong></td>
          </tr>
        </table>
      </div>

      <div class="deductions">
        <div class="section-title">Deductions</div>
        <table class="salary-table">
          <tr>
            <td>Provident Fund (PF)</td>
            <td class="amount">${formatINR(payslip.salary?.pf || 0)}</td>
          </tr>
          <tr>
            <td>ESI Contribution</td>
            <td class="amount">${formatINR(payslip.salary?.esi || 0)}</td>
          </tr>
          <tr>
            <td>Professional Tax</td>
            <td class="amount">${formatINR(payslip.salary?.professionalTax || 0)}</td>
          </tr>
          <tr>
            <td>Income Tax (TDS)</td>
            <td class="amount">${formatINR(payslip.salary?.tds || 0)}</td>
          </tr>
          <tr class="total-row">
            <td><strong>Total Deductions</strong></td>
            <td class="amount"><strong>${formatINR(payslip.salary?.deductions || 0)}</strong></td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Net Pay Section -->
    <div class="net-pay-section">
      <div class="net-pay-label">NET PAYABLE AMOUNT</div>
      <div class="net-pay-amount">${formatINR(payslip.salary?.netPay || 0)}</div>
      <div class="net-pay-words">${getAmountInWords(payslip.salary?.netPay || 0)}</div>
    </div>

    // <!-- Signatures -->
    // <div class="signature-section">
    //   <div class="signature-box">
    //     <div class="signature-line"></div>
    //     <div class="signature-label">Employee Signature</div>
    //   </div>
    //   <div class="signature-box">
    //     <div class="signature-line"></div>
    //     <div class="signature-label">Authorized Signatory</div>
    //   </div>
    // </div>

    <!-- Footer -->
    <div class="footer">
      <div>
        <p><strong>NOW IT SERVICES PVT LTD</strong></p>
        <p class="company-address">6-284-1, Uma Shankar Nagar, Revenue Ward -17, YSR Tadigadapa, 520007</p>
        <p class="company-address">Phone: 7893536373 | Email: hr@nowitservices.com</p>
      </div>
      <p class="note">This is a computer generated payslip and does not require signature.</p>
      <div class="generated-date">
        Generated on ${generatedDate}
      </div>
      <p>© ${new Date().getFullYear()} NOW IT SERVICES PVT LTD. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

    // Launch browser and generate PDF
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "20mm", right: "20mm" }
    });

    await browser.close();

    // Set headers for PDF download
    const filename = `Payslip-${payslip.employee.fullName.replace(/\s+/g, '-')}-${monthName}-${payslip.year}.pdf`;
    
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length,
      "Access-Control-Expose-Headers": "Content-Disposition"
    });

    res.send(pdfBuffer);

  } catch (err) {
    console.error("Payslip PDF download error:", err);
    res.status(500).json({ 
      message: "Failed to generate PDF",
      error: err.message 
    });
  }
});

/* =====================================================
   TEST ENDPOINT (for debugging)
===================================================== */
router.get("/test/download", authMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Payslip download endpoint is working",
      timestamp: new Date().toISOString(),
      user: req.user
    });
  } catch (err) {
    console.error("Test endpoint error:", err);
    res.status(500).json({ message: "Test endpoint failed" });
  }
});

export default router;
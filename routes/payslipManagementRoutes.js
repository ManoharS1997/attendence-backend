// routes/payslipManagementRoutes.js
import express from "express";
import Payslip from "../models/Payslip.js";
import User from "../models/User.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

import puppeteer from "puppeteer";

router.get("/:id/download", async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id).populate("employee");
    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            td, th { border: 1px solid #333; padding: 8px; }
            th { background: #f0f0f0; }
          </style>
        </head>
        <body>
          <h1>Payslip</h1>
          <p><strong>Name:</strong> ${payslip.employee?.fullName || ""}</p>
          <p><strong>Month:</strong> ${payslip.month}/${payslip.year}</p>

          <table>
            <tr><th>Description</th><th>Amount</th></tr>
            <tr><td>Basic Salary</td><td>${payslip.basicSalary || 0}</td></tr>
            <tr><td>Allowances</td><td>${payslip.allowances || 0}</td></tr>
            <tr><td>Deductions</td><td>${payslip.deductions || 0}</td></tr>
            <tr>
              <th>Net Pay</th>
              <th>${payslip.netPay}</th>
            </tr>
          </table>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4" });

    console.log("PDF BUFFER SIZE:", pdfBuffer.length);

    await browser.close();

    console.log("PDF BUFFER SIZE:", pdfBuffer.length); // 🔍 DEBUG

    res.set({
  "Content-Type": "application/pdf",
  "Content-Disposition": `attachment; filename="Payslip-${payslip.month}-${payslip.year}.pdf"`,
  "Content-Length": pdfBuffer.length,
});

res.removeHeader("Content-Encoding");
res.send(pdfBuffer);

  } catch (err) {
    console.error("Payslip download error:", err);
    res.status(500).json({ message: "Failed to generate payslip PDF" });
  }
});

/* =====================================================
   CREATE PAYSLIP (UPDATED)
===================================================== */
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
      employeeId,   // string EMP001
      month,
      year,
      workingDays,
      salary,
      bankDetails,
      templateId
    } = req.body;

    console.log("📥 Received payslip data:", {
      employeeId,
      month,
      year,
      workingDays,
      bankDetails,
      salary
    });

    if (!employeeId || !month || !year) {
      return res.status(400).json({ 
        message: "Missing required fields: employeeId, month, year" 
      });
    }

    // Find employee by _id
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Check existing payslip
    let payslip = await Payslip.findOne({
      employee: employee._id,
      month: parseInt(month),
      year: parseInt(year)
    });

    console.log("🔍 Existing payslip:", payslip ? "Found" : "Not found");

    // Ensure salary object has all required fields
    const salaryData = {
      basic: salary?.basic || 0,
      hra: salary?.hra || 0,
      conveyance: salary?.conveyance || 0,
      allowances: salary?.allowances || 0,
      pf: salary?.pf || 0,
      esi: salary?.esi || 0,
      professionalTax: salary?.professionalTax || 0,
      tds: salary?.tds || 0,
      gross: salary?.gross || 0,
      deductions: salary?.deductions || 0,
      netPay: salary?.netPay || 0
    };

    // Calculate if not provided
    if (!salaryData.gross) {
      salaryData.gross = salaryData.basic + salaryData.hra + salaryData.conveyance + salaryData.allowances;
    }
    if (!salaryData.deductions) {
      salaryData.deductions = salaryData.pf + salaryData.esi + salaryData.professionalTax + salaryData.tds;
    }
    if (!salaryData.netPay) {
      salaryData.netPay = salaryData.gross - salaryData.deductions;
    }

    const payload = {
      employee: employee._id,                 // ObjectId
      employeeId: employee.employeeId || `EMP${employee._id.toString().slice(-4)}`, // ✅ REQUIRED STRING
      month: parseInt(month),
      year: parseInt(year),
      workingDays: parseInt(workingDays) || 0,
      designation: employee.designation || "Employee",
      bankSnapshot: bankDetails || {},
      salary: salaryData,
      createdBy: req.user.id
    };

    console.log("📝 Payslip payload:", payload);

    if (payslip) {
      // Update existing
      Object.assign(payslip, payload);
      payslip = await payslip.save();
    } else {
      // Create new
      payslip = await Payslip.create(payload);
    }

    console.log("✅ Payslip saved:", payslip._id);

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
   GET EMPLOYEE PAYSLIPS
===================================================== */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const payslips = await Payslip.find({
      employee: req.user.id
    })
      .sort({ year: -1, month: -1 })
      .select("month year employeeId salary.netPay salary.gross salary.deductions workingDays createdAt")
      .lean();

    res.json(payslips);
  } catch (error) {
    console.error("Fetch employee payslips error:", error);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   GET EMPLOYEE PAYSLIPS BY ID (for manager)
===================================================== */
router.get("/employee/:employeeId", authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    const payslips = await Payslip.find({
      employee: employeeId
    })
      .sort({ year: -1, month: -1 })
      .select("month year employeeId salary.netPay salary.gross salary.deductions workingDays createdAt")
      .lean();

    res.json(payslips);
  } catch (error) {
    console.error("Fetch employee payslips error:", error);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   DOWNLOAD PAYSLIP PDF (UPDATED)
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  try {
    console.log("📥 Download request for payslip ID:", req.params.id);
    
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email designation");

    if (!payslip) {
      console.log("❌ Payslip not found:", req.params.id);
      return res.status(404).json({ message: "Payslip not found" });
    }

    console.log("✅ Payslip found:", {
      id: payslip._id,
      employee: payslip.employee?.fullName,
      month: payslip.month,
      year: payslip.year
    });

    // Get bank details from either bankSnapshot or bankDetails
    const bank = payslip.bankSnapshot || payslip.bankDetails || {};
    const salary = payslip.salary || {};
    
    // Format month name
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[payslip.month - 1] || `Month ${payslip.month}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Payslip - ${payslip.employee?.fullName || 'Employee'} - ${monthName} ${payslip.year}</title>
<style>
@page {
  size: A4;
  margin: 15mm;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 13px;
  color: #000;
  line-height: 1.4;
  background: #fff;
}

.page {
  width: 100%;
  max-width: 210mm;
  margin: 0 auto;
  padding: 20px;
}

.header {
  text-align: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 2px solid #1e40af;
}

.company-name {
  font-size: 24px;
  font-weight: bold;
  color: #1e40af;
  margin-bottom: 5px;
}

.payslip-title {
  font-size: 18px;
  font-weight: bold;
  color: #333;
  margin-bottom: 5px;
}

.payslip-period {
  font-size: 14px;
  color: #666;
  margin-bottom: 10px;
}

.section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 16px;
  font-weight: bold;
  color: #1e40af;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 1px solid #e2e8f0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 15px;
}

th, td {
  border: 1px solid #cbd5e1;
  padding: 10px;
  text-align: left;
}

th {
  background: #f1f5f9;
  font-weight: 600;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.info-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 15px;
}

.info-label {
  font-weight: 600;
  color: #475569;
  margin-bottom: 5px;
  font-size: 12px;
}

.info-value {
  font-size: 14px;
  color: #0f172a;
}

.salary-split {
  display: flex;
  gap: 20px;
  margin-bottom: 25px;
}

.earnings, .deductions {
  flex: 1;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 15px;
}

.sub-table {
  width: 100%;
  border: none;
}

.sub-table tr {
  border-bottom: 1px solid #e2e8f0;
}

.sub-table tr:last-child {
  border-bottom: none;
}

.sub-table td {
  border: none;
  padding: 8px 0;
}

.sub-table .total-row {
  border-top: 2px solid #cbd5e1;
  font-weight: bold;
}

.amount {
  text-align: right;
  font-weight: 500;
}

.net-pay {
  background: linear-gradient(135deg, #1e40af, #3b82f6);
  color: white;
  padding: 20px;
  border-radius: 10px;
  text-align: center;
  margin: 25px 0;
}

.net-pay-label {
  font-size: 14px;
  margin-bottom: 5px;
  opacity: 0.9;
}

.net-pay-amount {
  font-size: 28px;
  font-weight: bold;
  margin-bottom: 5px;
}

.net-pay-words {
  font-size: 12px;
  opacity: 0.9;
}

.footer {
  margin-top: 30px;
  padding-top: 15px;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  font-size: 11px;
  color: #64748b;
}

.company-address {
  font-weight: bold;
  color: #334155;
  margin-bottom: 5px;
}

.footer-note {
  font-style: italic;
  margin-top: 10px;
}
</style>
</head>

<body>
<div class="page">

  <div class="header">
    <div class="company-name">NOW IT SERVICES PVT LTD</div>
    <div class="payslip-title">SALARY SLIP</div>
    <div class="payslip-period">For the month of ${monthName} ${payslip.year}</div>
  </div>

  <div class="section">
    <div class="info-grid">
      <div class="info-card">
        <div class="info-label">Employee Name</div>
        <div class="info-value">${payslip.employee?.fullName || 'Employee'}</div>
      </div>
      <div class="info-card">
        <div class="info-label">Employee ID</div>
        <div class="info-value">${payslip.employeeId || 'N/A'}</div>
      </div>
      <div class="info-card">
        <div class="info-label">Designation</div>
        <div class="info-value">${payslip.employee?.designation || payslip.designation || 'Employee'}</div>
      </div>
      <div class="info-card">
        <div class="info-label">Working Days</div>
        <div class="info-value">${payslip.workingDays || 0} days</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Bank Details</div>
    <table>
      <tr>
        <th>Bank Name</th>
        <td>${bank.bankName || 'Not specified'}</td>
        <th>Account Number</th>
        <td>****${bank.accountNumber?.slice(-4) || 'XXXX'}</td>
      </tr>
      <tr>
        <th>IFSC Code</th>
        <td>${bank.ifsc || 'Not specified'}</td>
        <th>Branch</th>
        <td>${bank.branch || 'Not specified'}</td>
      </tr>
    </table>
  </div>

  <div class="salary-split">
    <div class="earnings">
      <div class="section-title">Earnings</div>
      <table class="sub-table">
        <tr>
          <td>Basic Salary</td>
          <td class="amount">₹${salary.basic?.toLocaleString() || '0'}</td>
        </tr>
        <tr>
          <td>House Rent Allowance (HRA)</td>
          <td class="amount">₹${salary.hra?.toLocaleString() || '0'}</td>
        </tr>
        <tr>
          <td>Conveyance Allowance</td>
          <td class="amount">₹${salary.conveyance?.toLocaleString() || '0'}</td>
        </tr>
        <tr>
          <td>Allowances</td>
          <td class="amount">₹${salary.allowances?.toLocaleString() || '0'}</td>
        </tr>
        <tr class="total-row">
          <td><strong>Total Earnings</strong></td>
          <td class="amount"><strong>₹${salary.gross?.toLocaleString() || '0'}</strong></td>
        </tr>
      </table>
    </div>

    <div class="deductions">
      <div class="section-title">Deductions</div>
      <table class="sub-table">
        <tr>
          <td>Provident Fund (PF)</td>
          <td class="amount">₹${salary.pf?.toLocaleString() || '0'}</td>
        </tr>
        <tr>
          <td>ESI Contribution</td>
          <td class="amount">₹${salary.esi?.toLocaleString() || '0'}</td>
        </tr>
        <tr>
          <td>Professional Tax</td>
          <td class="amount">₹${salary.professionalTax?.toLocaleString() || '0'}</td>
        </tr>
        <tr>
          <td>Income Tax (TDS)</td>
          <td class="amount">₹${salary.tds?.toLocaleString() || '0'}</td>
        </tr>
        <tr class="total-row">
          <td><strong>Total Deductions</strong></td>
          <td class="amount"><strong>₹${salary.deductions?.toLocaleString() || '0'}</strong></td>
        </tr>
      </table>
    </div>
  </div>

  <div class="net-pay">
    <div class="net-pay-label">NET PAYABLE</div>
    <div class="net-pay-amount">₹${salary.netPay?.toLocaleString() || '0'}</div>
    <div class="net-pay-words">${salary.netPay ? `Rupees ${convertNumberToWords(salary.netPay)} only` : 'Zero Rupees only'}</div>
  </div>

  <div class="footer">
    <div class="company-address">NOW IT SERVICES PVT LTD</div>
    <div>6-284-1, Uma Shankar Nagar, Revenue Ward -17, YSR Tadigadapa, 520007</div>
    <div>Phone: 7893536373 | Email: hr@nowitservices.com</div>
    <div class="footer-note">
      This is a computer generated payslip and does not require signature.
    </div>
    <div style="margin-top: 10px;">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</div>
  </div>

</div>

<script>
// Number to words conversion function
function convertNumberToWords(num) {
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  if (num === 0) return 'Zero';
  
  let words = '';
  
  if (Math.floor(num / 10000000) > 0) {
    words += convertNumberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  
  if (Math.floor(num / 100000) > 0) {
    words += convertNumberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  
  if (Math.floor(num / 1000) > 0) {
    words += convertNumberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  
  if (Math.floor(num / 100) > 0) {
    words += convertNumberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  
  if (num > 0) {
    if (words !== '') words += 'and ';
    
    if (num < 20) {
      words += a[num];
    } else {
      words += b[Math.floor(num / 10)];
      if (num % 10 > 0) {
        words += '-' + a[num % 10];
      }
    }
  }
  
  return words.trim() + ' Rupees';
}
</script>
</body>
</html>
`;

    // Send HTML for debugging
    if (req.query.debug) {
      return res.send(html);
    }

    // For PDF generation, you'll need Puppeteer
    // For now, let's return success message
    res.json({
      message: "Payslip found",
      payslip: {
        id: payslip._id,
        employee: payslip.employee?.fullName,
        month: payslip.month,
        year: payslip.year,
        netPay: salary.netPay
      },
      downloadUrl: `/api/payslips/${payslip._id}/pdf` // This would be your PDF endpoint
    });
    
  } catch (error) {
    console.error("❌ PDF error:", error);
    res.status(500).json({ 
      message: "Failed to download PDF", 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Helper function for number to words
function convertNumberToWords(num) {
  if (!num || isNaN(num)) return 'Zero';
  
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  if (num === 0) return 'Zero';
  
  let words = '';
  
  // Crores
  if (Math.floor(num / 10000000) > 0) {
    words += convertNumberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  
  // Lakhs
  if (Math.floor(num / 100000) > 0) {
    words += convertNumberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  
  // Thousands
  if (Math.floor(num / 1000) > 0) {
    words += convertNumberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  
  // Hundreds
  if (Math.floor(num / 100) > 0) {
    words += convertNumberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  
  if (num > 0) {
    if (words !== '') words += 'and ';
    
    if (num < 20) {
      words += a[num];
    } else {
      words += b[Math.floor(num / 10)];
      if (num % 10 > 0) {
        words += '-' + a[num % 10];
      }
    }
  }
  
  return words.trim() + ' Rupees';
}

export default router;
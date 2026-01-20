// routes/payslipManagementRoutes.js
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

/* ================= HELPER FUNCTIONS ================= */
const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

const formatCurrency = (amount) => {
  return "₹" + Number(amount || 0).toLocaleString("en-IN");
};

const convertNumberToWords = (num) => {
  if (num === 0) return 'Zero Rupees';

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = Math.floor((num % 1000) / 100);
  const tens = num % 100;

  let words = '';

  if (crore > 0) {
    words += convertNumberToWords(crore) + ' Crore ';
  }
  if (lakh > 0) {
    words += convertNumberToWords(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    words += convertNumberToWords(thousand) + ' Thousand ';
  }
  if (hundred > 0) {
    words += a[hundred] + ' Hundred ';
  }
  if (tens > 0) {
    if (tens < 20) {
      words += a[tens];
    } else {
      words += b[Math.floor(tens / 10)] + ' ' + a[tens % 10];
    }
  }

  return words.trim() + ' Rupees Only';
};

/* =====================================================
   CHECK IF PAYSLIP EXISTS
===================================================== */
router.get("/check/:employeeId/:month/:year", authMiddleware, async (req, res) => {
  try {
    const { employeeId, month, year } = req.params;

    const existingPayslip = await Payslip.findOne({
      employee: employeeId,
      month: parseInt(month),
      year: parseInt(year)
    });
    // ✅ AUTO DELETE OLD PAYSLIP BEFORE REGENERATE
if (existingPayslip) {
  await Payslip.deleteOne({ _id: existingPayslip._id });
}


    res.json({
      exists: !!existingPayslip,
      payslip: existingPayslip
    });
  } catch (err) {
    console.error("Check payslip error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =====================================================
   GENERATE / CREATE PAYSLIP
===================================================== */
router.post("/", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const {
      employeeId,
      month,
      year,
      workingDays,
      salary,
      // Note: bankDetails removed - we get from BankDetails model
    } = req.body;

    if (!employeeId || !month || !year || !salary) {
      return res.status(400).json({
        message: "employeeId, month, year and salary are required"
      });
    }

    // Check if employee exists and get details
    const employee = await User.findById(employeeId);

    console.log("EMPLOYEE FROM DB:", {
      id: employee._id,
      jobTitle: employee.jobTitle,
      employeeType: employee.employeeType || "Permanent",

    });

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found"
      });
    }

    // Get bank details from BankDetails model
    const bankDetails = await BankDetails.findOne({
      employee: employeeId
    });

    if (!bankDetails) {
      return res.status(400).json({
        message: "Bank details not found for employee. Please add bank details first."
      });
    }

    // Calculate gross and net pay
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

    // Check for existing payslip
    const existingPayslip = await Payslip.findOne({
      employee: employeeId,
      month: parseInt(month),
      year: parseInt(year)
    });
    // ✅ ALWAYS take latest values from User (single source of truth)
    const latestDesignation =
      employee.designation || employee.jobTitle || "Employee";

    const latestEmployeeType =
      employee.employeeType || "Permanent";

    let payslip;
    if (existingPayslip) {
      // Update existing payslip
      existingPayslip.workingDays = workingDays;
      existingPayslip.salary = {
        ...salary,
        gross,
        deductions,
        netPay
      };
      existingPayslip.bankSnapshot = {
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
        ifsc: bankDetails.ifsc,
        branch: bankDetails.branch,
        accountType: bankDetails.accountType
      };
      existingPayslip.designation =
        employee.designation || employee.jobTitle || "Employee";

      existingPayslip.employeeType =
        employee.employeeType || "Permanent";

      existingPayslip.version += 1;
      existingPayslip.updatedAt = new Date();

      payslip = await existingPayslip.save();
    } else {
      // Create new payslip
      payslip = await Payslip.create({
        employee: employeeId,
        employeeId: employee.employeeId,


        designation: employee.designation || employee.jobTitle || "N/A",
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
        createdBy: req.user.id,
        createdByName: req.user.fullName
      });

    }

    // Log the operation
    await Log.create({
      type: "OPERATION",
      action: existingPayslip ? "UPDATE_PAYSLIP" : "CREATE_PAYSLIP",
      entity: "PAYSLIP",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: `${existingPayslip ? 'Updated' : 'Generated'} payslip for ${employee.fullName} for ${month}/${year}`,
      status: "SUCCESS",
      ipAddress: getClientIp(req),
      details: {
        payslipId: payslip._id,
        employeeId: employee._id,
        employeeName: employee.fullName,
        month,
        year,
        netPay,
        version: payslip.version
      }
    });

    return res.status(existingPayslip ? 200 : 201).json({
      message: `Payslip ${existingPayslip ? 'updated' : 'generated'} successfully`,
      payslip
    });

  } catch (err) {
    /* ✅ DUPLICATE PAYSLIP HANDLING */
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Payslip already exists for this employee for this month"
      });
    }

    console.error("❌ Generate payslip error:", err);

    // Log error
    await Log.create({
      type: "ERROR",
      action: "PAYSLIP_GENERATION_ERROR",
      entity: "PAYSLIP",
      user: req.user?.id || null,
      userName: req.user?.fullName || "",
      userEmail: req.user?.email || "",
      role: req.user?.role || "",
      description: "Error generating payslip",
      status: "ERROR",
      ipAddress: getClientIp(req),
      details: { errorMessage: err.message }
    });

    return res.status(500).json({
      message: "Failed to generate payslip"
    });
  }
});

/* =====================================================
   SEND PAYSLIP TO EMPLOYEE AND ADMIN
===================================================== */
router.post("/:id/send", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email jobTitle");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Update payslip status
    payslip.status = "sent";
    payslip.sentToEmployee = true;
    payslip.sentToEmployeeAt = new Date();
    payslip.sentToAdmin = true;
    payslip.sentToAdminAt = new Date();
    await payslip.save();

    // Log the distribution
    await Log.create({
      type: "OPERATION",
      action: "SEND_PAYSLIP",
      entity: "PAYSLIP",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: `Sent payslip to ${payslip.employee.fullName} and admin for ${payslip.month}/${payslip.year}`,
      status: "SUCCESS",
      ipAddress: getClientIp(req),
      details: {
        payslipId: payslip._id,
        employeeId: payslip.employee._id,
        employeeEmail: payslip.employee.email,
        month: payslip.month,
        year: payslip.year
      }
    });

    // TODO: Implement actual email sending here
    // You would typically:
    // 1. Send email to employee with payslip attachment
    // 2. Send notification to admin
    // 3. Maybe send SMS notification

    res.json({
      message: "Payslip sent to employee and admin successfully",
      payslip
    });

  } catch (err) {
    console.error("Send payslip error:", err);
    res.status(500).json({ message: "Failed to send payslip" });
  }
});

/* =====================================================
   GET EMPLOYEE'S PAYSLIPS
===================================================== */
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const payslips = await Payslip.find({
      employee: req.user.id
    })
      .sort({ year: -1, month: -1 })
      .lean();

    // Format response
    const formattedPayslips = payslips.map(payslip => ({
      ...payslip,
      monthName: new Date(payslip.year, payslip.month - 1).toLocaleString('default', { month: 'long' }),
      formattedNetPay: formatCurrency(payslip.salary.netPay),
      downloadUrl: `/api/payslips/${payslip._id}/download`
    }));

    res.json(formattedPayslips);
  } catch (err) {
    console.error("Get employee payslips error:", err);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   GET ALL PAYSLIPS (Manager/Admin)
===================================================== */
router.get("/", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const { month, year, employeeId, status } = req.query;

    const filter = {};

    if (month) filter.month = parseInt(month);
    if (year) filter.year = parseInt(year);
    if (employeeId) filter.employee = employeeId;
    if (status) filter.status = status;

    const payslips = await Payslip.find(filter)
      .populate("employee", "fullName email jobTitle employeeId")
      .sort({ year: -1, month: -1, createdAt: -1 })
      .lean();

    res.json(payslips);
  } catch (err) {
    console.error("Get all payslips error:", err);
    res.status(500).json({ message: "Failed to fetch payslips" });
  }
});

/* =====================================================
   DOWNLOAD PAYSLIP PDF (WITH COMPANY LOGO)
===================================================== */
router.get("/:id/download", authMiddleware, async (req, res) => {
  let browser;

  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email jobTitle employeeId");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Check if employee is downloading their own payslip
    if (req.user.role === "employee" && req.user.id !== payslip.employee._id.toString()) {
      return res.status(403).json({
        message: "You can only download your own payslip"
      });
    }

    /* ================= LOGO ================= */
    const logoPath = path.join(__dirname, "../assets/company-logo.jpg");
    let logoSrc = "";

    if (fs.existsSync(logoPath)) {
      const logoBase64 = fs.readFileSync(logoPath, "base64");
      logoSrc = `data:image/jpeg;base64,${logoBase64}`;
    }

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

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
  ${logoSrc ? `<img src="${logoSrc}" class="logo"/>` : ''}
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
  <th>Designation</th>
<td>${payslip.employee.designation || "N/A"}</td>
</tr>
<tr>
  <th>Working Days</th><td>${payslip.workingDays} days</td>
  <th>Employee status</th>
<td>${payslip.employee.status || "N/A"}</td>

</table>

<div class="section">Bank Details</div>
<table>
<tr>
  <th>Bank Name</th><td>${payslip.bankSnapshot?.bankName || ""}</td>
  <th>Account Number</th>
  <td>****${String(payslip.bankSnapshot?.accountNumber || "").slice(-4)}</td>
</tr>
<tr>
  <th>IFSC Code</th><td>${payslip.bankSnapshot?.ifsc || ""}</td>
  <th>Branch</th><td>${payslip.bankSnapshot?.branch || ""}</td>
</tr>
<tr>
  <th>Account Type</th><td>${payslip.bankSnapshot?.accountType || "Savings"}</td>
  <th>Payment Status</th><td>Processed</td>
</tr>
</table>

<div class="flex">
<table>
<tr><th colspan="2">Earnings</th></tr>
<tr><td>Basic Pay</td><td class="amount">${formatCurrency(payslip.salary.basic)}</td></tr>
<tr><td>HRA</td><td class="amount">${formatCurrency(payslip.salary.hra)}</td></tr>
<tr><td>Conveyance</td><td class="amount">${formatCurrency(payslip.salary.conveyance)}</td></tr>
<tr><td>Travel Allowance</td><td class="amount">${formatCurrency(payslip.salary.travelAllowance)}</td></tr>
<tr><td>Medical Allowance</td><td class="amount">${formatCurrency(payslip.salary.medicalAllowance)}</td></tr>
<tr><td>Special Allowance</td><td class="amount">${formatCurrency(payslip.salary.specialAllowance)}</td></tr>
<tr><th>Total Earnings</th><th class="amount">${formatCurrency(payslip.salary.gross)}</th></tr>
</table>

<table>
<tr><th colspan="2">Deductions</th></tr>
<tr><td>PF</td><td class="amount">${formatCurrency(payslip.salary.pf)}</td></tr>
<tr><td>ESI</td><td class="amount">${formatCurrency(payslip.salary.esi)}</td></tr>
<tr><td>Professional Tax</td><td class="amount">${formatCurrency(payslip.salary.professionalTax)}</td></tr>
<tr><td>Income Tax</td><td class="amount">${formatCurrency(payslip.salary.tds)}</td></tr>
<tr><th>Total Deductions</th><th class="amount">${formatCurrency(payslip.salary.deductions)}</th></tr>
</table>
</div>

<div class="netpay">
  NET PAYABLE AMOUNT<br/>
  ${formatCurrency(payslip.salary.netPay)} only<br/>
  <small>(${convertNumberToWords(payslip.salary.netPay)})</small>
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
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
    });

    await browser.close();

    // Update download tracking if employee is downloading
    if (req.user.role === "employee") {
      payslip.downloadedByEmployee = true;
      payslip.downloadedByEmployeeAt = new Date();
      payslip.status = "downloaded";
      await payslip.save();

      // Log the download
      await Log.create({
        type: "OPERATION",
        action: "DOWNLOAD_PAYSLIP",
        entity: "PAYSLIP",
        user: req.user.id,
        userName: req.user.fullName,
        userEmail: req.user.email,
        role: req.user.role,
        description: `Downloaded payslip for ${monthNames[payslip.month - 1]} ${payslip.year}`,
        status: "SUCCESS",
        ipAddress: getClientIp(req),
        details: {
          payslipId: payslip._id,
          month: payslip.month,
          year: payslip.year,
          netPay: payslip.salary.netPay
        }
      });
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Payslip-${payslip.employee.fullName}-${monthNames[payslip.month - 1]}-${payslip.year}.pdf"`,
      "Content-Length": pdf.length
    });

    return res.end(pdf);

  } catch (err) {
    if (browser) await browser.close();
    console.error("❌ PDF error:", err);

    // Log error
    await Log.create({
      type: "ERROR",
      action: "PDF_GENERATION_ERROR",
      entity: "PAYSLIP",
      user: req.user?.id || null,
      userName: req.user?.fullName || "",
      userEmail: req.user?.email || "",
      role: req.user?.role || "",
      description: "Error generating PDF",
      status: "ERROR",
      ipAddress: getClientIp(req),
      details: { errorMessage: err.message }
    });

    res.status(500).json({ message: "PDF generation failed" });
  }
});

/* =====================================================
   GET PAYSLIP BY ID
===================================================== */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id)
      .populate("employee", "fullName email jobTitle employeeId")
      .populate("createdBy", "fullName email");

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Check permissions
    if (req.user.role === "employee" && req.user.id !== payslip.employee._id.toString()) {
      return res.status(403).json({
        message: "You can only view your own payslip"
      });
    }

    res.json(payslip);
  } catch (err) {
    console.error("Get payslip error:", err);
    res.status(500).json({ message: "Failed to fetch payslip" });
  }
});

/* =====================================================
   UPDATE PAYSLIP STATUS (Viewed)
===================================================== */
router.patch("/:id/view", authMiddleware, async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id);

    if (!payslip) {
      return res.status(404).json({ message: "Payslip not found" });
    }

    // Only employee can mark as viewed
    if (req.user.role === "employee" && req.user.id === payslip.employee.toString()) {
      payslip.viewedByEmployee = true;
      payslip.viewedByEmployeeAt = new Date();
      payslip.status = "viewed";
      await payslip.save();
    }

    res.json({ message: "Payslip marked as viewed", payslip });
  } catch (err) {
    console.error("Update payslip view status error:", err);
    res.status(500).json({ message: "Failed to update payslip status" });
  }
});

export default router;
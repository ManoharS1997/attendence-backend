// routes/bankRoutes.js
import express from "express";
import BankDetails from "../models/BankDetails.js";
import BankHistory from "../models/BankHistory.js";
import User from "../models/User.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import Log from "../models/Log.js";

const router = express.Router();

// Helper function to get client IP
const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
};

/**
 * GET /api/bank/:employeeId
 * Get bank details for an employee
 */
router.get("/:employeeId", authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    // Check if user has permission
    if (req.user.role === "employee" && req.user.id !== employeeId) {
      return res.status(403).json({ 
        message: "You can only view your own bank details" 
      });
    }
    
    const bankDetails = await BankDetails.findOne({ 
      employee: employeeId 
    }).populate("verifiedBy", "fullName email");
    
    if (!bankDetails) {
      return res.status(404).json({ 
        message: "Bank details not found" 
      });
    }
    
    // Mask account number for non-manager/admin roles
    if (req.user.role === "employee") {
      bankDetails.accountNumber = `****${bankDetails.accountNumber.slice(-4)}`;
    }
    
    res.json(bankDetails);
  } catch (err) {
    console.error("Get bank details error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/bank/:employeeId
 * Create or update bank details (Manager/Admin only)
 */
router.post("/:employeeId", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { 
      bankName, 
      accountNumber, 
      ifsc, 
      branch, 
      accountType, 
      notes, 
      reason 
    } = req.body;
    
    // Validate required fields
    if (!bankName || !accountNumber || !ifsc || !branch) {
      return res.status(400).json({ 
        message: "bankName, accountNumber, ifsc, and branch are required" 
      });
    }
    
    // Validate IFSC format
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifsc.toUpperCase())) {
      return res.status(400).json({ 
        message: "Invalid IFSC code format. Format: ABCD0123456" 
      });
    }
    
    // Validate account number length
    if (accountNumber.length < 9 || accountNumber.length > 18) {
      return res.status(400).json({ 
        message: "Account number must be between 9 and 18 digits" 
      });
    }
    
    // Check if employee exists
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ 
        message: "Employee not found" 
      });
    }
    
    // Get existing bank details for history
    const existingBankDetails = await BankDetails.findOne({ 
      employee: employeeId 
    });
    
    // Prepare update data
    const updateData = {
      employee: employeeId,
      bankName,
      accountNumber,
      ifsc: ifsc.toUpperCase(),
      branch,
      accountType: accountType || "Savings",
      notes: notes || "",
      verified: false
    };
    
    // Create or update bank details
    let bankDetails;
    if (existingBankDetails) {
      // Create history entry for update
      await BankHistory.create({
        employee: employeeId,
        previousBankName: existingBankDetails.bankName,
        previousAccountNumber: existingBankDetails.accountNumber,
        previousIfsc: existingBankDetails.ifsc,
        previousBranch: existingBankDetails.branch,
        previousAccountType: existingBankDetails.accountType,
        newBankName: bankName,
        newAccountNumber: accountNumber,
        newIfsc: ifsc.toUpperCase(),
        newBranch: branch,
        newAccountType: accountType || "Savings",
        changedBy: req.user.id,
        changedByName: req.user.fullName,
        changedByRole: req.user.role,
        reason: reason || "Bank details updated by manager",
        changeType: "UPDATE",
        ipAddress: getClientIp(req)
      });
      
      // Update existing record
      bankDetails = await BankDetails.findOneAndUpdate(
        { employee: employeeId },
        updateData,
        { new: true, runValidators: true }
      );
    } else {
      // Create new bank details
      bankDetails = await BankDetails.create(updateData);
      
      // Create history entry for creation
      await BankHistory.create({
        employee: employeeId,
        newBankName: bankName,
        newAccountNumber: accountNumber,
        newIfsc: ifsc.toUpperCase(),
        newBranch: branch,
        newAccountType: accountType || "Savings",
        changedBy: req.user.id,
        changedByName: req.user.fullName,
        changedByRole: req.user.role,
        reason: reason || "Initial bank details setup",
        changeType: "CREATE",
        ipAddress: getClientIp(req)
      });
    }
    
    // Log the operation
    await Log.create({
      type: "OPERATION",
      action: existingBankDetails ? "UPDATE_BANK_DETAILS" : "CREATE_BANK_DETAILS",
      entity: "BANK",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: `${existingBankDetails ? 'Updated' : 'Created'} bank details for ${employee.fullName} (${employee.email})`,
      status: "SUCCESS",
      ipAddress: getClientIp(req),
      details: {
        employeeId: employee._id,
        employeeEmail: employee.email,
        bankName,
        accountNumber: `****${accountNumber.slice(-4)}`,
        ifsc: ifsc.toUpperCase(),
        changeType: existingBankDetails ? "UPDATE" : "CREATE"
      }
    });
    
    res.json({
      message: `Bank details ${existingBankDetails ? 'updated' : 'created'} successfully`,
      bankDetails: {
        ...bankDetails.toObject(),
        accountNumber: `****${accountNumber.slice(-4)}`
      }
    });
  } catch (err) {
    console.error("Update bank details error:", err);
    
    // Log error
    await Log.create({
      type: "ERROR",
      action: "BANK_DETAILS_ERROR",
      entity: "BANK",
      user: req.user?.id || null,
      userName: req.user?.fullName || "",
      userEmail: req.user?.email || "",
      role: req.user?.role || "",
      description: "Error updating bank details",
      status: "ERROR",
      ipAddress: getClientIp(req),
      details: { errorMessage: err.message }
    });
    
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/bank/:employeeId/history
 * Get bank details change history
 */
router.get("/:employeeId/history", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const history = await BankHistory.find({ 
      employee: employeeId 
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate("changedBy", "fullName email role")
    .lean();
    
    // Mask account numbers in history
    const maskedHistory = history.map(record => ({
      ...record,
      previousAccountNumber: record.previousAccountNumber 
        ? `****${record.previousAccountNumber.slice(-4)}`
        : null,
      newAccountNumber: record.newAccountNumber 
        ? `****${record.newAccountNumber.slice(-4)}`
        : null
    }));
    
    const total = await BankHistory.countDocuments({ employee: employeeId });
    
    res.json({
      history: maskedHistory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error("Get bank history error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/bank/:employeeId/verify
 * Verify bank details (Manager/Admin only)
 */
router.post("/:employeeId/verify", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { notes } = req.body;
    
    const bankDetails = await BankDetails.findOne({ employee: employeeId });
    
    if (!bankDetails) {
      return res.status(404).json({ 
        message: "Bank details not found" 
      });
    }
    
    // Update verification status
    bankDetails.verified = true;
    bankDetails.verifiedBy = req.user.id;
    bankDetails.verifiedAt = new Date();
    bankDetails.notes = notes || bankDetails.notes;
    
    await bankDetails.save();
    
    // Create history entry
    await BankHistory.create({
      employee: employeeId,
      previousBankName: bankDetails.bankName,
      previousAccountNumber: bankDetails.accountNumber,
      previousIfsc: bankDetails.ifsc,
      previousBranch: bankDetails.branch,
      previousAccountType: bankDetails.accountType,
      newBankName: bankDetails.bankName,
      newAccountNumber: bankDetails.accountNumber,
      newIfsc: bankDetails.ifsc,
      newBranch: bankDetails.branch,
      newAccountType: bankDetails.accountType,
      changedBy: req.user.id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      reason: "Bank details verified",
      changeType: "VERIFY",
      ipAddress: getClientIp(req),
      metadata: { notes }
    });
    
    // Log the operation
    await Log.create({
      type: "OPERATION",
      action: "VERIFY_BANK_DETAILS",
      entity: "BANK",
      user: req.user.id,
      userName: req.user.fullName,
      userEmail: req.user.email,
      role: req.user.role,
      description: `Verified bank details for employee ${employeeId}`,
      status: "SUCCESS",
      ipAddress: getClientIp(req),
      details: {
        employeeId,
        verifiedBy: req.user.id,
        verifiedAt: new Date()
      }
    });
    
    res.json({
      message: "Bank details verified successfully",
      bankDetails
    });
  } catch (err) {
    console.error("Verify bank details error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/bank/list/employees
 * Get all employees with their bank details
 */
router.get("/list/employees", authMiddleware, requireRole(["manager", "admin"]), async (req, res) => {
  try {
    const employees = await User.find({ 
      role: "employee",
      isActive: true 
    })
    .select("_id employeeId fullName email jobTitle designation isActive")
    .lean();
    
    // Get bank details for each employee
    const employeesWithBankDetails = await Promise.all(
      employees.map(async (employee) => {
        const bankDetails = await BankDetails.findOne({ 
          employee: employee._id 
        }).lean();
        
        return {
          ...employee,
          bankDetails: bankDetails ? {
            bankName: bankDetails.bankName,
            accountNumber: `****${bankDetails.accountNumber.slice(-4)}`,
            ifsc: bankDetails.ifsc,
            branch: bankDetails.branch,
            accountType: bankDetails.accountType,
            verified: bankDetails.verified,
            verifiedAt: bankDetails.verifiedAt,
            hasBankDetails: true
          } : {
            hasBankDetails: false
          }
        };
      })
    );
    
    res.json(employeesWithBankDetails);
  } catch (err) {
    console.error("List employees with bank details error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
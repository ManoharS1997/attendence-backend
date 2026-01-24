// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Core auth middleware
export const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ 
      message: "No authentication token provided. Please login." 
    });
  }

  const token = header.split(" ")[1];

  // Check token length (basic validation)
  if (token.length < 50) {
    return res.status(401).json({ 
      message: "Invalid token format" 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Additional security: Check token expiration is in the future
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({
        message: "Session expired. Please login again."
      });
    }

    const user = await User.findById(decoded.id)
      .select("_id role email fullName isActive lastLogin");

    if (!user) {
      return res.status(401).json({ 
        message: "User account not found" 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        message: "Your account has been deactivated. Please contact administrator." 
      });
    }

    // Normalize role to lowercase for consistency
    const role = user.role.toLowerCase();

    req.user = {
      id: user._id.toString(),
      _id: user._id,
      role,
      email: user.email,
      fullName: user.fullName || user.email,
      isManager: ["manager", "admin"].includes(role),
      isEmployee: role === "employee",
      lastLogin: user.lastLogin,
    };

    // Log successful authentication (optional)
    if (process.env.NODE_ENV === "development") {
      console.log(`Auth: ${user.email} (${role}) accessing ${req.method} ${req.path}`);
    }

    next();
  } catch (err) {
    // Handle specific JWT errors
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Session expired. Please login again.",
        code: "TOKEN_EXPIRED"
      });
    }

    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Invalid authentication token.",
        code: "INVALID_TOKEN"
      });
    }

    console.error("Auth middleware error:", err);
    return res.status(500).json({ 
      message: "Authentication failed",
      code: "AUTH_ERROR"
    });
  }
};

// Alias for compatibility
export const protect = authMiddleware;

// Role-based authorization
export const requireRole = (roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      message: "Authentication required" 
    });
  }

  // Normalize roles to lowercase for comparison
  const normalizedRoles = roles.map(r => r.toLowerCase());
  
  if (!normalizedRoles.includes(req.user.role)) {
    return res.status(403).json({ 
      message: "You do not have permission to perform this action",
      requiredRoles: roles,
      yourRole: req.user.role 
    });
  }
  
  next();
};

// Specific role helpers
export const requireManager = requireRole(["manager", "admin"]);
export const requireAdmin = requireRole(["admin"]);
export const requireEmployee = requireRole(["employee"]);
export const requireManagerOrAdmin = requireRole(["manager", "admin"]);

// Department-specific middleware (if needed later)
export const requireDepartment = (department) => (req, res, next) => {
  if (!req.user || !req.user.department) {
    return res.status(403).json({ 
      message: "Department access required" 
    });
  }
  
  if (req.user.department !== department) {
    return res.status(403).json({ 
      message: `Access restricted to ${department} department` 
    });
  }
  
  next();
};

// Ownership middleware - check if user owns the resource
export const requireOwnership = (resourceIdField = "userId") => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      message: "Authentication required" 
    });
  }

  // For employee role, check if they own the resource
  if (req.user.role === "employee") {
    const resourceUserId = req.params[resourceIdField] || req.body[resourceIdField];
    
    if (resourceUserId && resourceUserId !== req.user.id) {
      return res.status(403).json({ 
        message: "You can only access your own resources" 
      });
    }
  }
  
  next();
};
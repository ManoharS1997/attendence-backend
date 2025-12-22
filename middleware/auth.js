// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Core auth middleware
export const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = {
      id: user._id.toString(),
      _id: user._id.toString(),
      role: user.role,
      email: user.email,
      fullName: user.fullName || user.email,
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Session expired. Please login again."
      });
    }

    console.error("Auth middleware error:", err);
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const protect = authMiddleware;

export const requireRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};

export const requireManager = requireRole(["manager", "admin"]);

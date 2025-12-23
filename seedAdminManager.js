// seedAdminManager.js
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import connectDB from "./config/db.js";
import User from "./models/User.js";

/**
 * DEFAULT ADMIN & MANAGER ACCOUNTS
 */
const DEFAULTS = {
  admin: {
    employeeId: "ADMIN-001",
    email: "admin@nowitservices.com",
    password: "Admin@123",
    fullName: "Admin",
    role: "admin",
  },
  manager: {
    employeeId: "MGR-001",
    email: "manager@nowitservices.com",
    password: "Manager@123",
    fullName: "Manager",
    role: "manager",
  },
  manager2: {
    employeeId: "MGR-002",
    email: "manager2@nowitservices.com",
    password: "Manager@124",
    fullName: "Manager 2",
    role: "manager",
  },
};

const hashPassword = async (plainPassword) => {
  const saltRounds = 10;
  return bcrypt.hash(plainPassword, saltRounds);
};

const seed = async () => {
  console.log("🔄 Connecting to MongoDB...");
  await connectDB();

  try {
    /**
     * ================= ADMIN =================
     */
    let admin = await User.findOne({ email: DEFAULTS.admin.email });
    if (!admin) {
      console.log("➕ Creating admin account...");

      admin = await User.create({
        employeeId: DEFAULTS.admin.employeeId,
        email: DEFAULTS.admin.email,
        passwordHash: await hashPassword(DEFAULTS.admin.password),
        fullName: DEFAULTS.admin.fullName,
        role: DEFAULTS.admin.role,
        isActive: true,
      });

      console.log("✅ Admin created:", admin.email);
    } else {
      console.log("ℹ️ Admin already exists:", admin.email);
    }

    /**
     * ================= MANAGER =================
     */
    let manager = await User.findOne({ email: DEFAULTS.manager.email });
    if (!manager) {
      console.log("➕ Creating manager account...");

      manager = await User.create({
        employeeId: DEFAULTS.manager.employeeId,
        email: DEFAULTS.manager.email,
        passwordHash: await hashPassword(DEFAULTS.manager.password),
        fullName: DEFAULTS.manager.fullName,
        role: DEFAULTS.manager.role,
        isActive: true,
      });

      console.log("✅ Manager created:", manager.email);
    } else {
      console.log("ℹ️ Manager already exists:", manager.email);
    }

    /**
     * ================= SECOND MANAGER =================
     */
    let manager2 = await User.findOne({ email: DEFAULTS.manager2.email });
    if (!manager2) {
      console.log("➕ Creating second manager account...");

      manager2 = await User.create({
        employeeId: DEFAULTS.manager2.employeeId,
        email: DEFAULTS.manager2.email,
        passwordHash: await hashPassword(DEFAULTS.manager2.password),
        fullName: DEFAULTS.manager2.fullName,
        role: DEFAULTS.manager2.role,
        isActive: true,
      });

      console.log("✅ Second manager created:", manager2.email);
    } else {
      console.log("ℹ️ Second manager already exists:", manager2.email);
    }

    console.log("🎉 Seeding completed successfully");
  } catch (err) {
    console.error("❌ Error seeding admin/manager:", err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seed();

// seedAdminManager.js
import mongoose from "mongoose";
import bcrypt from "bcrypt";              // ⬅️ add this
import connectDB from "./config/db.js";
import User from "./models/User.js";

// ADMIN + MANAGER default credentials
const DEFAULTS = {
  admin: {
    email: "admin@nowitservices.com",
    password: "Admin@123",
    fullName: "Admin",
    role: "admin",
  },
  manager: {
    email: "manager@nowitservices.com",
    password: "Manager@123",
    fullName: "Manager",
    role: "manager",
  },
   manager2: {
    email: "manager2@nowitservices.com",   // 👈 NEW manager login
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
    // ---------- ADMIN ----------
    let admin = await User.findOne({ email: DEFAULTS.admin.email });
    if (!admin) {
      console.log("➕ Creating admin account...");

      const adminPasswordHash = await hashPassword(DEFAULTS.admin.password);

      admin = await User.create({
        email: DEFAULTS.admin.email,
        passwordHash: adminPasswordHash,     // ⬅️ satisfy schema
        fullName: DEFAULTS.admin.fullName,
        role: DEFAULTS.admin.role,
      });

      console.log("✅ Admin created:", admin.email);
    } else {
      console.log("ℹ️ Admin already exists:", admin.email);
    }

    // ---------- MANAGER ----------
    let manager = await User.findOne({ email: DEFAULTS.manager.email });
    if (!manager) {
      console.log("➕ Creating manager account...");

      const managerPasswordHash = await hashPassword(DEFAULTS.manager.password);

      manager = await User.create({
        email: DEFAULTS.manager.email,
        passwordHash: managerPasswordHash,   // ⬅️ satisfy schema
        fullName: DEFAULTS.manager.fullName,
        role: DEFAULTS.manager.role,
      });

      console.log("✅ Manager created:", manager.email);
    } else {
      console.log("ℹ️ Manager already exists:", manager.email);
    }
    // ---------- SECOND MANAGER ----------
    let manager2 = await User.findOne({ email: DEFAULTS.manager2.email });
    if (!manager2) {
      console.log("➕ Creating second manager account...");

      const manager2PasswordHash = await hashPassword(DEFAULTS.manager2.password);

      manager2 = await User.create({
        email: DEFAULTS.manager2.email,
        passwordHash: manager2PasswordHash,
        fullName: DEFAULTS.manager2.fullName,
        role: DEFAULTS.manager2.role,
      });

      console.log("✅ Second manager created:", manager2.email);
    } else {
      console.log("ℹ️ Second manager already exists:", manager2.email);
    }

    console.log("🎉 Seeding complete");
  } catch (err) {
    console.error("❌ Error seeding admin/manager:", err);
  }

  mongoose.connection.close();
  process.exit(0);
};

seed();

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import connectDB from "./config/db.js";
import User from "./models/User.js";

/**
 * DEFAULT ADMIN & MANAGER ACCOUNTS
 * Centralized configuration for all seed users
 */
const DEFAULT_ACCOUNTS = {
  admin: {
    employeeId: "ADMIN-001",
    email: "admin@nowitservices.com",
    password: "Admin@123",
    fullName: "System Administrator",
    role: "admin",
    designation: "System Admin",
  },
  hr: {
    employeeId: "HR-001",
    email: "hr@nowitservices.com",
    password: "Hr@123",
    fullName: "HR Manager",
    role: "manager",
    designation: "HR Manager",
  },
  manager2: {
    employeeId: "MGR-002",
    email: "manager2@nowitservices.com",
    password: "Manager@124",
    fullName: "Department Manager",
    role: "manager",
    designation: "Team Lead",
  },
};

/**
 * Hash password helper
 */
const hashPassword = async (plainPassword) => {
  const saltRounds = 10;
  return bcrypt.hash(plainPassword, saltRounds);
};

/**
 * Create or update a user account
 */
const createOrUpdateUser = async (userData) => {
  try {
    const { email, role, ...userInfo } = userData;
    
    // Check if user exists
    const existingUser = await User.findOne({ email, role });
    
    if (!existingUser) {
      // Create new user
      const newUser = await User.create({
        ...userInfo,
        email,
        role,
        passwordHash: await hashPassword(userInfo.password),
        mustChangePassword: false,
        isActive: true,
        createdAt: new Date(),
      });
      console.log(`✅ Created ${role} account: ${email}`);
      return { created: true, user: newUser };
    } else {
      // Update existing user if needed
      const updates = {};
      let needsUpdate = false;
      
      // Check for fields that might need updating
      for (const [key, value] of Object.entries(userInfo)) {
        if (key !== 'password' && existingUser[key] !== value) {
          updates[key] = value;
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        await User.findByIdAndUpdate(existingUser._id, updates);
        console.log(`🔄 Updated ${role} account: ${email}`);
      } else {
        console.log(`ℹ️ ${role} account already exists: ${email}`);
      }
      
      return { created: false, user: existingUser, updated: needsUpdate };
    }
  } catch (error) {
    console.error(`❌ Error processing ${userData.email}:`, error.message);
    throw error;
  }
};

/**
 * Main seeding function - standalone script version
 */
export const seedAllAccounts = async () => {
  console.log("🔄 Starting account seeding process...");
  
  try {
    // Connect to database
    await connectDB();
    
    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
    };
    
    // Seed all accounts
    for (const [accountType, accountData] of Object.entries(DEFAULT_ACCOUNTS)) {
      const result = await createOrUpdateUser(accountData);
      
      if (result.created) results.created++;
      else if (result.updated) results.updated++;
      else results.skipped++;
    }
    
    // Summary
    console.log("\n🎉 Seeding completed!");
    console.log("📊 Summary:");
    console.log(`   Created: ${results.created}`);
    console.log(`   Updated: ${results.updated}`);
    console.log(`   Skipped: ${results.skipped}`);
    
    return results;
  } catch (err) {
    console.error("❌ Error seeding accounts:", err);
    throw err;
  }
};

/**
 * Specific HR seeding function for use in other files
 */
export const seedHRAccount = async () => {
  try {
    const hrAccount = DEFAULT_ACCOUNTS.hr;
    console.log(`🔄 Seeding HR account: ${hrAccount.email}`);
    
    const result = await createOrUpdateUser(hrAccount);
    
    if (result.created) {
      console.log("✅ HR Manager account created successfully");
    } else if (result.updated) {
      console.log("✅ HR Manager account updated successfully");
    } else {
      console.log("ℹ️ HR Manager account already exists");
    }
    
    return result;
  } catch (err) {
    console.error("❌ HR seed error:", err.message);
    throw err;
  }
};

/**
 * Run as standalone script
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const runSeed = async () => {
    try {
      await seedAllAccounts();
    } catch (err) {
      console.error("Failed to seed accounts:", err);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
      process.exit(0);
    }
  };
  
  runSeed();
}
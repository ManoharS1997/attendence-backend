// utils/generateEmployeeId.js
import User from "../models/User.js";

export async function generateEmployeeId() {
  try {
    // Find the highest employee ID
    const lastUser = await User.findOne({ 
      employeeId: { $regex: /^EMP\d+$/ } 
    })
    .sort({ employeeId: -1 }) // Sort by employeeId descending
    .exec();
    
    if (lastUser && lastUser.employeeId) {
      // Extract number from EMP001 format
      const match = lastUser.employeeId.match(/EMP(\d+)/);
      if (match && match[1]) {
        const lastNum = parseInt(match[1], 10);
        return `EMP${String(lastNum + 1).padStart(3, "0")}`;
      }
    }
    
    // If no employee found or pattern doesn't match, start from EMP001
    return "EMP001";
    
  } catch (error) {
    console.error("Error generating employee ID:", error);
    // Fallback: count users
    try {
      const count = await User.countDocuments();
      return `EMP${String(count + 1).padStart(3, "0")}`;
    } catch (countError) {
      // Final fallback based on timestamp
      const timestamp = Date.now().toString().slice(-6);
      return `EMP${timestamp}`;
    }
  }
}
import User from "../models/User.js";

export async function generateEmployeeId() {
  const count = await User.countDocuments();
  return `EMP${String(count + 1).padStart(4, "0")}`;
}

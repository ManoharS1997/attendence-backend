import express from "express";
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import { generateEmployeeId } from "../utils/generateEmployeeId.js";

const router = express.Router();

router.post("/create", async (req, res) => {
  const { fullName, email, password, role, designation } = req.body;

  const employeeId = await generateEmployeeId();
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    employeeId,
    fullName,
    email,
    passwordHash,
    role,
    designation
  });

  res.json(user);
});

export default router;

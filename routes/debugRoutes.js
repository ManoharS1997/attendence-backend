// routes/debugRoutes.js (temporary)
import express from "express";
import User from "../models/User.js";
const router = express.Router();

router.get("/find-user", async (req, res) => {
  const ident = req.query.ident;
  if (!ident) return res.status(400).json({ message: "Provide ident query param" });

  const candidates = [
    { employeeCode: ident },
    { employeeId: ident },
    { email: ident },
    { username: ident },
    { fullName: ident },
  ];

  const results = {};
  for (const q of candidates) {
    results[Object.keys(q)[0]] = await User.findOne(q).select("_id employeeCode employeeId email username fullName").lean();
  }

  // also try regex search on employeeCode/email
  const regexMatch = await User.findOne({
    $or: [{ employeeCode: new RegExp(`^${ident}$`, "i") }, { email: new RegExp(`^${ident}$`, "i") }],
  }).select("_id employeeCode email").lean();

  results.regex = regexMatch || null;
  res.json(results);
});

export default router;

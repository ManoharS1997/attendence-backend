import express from "express";
import Payslip from "../models/Payslip.js";
import BankHistory from "../models/BankHistory.js";
import { calculateWorkingDays } from "../utils/workingDays.js";

const router = express.Router();

router.get("/working-days", async (req, res) => {
  const { year, month } = req.query;

  // TODO: fetch from holidays collection
  const publicHolidays = [];
  const optionalTaken = [];

  const days = calculateWorkingDays(
    Number(year),
    Number(month),
    publicHolidays,
    optionalTaken
  );

  res.json({ workingDays: days });
});

router.post("/create", async (req, res) => {
  const { bankSnapshot, employee, createdBy } = req.body;

  await BankHistory.create({
    userId: employee,
    ...bankSnapshot,
    changedBy: createdBy
  });

  const payslip = await Payslip.create(req.body);
  res.json(payslip);
});

export default router;

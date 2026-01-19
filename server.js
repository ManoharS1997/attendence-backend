import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

// 🔁 Background Jobs
import logArchiveJob from "./jobs/logArchiveJob.js";
import birthdayReminderJob from "./jobs/birthdayReminderJob.js";

// ===================== ROUTES =====================
import authRoutes from "./routes/authRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import logRoutes from "./routes/logRoutes.js";
import holidayRoutes from "./routes/holidayRoutes.js";
import payslipRoutes from "./routes/payslipManagementRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
import utilityRoutes from "./routes/utilityRoutes.js";
import birthdayRoutes from "./routes/birthdayRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// ===================== CORS CONFIG =====================
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://44.217.109.241:5173"
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.options("*", cors());

// ===================== BODY PARSERS =====================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ===================== HEALTH CHECK =====================
app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP" });
});

// ===================== ROOT =====================
app.get("/", (req, res) => {
  res.send("🚀 Attendance & Payslip API running");
});

// ===================== API ROUTES =====================
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/payslips", payslipRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/utils", utilityRoutes);
app.use("/api/birthday", birthdayRoutes);

// ===================== GLOBAL ERROR HANDLER =====================
app.use((err, req, res, next) => {
  console.error("🔥 Global error:", err);
  res.status(500).json({
    message: err.message || "Internal server error"
  });
});

// ===================== START SERVER =====================
async function startServer() {
  try {
    await connectDB();

    // Start background jobs
    logArchiveJob();
    birthdayReminderJob();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log("🎂 Birthday reminder job active");
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

startServer();

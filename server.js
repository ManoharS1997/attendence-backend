// server.js
import "dotenv/config.js";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

// ==============================
// ROUTES
// ==============================
import authRoutes from "./routes/authRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import logRoutes from "./routes/logRoutes.js";
import holidayRoutes from "./routes/holidayRoutes.js";

// ✅ NEW – PAYSLIP MANAGEMENT
import payslipManagementRoutes from "./routes/payslipManagementRoutes.js";

// ==============================
// APP INIT
// ==============================
const app = express();
const PORT = process.env.PORT || 5000;

// ==============================
// CORS CONFIG (LOCAL DEV SAFE)
// ==============================
const allowedOrigins = [
  "http://localhost:5173", // Vite dev
  "http://localhost:4173"  // Vite preview / build
];

app.use(
  cors({
    origin(origin, callback) {
      // allow Postman / Thunder Client
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("❌ CORS blocked:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

// ==============================
// MIDDLEWARE
// ==============================
// ⛔ Register payslip routes FIRST (binary-safe)
app.use("/api/payslips", payslipManagementRoutes);

// JSON middleware AFTER
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));


// ==============================
// HEALTH CHECK
// ==============================
app.get("/", (req, res) => {
  res.send("🚀 Attendance & Payslip API is running");
});

// ==============================
// API ROUTES
// ==============================
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/holidays", holidayRoutes);

// ✅ Payslip Management
app.use("/api/payslips", payslipManagementRoutes);

// ==============================
// GLOBAL ERROR HANDLER
// ==============================
app.use((err, req, res, next) => {
  console.error("🔥 Global error:", err.message);
  res.status(500).json({
    message: err.message || "Internal server error"
  });
});

// ==============================
// START SERVER
// ==============================
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err.message);
    process.exit(1);
  }
}

startServer();

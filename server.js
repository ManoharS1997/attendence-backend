import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

// Import all routes
import authRoutes from "./routes/authRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import logRoutes from "./routes/logRoutes.js";
import holidayRoutes from "./routes/holidayRoutes.js";
import payslipRoutes from "./routes/payslipManagementRoutes.js"; // Make sure this is imported
import utilityRoutes from "./routes/utilityRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://44.217.109.241:5173"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.options("*", cors());

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/", (req, res) => {
  res.send("🚀 Attendance & Payslip API running");
});

// API Routes - MAKE SURE PAYSLIP ROUTES ARE INCLUDED HERE
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/payslips", payslipRoutes); // THIS LINE IS IMPORTANT
app.use("/api/utils", utilityRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("🔥 Global error:", err);
  res.status(500).json({
    message: err.message || "Internal server error"
  });
});

// Start server
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📄 Payslip routes available at: http://localhost:${PORT}/api/payslips`);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

startServer();
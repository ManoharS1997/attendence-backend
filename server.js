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
import payslipRoutes from "./routes/payslipManagementRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
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

// NEW: Notification middleware
app.use((req, res, next) => {
  // Add notification headers for frontend
  res.setHeader('X-Notification-System', 'active');
  next();
});

// API Routes
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

// NEW: Notification endpoint
app.get("/api/notifications", (req, res) => {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  
  res.json({
    message: `Welcome to ${currentMonth}/${currentYear}`,
    currentMonth,
    currentYear,
    notifications: [
      {
        id: 1,
        type: "info",
        message: "System is running normally",
        timestamp: new Date().toISOString()
      }
    ]
  });
});

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
      console.log(`📄 API Endpoints:`);
      console.log(`   • Auth: http://localhost:${PORT}/api/auth`);
      console.log(`   • Attendance: http://localhost:${PORT}/api/attendance`);
      console.log(`   • Tasks: http://localhost:${PORT}/api/tasks`);
      console.log(`   • Leave: http://localhost:${PORT}/api/leave`);
      console.log(`   • Notifications: http://localhost:${PORT}/api/notifications`);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

startServer();
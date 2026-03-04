import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { connectDB } from "./config/db.js";

// 🔁 Background Jobs
import logArchiveJob from "./jobs/logArchiveJob.js";
import birthdayReminderJob from "./jobs/birthdayReminderJob.js";

// ✅ Add cron and model imports for 6PM summary
import cron from "node-cron";
import User from "./models/User.js";
import Attendance from "./models/Attendance.js";
import Task from "./models/Task.js";
import Notification from "./models/Notification.js";

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

const allowedOrigins = [
  // Local development
  "http://localhost:5173",
  "http://localhost:4173",

  // Production frontend
  "https://attendencetracker.nowitservices.com",

  // (Optional) if you ever access UI via IP
  "http://44.217.109.241:5173"
];

// ===================== CORS =====================
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.options("*", cors({
  origin: allowedOrigins,
  credentials: true
}));

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

// ===================== CREATE HTTP SERVER =====================
const httpServer = createServer(app);

// ===================== SOCKET.IO SETUP =====================
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://attendencetracker.nowitservices.com"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"]
});

// Make io globally accessible
app.set("io", io);

// Store connected users (optional but useful for targeted notifications)
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);
  
  // Listen for user authentication to map socket to user
  socket.on("authenticate", (userId) => {
    connectedUsers.set(userId, socket.id);
    console.log(`🔐 User ${userId} mapped to socket ${socket.id}`);
  });
  
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    // Remove user from connected map
    for (let [userId, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(userId);
        console.log(`👋 User ${userId} removed from connected map`);
        break;
      }
    }
  });
});

// Helper function to send notification to specific user
const sendNotificationToUser = (userId, notificationData) => {
  const socketId = connectedUsers.get(userId.toString());
  if (socketId) {
    io.to(socketId).emit("new-notification", notificationData);
    return true;
  }
  return false;
};

// ===================== START SERVER =====================
async function startServer() {
  try {
    await connectDB();

    // Start background jobs
    logArchiveJob();
    birthdayReminderJob();

    // ===================== 6PM DAILY MANAGER SUMMARY =====================
    // Runs every day at 6:00 PM
    cron.schedule("0 18 * * *", async () => {
      try {
        console.log("⏰ Running 6PM Manager Daily Summary Job");

        const today = new Date();
        const day = String(today.getDate()).padStart(2, "0");
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const year = today.getFullYear();
        const formattedDate = `${day}-${month}-${year}`;

        // FIXED: Changed from "HR" to "manager" to match your role system
        const managers = await User.find({ role: "manager" });
        const employees = await User.find({ role: "employee" });

        console.log(`📊 Found ${managers.length} managers and ${employees.length} employees`);

        for (let manager of managers) {
          for (let emp of employees) {
            const attendance = await Attendance.findOne({
              user: emp._id,
              date: formattedDate,
            });

            const completedTasks = await Task.countDocuments({
              assignedUserId: emp._id,
              status: "COMPLETED",
              createdAt: {
                $gte: new Date(year, today.getMonth(), today.getDate()),
              },
            });

            const hours = attendance?.hoursWorked || 0;
            const lunch = attendance?.lunchBreakMinutes || 0;
            const status = attendance?.status || "NO RECORD";

            const title = `Daily Summary - ${emp.fullName} - ${formattedDate}`;

            const existing = await Notification.findOne({
              user: manager._id,
              title,
            });

            if (!existing) {
              const notification = await Notification.create({
                user: manager._id,
                type: "info",
                title,
                message: `Hours: ${hours} hrs | Lunch: ${lunch} mins | Tasks: ${completedTasks} | Status: ${status}`,
                month: today.getMonth() + 1,
                year: year,
                priority: 3,
              });

              // IMPROVED: Send notification only to the specific manager
              const sent = sendNotificationToUser(manager._id, {
                id: notification._id,
                type: "info",
                title,
                message: `Hours: ${hours} hrs | Lunch: ${lunch} mins | Tasks: ${completedTasks} | Status: ${status}`,
                timestamp: new Date(),
              });

              if (sent) {
                console.log(`🔔 Notification sent to manager ${manager.fullName} for employee ${emp.fullName}`);
              }
            }
          }
        }

        console.log("✅ 6PM Summary Completed");
      } catch (err) {
        console.error("❌ 6PM Summary Error:", err);
      }
    });

    // ===================== START SERVER =====================
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log("🎂 Birthday reminder job active");
      console.log("🔌 Socket.IO enabled with user mapping");
      console.log("⏰ 6PM Manager Summary job active (runs daily at 18:00)");
      console.log("📋 System ready with fixes applied:");
      console.log("   ✅ Manager role fixed (HR → manager)");
      console.log("   ✅ Cron schedule fixed (* * * * * → 0 18 * * *)");
      console.log("   ✅ Targeted notifications implemented");
    });

  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

startServer();
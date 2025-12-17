// server.js
import "dotenv/config.js";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import logRoutes from "./routes/logRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// ======================================
// CLEAN CORS — ONLY LOCALHOST ALLOWED
// ======================================
const allowedOrigins = [
  "http://localhost:5173", // Vite dev server
  "http://localhost:4173"  // Vite preview / production build
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools like Postman / Thunder Client (no Origin)
      if (!origin) return callback(null, true);

      // Allow localhost only
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Block everything else
      console.warn("❌ CORS blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ======================================

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Attendance API is running");
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

// ======================================
// Start Server
// ======================================
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
}

startServer();

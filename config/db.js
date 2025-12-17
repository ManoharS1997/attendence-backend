// config/db.js
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

export const connectDB = async () => {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI is not set in .env");
    process.exit(1);
  }

  try {
    console.log("🔄 Trying to connect to MongoDB...");
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    // console.error(err); // uncomment if you want full stack
    process.exit(1);
  }
};

export default connectDB;

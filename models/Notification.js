import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    
    type: {
      type: String,
      enum: ["info", "warning", "success", "error"],
      default: "info"
    },
    
    title: {
      type: String,
      required: true
    },
    
    message: {
      type: String,
      required: true
    },
    
    month: {
      type: Number,
      min: 1,
      max: 12
    },
    
    year: {
      type: Number,
      min: 2000,
      max: 2100
    },
    
    read: {
      type: Boolean,
      default: false
    },
    
    readAt: {
      type: Date
    },
    
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    },
    
    actionUrl: {
      type: String
    },
    
    priority: {
      type: Number,
      default: 1,
      min: 1,
      max: 5
    }
  },
  { timestamps: true }
);

// Index for faster queries
notificationSchema.index({ user: 1, read: 1 });
notificationSchema.index({ user: 1, month: 1, year: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Notification", notificationSchema);
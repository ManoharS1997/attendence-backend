import cron from "node-cron";
import Log from "../models/Log.js";

/**
 * Runs at 23:59 on the LAST day of every month
 */
cron.schedule("59 23 28-31 * *", async () => {
  try {
    const now = new Date();

    // Check if today is actually the last day of the month
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    if (tomorrow.getMonth() !== now.getMonth()) {
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = now.getFullYear();
      const archiveKey = `${month}-${year}`;

      const result = await Log.updateMany(
        { archived: false },
        {
          $set: {
            archived: true,
            archivedMonth: archiveKey
          }
        }
      );

      console.log(
        `✅ Logs archived for ${archiveKey}. Count: ${result.modifiedCount}`
      );
    }
  } catch (err) {
    console.error("❌ Monthly log archival failed:", err.message);
  }
});

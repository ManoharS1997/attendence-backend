import cron from "node-cron";
import Log from "../models/Log.js";

/**
 * Runs on last day of every month at 11:59 PM
 * Archives previous month logs
 */
const logArchiveJob = () => {
  cron.schedule("59 23 28-31 * *", async () => {
    try {
      const today = new Date();

      // Only run on actual last day
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      if (tomorrow.getDate() !== 1) return;

      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);

      const result = await Log.updateMany(
        {
          createdAt: { $gte: start, $lt: end },
          archived: { $ne: true }
        },
        {
          $set: {
            archived: true,
            archivedMonth: today.getMonth() + 1,
            archivedYear: today.getFullYear()
          }
        }
      );

      console.log(
        `📦 Archived ${result.modifiedCount} logs for ${today.getMonth() + 1}-${today.getFullYear()}`
      );
    } catch (err) {
      console.error("❌ Log archival job failed:", err);
    }
  });
};

export default logArchiveJob;

// jobs/birthdayReminderJob.js
import cron from "node-cron";
import Birthday from "../models/Birthday.js";
import Log from "../models/Log.js";

/**
 * Runs every day at 9 AM
 * Checks birthdays that are AFTER 3 DAYS from today
 */
const birthdayReminderJob = () => {
  cron.schedule("0 9 * * *", async () => {
    try {
      const today = new Date();

      // calculate date after 3 days
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + 3);

      const day = targetDate.getDate();       // eg: 16
      const month = targetDate.getMonth() + 1; // eg: 11

      const birthdays = await Birthday.find({
        day,
        month,
        isActive: true
      });

      for (const b of birthdays) {
        await Log.create({
          type: "OPERATION",
          action: "UPCOMING_BIRTHDAY",
          entity: "BIRTHDAY",
          description: `🎂 ${b.fullName}'s birthday is on ${b.day}-${b.month}`,
          role: "manager",
          status: "INFO"
        });
      }

      if (birthdays.length > 0) {
        console.log(`🎉 Birthday reminders sent for ${day}-${month}`);
      }
    } catch (err) {
      console.error("❌ Birthday reminder job failed:", err);
    }
  });
};

export default birthdayReminderJob;

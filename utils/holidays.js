// utils/holidays.js
import HolidaySetting from "../models/HolidaySetting.js";

// Convert "DD-MM-YYYY" string into a Date object
export const parseDdMmYyyy = (dateStr) => {
  if (!dateStr) return null;
  const [dd, mm, yyyy] = dateStr.split("-").map((p) => parseInt(p, 10));
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd);
};

export const isSunday = (dateStr) => {
  const d = parseDdMmYyyy(dateStr);
  if (!d) return false;
  return d.getDay() === 0; // 0 = Sunday
};

export const isSecondSaturday = (dateStr) => {
  const d = parseDdMmYyyy(dateStr);
  if (!d) return false;
  if (d.getDay() !== 6) return false; // 6 = Saturday
  const dayOfMonth = d.getDate();
  const nth = Math.floor((dayOfMonth - 1) / 7) + 1;
  return nth === 2;
};

// every Sunday + 2nd Saturday is weekend holiday
export const isWeekendHoliday = (dateStr) =>
  isSunday(dateStr) || isSecondSaturday(dateStr);

const MANDATORY_PUBLIC_HOLIDAYS = [
  { day: 26, month: 1, label: "Republic Day" },
  { day: 15, month: 8, label: "Independence Day" },
  { day: 2, month: 10, label: "Gandhi Jayanti" },
];

export const isMandatoryPublicHoliday = (dateStr) => {
  const d = parseDdMmYyyy(dateStr);
  if (!d) return false;
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return MANDATORY_PUBLIC_HOLIDAYS.some(
    (h) => h.day === day && h.month === month
  );
};

// Build calendar for UI + summary logic
export const buildHolidayCalendar = (month, year) => {
  if (!month || !year) return [];

  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!m || !y) return [];

  const daysInMonth = new Date(y, m, 0).getDate();
  const items = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dd = String(day).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const dateStr = `${dd}-${mm}-${y}`;

    if (isWeekendHoliday(dateStr)) {
      items.push({
        date: dateStr,
        type: "WEEKEND",
        label: isSunday(dateStr) ? "Sunday" : "Second Saturday",
      });
    } else if (isMandatoryPublicHoliday(dateStr)) {
      const holiday = MANDATORY_PUBLIC_HOLIDAYS.find(
        (h) => h.day === day && h.month === m
      );
      items.push({
        date: dateStr,
        type: "MANDATORY_PUBLIC",
        label: holiday?.label || "Public Holiday",
      });
    }
  }

  return items;
};

export const countWeekendHolidays = (month, year) => {
  const calendar = buildHolidayCalendar(month, year);
  return calendar.filter((d) => d.type === "WEEKEND").length;
};

export const countMandatoryPublicHolidays = (month, year) => {
  const calendar = buildHolidayCalendar(month, year);
  return calendar.filter((d) => d.type === "MANDATORY_PUBLIC").length;
};

// ✅ UPDATED: working days between two DD-MM-YYYY (inclusive),
// skipping Sundays, 2nd Saturdays, mandatory public holidays,
// and optional holidays marked as TAKEN
export const countWorkingDaysInRange = async (startStr, endStr) => {
  const startDate = parseDdMmYyyy(startStr);
  const endDate = parseDdMmYyyy(endStr);

  if (!startDate || !endDate) return 0;
  if (endDate < startDate) return 0;

  let count = 0;
  const d = new Date(startDate.getTime());

  // Get all holiday settings for the date range
  const holidaySettings = await HolidaySetting.find({
    dateKey: {
      $gte: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
      $lte: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`
    }
  });

  // Create a map for quick lookup
  const holidayMap = new Map();
  holidaySettings.forEach(h => {
    holidayMap.set(h.dateKey, h.status);
  });

  while (d <= endDate) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;
    const dateKey = `${yyyy}-${mm}-${dd}`;

    const weekend = isWeekendHoliday(dateStr);
    const mandatoryPublic = isMandatoryPublicHoliday(dateStr);
    
    // Check if it's an optional holiday that's marked as TAKEN
    const holidayStatus = holidayMap.get(dateKey);
    const optionalTaken = holidayStatus === "TAKEN";

    if (!weekend && !mandatoryPublic && !optionalTaken) {
      count += 1;
    }

    d.setDate(d.getDate() + 1);
  }

  return count;
};

// Synchronous version for frontend calculations (doesn't check optional holidays)
export const countWorkingDaysInRangeSync = (startStr, endStr) => {
  const startDate = parseDdMmYyyy(startStr);
  const endDate = parseDdMmYyyy(endStr);

  if (!startDate || !endDate) return 0;
  if (endDate < startDate) return 0;

  let count = 0;
  const d = new Date(startDate.getTime());

  while (d <= endDate) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;

    const weekend = isWeekendHoliday(dateStr);
    const mandatoryPublic = isMandatoryPublicHoliday(dateStr);

    if (!weekend && !mandatoryPublic) {
      count += 1;
    }

    d.setDate(d.getDate() + 1);
  }

  return count;
};

export function calculateWorkingDays(
  year,
  month,
  publicHolidays = [],
  optionalTaken = []
) {
  const date = new Date(year, month - 1, 1);
  let workingDays = 0;

  while (date.getMonth() === month - 1) {
    const day = date.getDay(); // 0=Sun, 6=Sat
    const iso = date.toISOString().slice(0, 10);

    const isSecondSaturday =
      day === 6 && Math.ceil(date.getDate() / 7) === 2;

    if (
      day !== 0 && // Sunday
      !isSecondSaturday &&
      !publicHolidays.includes(iso) &&
      !optionalTaken.includes(iso)
    ) {
      workingDays++;
    }

    date.setDate(date.getDate() + 1);
  }

  return workingDays;
};

/**
 * Check if a date is a holiday (considering optional holidays marked as TAKEN)
 */
export const isHolidayDate = async (dateStr) => {
  if (!dateStr) return false;
  
  // Check for weekends (Sundays and 2nd Saturdays)
  if (isWeekendHoliday(dateStr)) {
    return true;
  }
  
  // Check for mandatory public holidays
  if (isMandatoryPublicHoliday(dateStr)) {
    return true;
  }
  
  // Check for optional holidays marked as TAKEN in database
  try {
    // Convert DD-MM-YYYY to YYYY-MM-DD for database query
    const [dd, mm, yyyy] = dateStr.split("-");
    const dateKey = `${yyyy}-${mm}-${dd}`;
    
    // Check if this date is an optional holiday marked as TAKEN
    const holidaySetting = await HolidaySetting.findOne({ dateKey });
    if (holidaySetting && holidaySetting.status === "TAKEN") {
      return true;
    }
  } catch (err) {
    console.error("Error checking optional holiday:", err);
  }
  
  return false;
};

/**
 * Calculate total estimate hours between two dates
 * Working days × 8 hours per day
 */
export const calculateTotalEstimateHours = async (startStr, endStr) => {
  const workingDays = await countWorkingDaysInRange(startStr, endStr);
  return workingDays * 8;
};

/**
 * Calculate duration in months between two dates
 */
export const calculateDurationMonths = (startStr, endStr) => {
  if (!startStr || !endStr) return 0;
  
  const [sd, sm, sy] = startStr.split("-").map(Number);
  const [ed, em, ey] = endStr.split("-").map(Number);
  
  if ([sd, sm, sy, ed, em, ey].some(isNaN)) return 0;

  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  
  // Calculate difference in months
  let months = (ey - sy) * 12 + (em - sm);
  
  // If end day is less than start day, subtract one month
  if (ed < sd) {
    months--;
  }
  
  // Add 1 to include both start and end months
  return Math.max(1, months + 1);
};
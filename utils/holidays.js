// utils/holidays.js

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

// ✅ NEW: working days between two DD-MM-YYYY (inclusive),
// skipping Sundays, 2nd Saturdays, mandatory public holidays.
export const countWorkingDaysInRange = (startStr, endStr) => {
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

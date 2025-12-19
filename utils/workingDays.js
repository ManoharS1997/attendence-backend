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
}

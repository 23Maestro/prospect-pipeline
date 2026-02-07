export function getInQueueReminderDefaultDate(videoDueDate?: string, now: Date = new Date()): Date {
  if (!videoDueDate) {
    return new Date(now);
  }

  const parsed = new Date(videoDueDate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(now);
  }

  const reminderDate = new Date(parsed);
  reminderDate.setDate(reminderDate.getDate() - 2);
  return reminderDate;
}

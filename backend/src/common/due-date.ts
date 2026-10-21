import { BadRequestException } from '@nestjs/common';

/**
 * Due dates are calendar days, stored as midnight UTC of that day so the day never shifts with the
 * time zone of whoever reads it. "Today" is the server's local calendar day, as for the JQL date functions.
 */

/** yyyy-mm-dd (or empty, meaning no due date) to a stored date. */
export function parseDueDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !date || date.getUTCMonth() !== +m[2] - 1) throw new BadRequestException('Due date must be a real date, as yyyy-mm-dd');
  return date;
}

/** The stored date as yyyy-mm-dd. */
export function dueDateText(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** The calendar day a moment falls on in the server's time zone, in stored form. */
export function calendarDay(moment: Date): Date {
  return new Date(Date.UTC(moment.getFullYear(), moment.getMonth(), moment.getDate()));
}

import { TriggerConfig } from './automation-actions';

/** The first moment strictly after `from` that a schedule fires. Times are UTC. */
export function nextRun(config: TriggerConfig, from: Date): Date {
  const [hour, minute] = (config.time ?? '09:00').split(':').map(Number);
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  switch (config.frequency) {
    case 'hourly':
      next.setUTCMinutes(minute);
      if (next <= from) next.setUTCHours(next.getUTCHours() + 1);
      return next;
    case 'weekly':
      next.setUTCHours(hour, minute);
      next.setUTCDate(next.getUTCDate() + ((((config.weekday ?? 1) - next.getUTCDay()) % 7) + 7) % 7);
      if (next <= from) next.setUTCDate(next.getUTCDate() + 7);
      return next;
    default:
      next.setUTCHours(hour, minute);
      if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
      return next;
  }
}

/** "Every day at 09:00 UTC" */
export function describeSchedule(config: TriggerConfig): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const time = config.time ?? '09:00';
  if (config.frequency === 'hourly') return `Every hour at :${time.slice(3)}`;
  if (config.frequency === 'weekly') return `Every ${days[config.weekday ?? 1]} at ${time} UTC`;
  return `Every day at ${time} UTC`;
}

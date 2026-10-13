import { AppNotificationRecord } from './models';

export const NOTIFICATION_QUERY_LIMIT = 50;
export const MAX_READ_NOTIFICATION_IDS = 500;

// Keep both bounded streams, so busy broadcasts cannot evict personal activity.
export function mergeNotifications(groups: AppNotificationRecord[][]): AppNotificationRecord[] {
  const records = new Map(groups.flat().map((record) => [record.id, record]));
  return [...records.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

export function boundReadNotificationIds(
  existing: string[],
  added: string[],
  visible: string[],
): string[] {
  const all = [...new Set([...existing, ...added])];
  const visibleIds = new Set(visible);
  const protectedIds = all.filter((id) => visibleIds.has(id));
  const others = all.filter((id) => !visibleIds.has(id));
  // Current queries expose at most 100 records. New read marks get the newest slots.
  return [
    ...others.slice(-Math.max(0, MAX_READ_NOTIFICATION_IDS - protectedIds.length)),
    ...protectedIds,
  ].slice(-MAX_READ_NOTIFICATION_IDS);
}

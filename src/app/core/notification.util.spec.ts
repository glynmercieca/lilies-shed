import { describe, expect, it } from 'vitest';
import { AppNotificationRecord } from './models';
import { boundReadNotificationIds, mergeNotifications } from './notification.util';

describe('notification merging and read history', () => {
  it('deduplicates streams and orders by date with a stable ID tie break', () => {
    const record = (id: string, createdAt: string) => ({ id, createdAt }) as AppNotificationRecord;
    const personal = record('personal', '2026-10-12T09:00:00.000Z');
    const broadcast = record('broadcast', '2026-10-13T09:00:00.000Z');
    expect(mergeNotifications([[personal], [broadcast, personal]]).map((item) => item.id)).toEqual([
      'broadcast',
      'personal',
    ]);
    expect(
      mergeNotifications([[record('b', '')], [record('a', '')]]).map((item) => item.id),
    ).toEqual(['a', 'b']);
  });

  it('keeps all 50 personal records even when broadcasts are newer', () => {
    const personal = Array.from(
      { length: 50 },
      (_, i) => ({ id: `p${i}`, createdAt: '2025' }) as AppNotificationRecord,
    );
    const broadcast = Array.from(
      { length: 50 },
      (_, i) => ({ id: `b${i}`, createdAt: '2026' }) as AppNotificationRecord,
    );
    expect(mergeNotifications([personal, broadcast])).toHaveLength(100);
  });

  it('bounds legacy histories while protecting visible and newly read records', () => {
    const existing = Array.from({ length: 2000 }, (_, i) => `n${i}`);
    const result = boundReadNotificationIds(existing, ['new', 'new'], ['n0', 'n1', 'new']);
    expect(result).toHaveLength(500);
    expect(result).toEqual(expect.arrayContaining(['n0', 'n1', 'n1999', 'new']));
    expect(result).not.toContain('n2');
  });

  it('preserves existing small histories and deduplicates marks', () => {
    expect(boundReadNotificationIds(['a', 'b'], ['b', 'c'], ['a'])).toEqual(['b', 'c', 'a']);
  });
});

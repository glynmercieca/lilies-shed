import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { EMPTY, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionCheckService } from './version-check.service';

describe('production version updates', () => {
  let events: Subject<VersionEvent>;
  let check: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    events = new Subject();
    check = vi.fn().mockResolvedValue(false);
    open = vi.fn().mockReturnValue({ onAction: () => EMPTY });
    TestBed.configureTestingModule({ providers: [
      { provide: SwUpdate, useValue: { isEnabled: true, checkForUpdate: check, versionUpdates: events, unrecoverable: new Subject() } },
      { provide: MatSnackBar, useValue: { open } },
    ] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('waits for a complete cached version before offering reload and prompts only once', () => {
    TestBed.inject(VersionCheckService).start();
    expect(check).toHaveBeenCalledOnce();
    events.next({ type: 'VERSION_DETECTED', version: { hash: 'new' } });
    expect(open).not.toHaveBeenCalled();
    const ready: VersionEvent = { type: 'VERSION_READY', currentVersion: { hash: 'old' }, latestVersion: { hash: 'new' } };
    events.next(ready);
    events.next(ready);
    expect(open).toHaveBeenCalledExactlyOnceWith('An updated version is ready.', 'Reload');
  });

  it('ignores an offline update-check failure without offering a broken version', async () => {
    check.mockRejectedValue(new Error('offline'));
    TestBed.inject(VersionCheckService).start();
    await Promise.resolve();
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  });

  it('retains uncached JSON version checks when the app worker is disabled', async () => {
    TestBed.overrideProvider(SwUpdate, { useValue: { isEnabled: false } });
    const fetchVersion = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '999.0.0' }) });
    vi.stubGlobal('fetch', fetchVersion);
    TestBed.inject(VersionCheckService).start();
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith('Version 999.0.0 is available.', 'Reload'));
    expect(fetchVersion.mock.calls[0][0]).toContain('app-version.json');
    expect(fetchVersion.mock.calls[0][1].cache).toBe('no-store');
  });
});

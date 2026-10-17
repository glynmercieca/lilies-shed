import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MatSnackBar } from '@angular/material/snack-bar';
const sdk = vi.hoisted(() => ({ setDoc: vi.fn(), runTransaction: vi.fn(), updateDoc: vi.fn(), getToken: vi.fn(), deleteToken: vi.fn(), onMessage: vi.fn(), isSupported: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, path: string, id: string) => ({ path, id }), setDoc: sdk.setDoc, runTransaction: sdk.runTransaction, updateDoc: sdk.updateDoc, arrayRemove: (token: string) => ({ remove: token }) }));
vi.mock('firebase/messaging', () => ({ isSupported: sdk.isSupported, getMessaging: () => ({}), getToken: sdk.getToken, deleteToken: sdk.deleteToken, onMessage: sdk.onMessage }));
import { APP_SETTINGS } from './app-settings';
const originalVapidKey = APP_SETTINGS.firebaseVapidKey;
import { FirebaseMessagingService } from './firebase-messaging.service';
import { FirebaseClientService } from './firebase-client.service';
beforeEach(() => {
  vi.resetAllMocks();
  sdk.isSupported.mockResolvedValue(true);
  APP_SETTINGS.firebaseVapidKey = 'test-vapid';
  window.localStorage.clear();
  vi.stubGlobal('Notification', { permission: 'granted' });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => undefined, register: async () => ({ update: async () => undefined }) } });
  TestBed.configureTestingModule({ providers: [FirebaseMessagingService, { provide: FirebaseClientService, useValue: { firestore: {}, app: {} } }, { provide: MatSnackBar, useValue: { open: vi.fn() } }] });
});
afterEach(() => { APP_SETTINGS.firebaseVapidKey = originalVapidKey; vi.unstubAllGlobals(); });

it('does not initialize messaging support until needed and skips unconfigured notifications', async () => {
  const service = TestBed.inject(FirebaseMessagingService);
  expect(sdk.isSupported).not.toHaveBeenCalled();
  APP_SETTINGS.firebaseVapidKey = '';
  expect(await service.canPromptForNotifications()).toBe(false);
  expect(sdk.isSupported).not.toHaveBeenCalled();
  APP_SETTINGS.firebaseVapidKey = 'test-vapid';
  await service.canPromptForNotifications();
  await service.canPromptForNotifications();
  expect(sdk.isSupported).toHaveBeenCalledOnce();
});
it('registration bounds legacy token histories transactionally and writes only the private account', async () => {
  sdk.getToken.mockResolvedValue('new-token');
  const set = vi.fn();
  sdk.runTransaction.mockImplementation(async (_db, callback) => callback({ get: async () => ({ data: () => ({ notificationTokens: Array.from({ length: 30 }, (_, i) => 'token-' + i) }) }), set }));
  await TestBed.inject(FirebaseMessagingService).syncCurrentUser({ id: 'UserA', name: 'Alice', email: '', firstName: 'Alice', lastName: '', picture: '' });
  expect(set.mock.calls[0][0]).toEqual({ path: 'users', id: 'UserA' });
  const data = set.mock.calls[0][1];
  expect(data.notificationTokens).toHaveLength(20);
  expect(data.notificationTokens.at(-1)).toBe('new-token');
  expect(data.notificationTokens[0]).toBe('token-11');
  expect(sdk.setDoc.mock.calls.every(([ref]) => ref.path === 'users')).toBe(true);
});
it('sign-out removes the stored token from the private account and browser', async () => {
  window.localStorage.setItem('lilies-shed.fcm-token', 'old-token');
  await TestBed.inject(FirebaseMessagingService).clearCurrentUserToken('UserA');
  expect(sdk.updateDoc).toHaveBeenCalledWith({ path: 'users', id: 'UserA' }, { notificationTokens: { remove: 'old-token' } });
  expect(sdk.deleteToken).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem('lilies-shed.fcm-token')).toBeNull();
});

it('shows a replayed foreground event only once and uses the event tag for browser notifications', async () => {
  const shown = vi.fn();
  vi.stubGlobal('Notification', class { static permission = 'granted'; constructor(title: string, options: unknown) { shown(title, options); } });
  sdk.getToken.mockResolvedValue('token');
  await TestBed.inject(FirebaseMessagingService).syncCurrentUser({ id: 'UserA', name: 'Alice', email: '', firstName: 'Alice', lastName: '', picture: '' });
  const callback = sdk.onMessage.mock.calls[0][1];
  const payload = { notification: { title: 'Tool borrowed', body: 'Drill borrowed' }, data: { notificationId: 'event' } };
  callback(payload);
  callback(payload);
  expect(shown).toHaveBeenCalledOnce();
  expect(shown.mock.calls[0][1]).toMatchObject({ tag: 'event' });
  expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledOnce();
  TestBed.inject(FirebaseMessagingService).dismissForegroundNotification();
});

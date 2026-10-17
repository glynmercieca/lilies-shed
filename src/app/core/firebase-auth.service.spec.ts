import { TestBed } from '@angular/core/testing';
import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ onIdTokenChanged: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: sdk.onIdTokenChanged, signInWithPopup: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, path: string, id: string) => ({ path, id }), getDoc: sdk.getDoc, setDoc: sdk.setDoc, serverTimestamp: () => 'server-time' }));
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseClientService } from './firebase-client.service';
beforeEach(() => {
  vi.resetAllMocks();
  sdk.getDoc.mockResolvedValue({ exists: () => true });
  sdk.setDoc.mockResolvedValue(undefined);
  TestBed.configureTestingModule({ providers: [FirebaseAuthService, { provide: FirebaseClientService, useValue: { auth: {}, firestore: {} } }] });
});
it('restoring an existing account refreshes a safe public projection and preserves private settings', async () => {
  const service = TestBed.inject(FirebaseAuthService);
  await sdk.onIdTokenChanged.mock.calls[0][1]({ uid: 'UserA', email: 'private@example.com', displayName: 'Alice Smith', photoURL: 'https://example.com/alice.jpg' });
  expect(service.currentUser()?.id).toBe('UserA');
  expect(sdk.setDoc.mock.calls[0]).toEqual([{ path: 'publicProfiles', id: 'UserA' }, { displayName: 'Alice Smith', firstName: 'Alice', lastName: 'Smith', photoURL: 'https://example.com/alice.jpg' }]);
  expect(sdk.setDoc.mock.calls[1][0]).toEqual({ path: 'users', id: 'UserA' });
  expect(sdk.setDoc.mock.calls[1][1].email).toBe('private@example.com');
  expect(sdk.setDoc.mock.calls[1][1]).not.toHaveProperty('createdAt');
  expect(sdk.setDoc.mock.calls[1][2]).toEqual({ merge: true });
});

it('does not publish the email fallback when the account has no display name', async () => {
  TestBed.inject(FirebaseAuthService);
  await sdk.onIdTokenChanged.mock.calls[0][1]({ uid: 'UserA', email: 'private@example.com', displayName: null, photoURL: null });
  expect(sdk.setDoc.mock.calls[0][1]).toEqual({ displayName: 'Member', firstName: '', lastName: '', photoURL: '' });
});

it('keeps a restored account signed in when public-profile writes are denied during rollout', async () => {
  const firebaseUser = { uid: 'UserA', email: 'private@example.com', displayName: 'Alice Smith', photoURL: null, getIdToken: vi.fn().mockResolvedValue('test-token') };
  TestBed.overrideProvider(FirebaseClientService, { useValue: { auth: { currentUser: firebaseUser }, firestore: {} } });
  sdk.setDoc.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
  const service = TestBed.inject(FirebaseAuthService);
  await sdk.onIdTokenChanged.mock.calls[0][1](firebaseUser);
  expect(service.currentUser()?.id).toBe('UserA');
  expect(await service.ensureValidSession()).toBe(true);
  expect(service.error()).toContain('permissions');
  expect(sdk.setDoc.mock.calls[0][0].path).toBe('publicProfiles');
  // Auth still clears the account for an actual sign-out event.
  await sdk.onIdTokenChanged.mock.calls[0][1](null);
  expect(service.currentUser()).toBeNull();
});

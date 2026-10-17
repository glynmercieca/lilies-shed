import { describe, expect, it } from 'vitest';

import { formatUserIdentity, matchesUserEmail, matchesUserIdentity, matchesUserId } from './identity.util';
import { UserProfile } from './models';

const user: UserProfile = {
  id: 'user-1',
  email: 'glyn@example.com',
  name: 'Glyn Morgan',
  picture: '',
  firstName: 'Glyn',
  lastName: 'Morgan',
};

describe('identity utilities', () => {
  it('compares Firebase UIDs exactly, including case', () => {
    expect(matchesUserId(user, 'user-1')).toBe(true);
    expect(matchesUserId(user, 'USER-1')).toBe(false);
  });
  it('formats a combined display identity', () => {
    expect(formatUserIdentity(user)).toBe('Glyn Morgan <glyn@example.com>');
  });

  it('matches a legacy short owner name', () => {
    expect(matchesUserIdentity(user, 'Glyn')).toBe(true);
  });

  it('matches an email-based identity string', () => {
    expect(matchesUserIdentity(user, 'Glyn Morgan <glyn@example.com>')).toBe(true);
  });

  it('matches borrower emails exactly', () => {
    expect(matchesUserEmail(user, 'glyn@example.com')).toBe(true);
    expect(matchesUserEmail(user, 'other@example.com')).toBe(false);
  });

  it('does not match unrelated users', () => {
    expect(matchesUserIdentity(user, 'Louis')).toBe(false);
  });
});

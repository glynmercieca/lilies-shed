import { describe, expect, it } from 'vitest';

import { formatUserIdentity, matchesUserEmail, matchesUserIdentity } from './identity.util';
import { UserProfile } from './models';

const user: UserProfile = {
  email: 'glyn@example.com',
  name: 'Glyn Morgan',
  picture: '',
};

describe('identity utilities', () => {
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

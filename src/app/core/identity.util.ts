import { UserProfile } from './models';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeToken(value: string): string {
  return normalize(value).replace(/[^a-z0-9@.+_-]/g, '');
}

function extractEmail(value: string): string | null {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalize(match[0]) : null;
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-zA-Z0-9@.+_-]+/)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 3);
}

export function formatUserIdentity(user: UserProfile): string {
  const email = normalize(user.email);
  const name = user.name.trim();

  if (name && email) {
    return `${name} <${email}>`;
  }

  return name || email;
}

export function splitUserName(name: string): { firstName: string; lastName: string } {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { firstName: '', lastName: '' };
  }

  const parts = trimmedName.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function formatOwnerDisplay(firstName: string, lastName: string, email: string): string {
  const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (name && normalizedEmail) {
    return `${name} <${normalizedEmail}>`;
  }

  return name || normalizedEmail;
}

export function matchesUserEmail(user: UserProfile | null, email: string): boolean {
  if (!user || !email.trim()) {
    return false;
  }

  return normalize(user.email) === normalize(email);
}

export function matchesUserIdentity(user: UserProfile | null, value: string): boolean {
  if (!user || !value.trim()) {
    return false;
  }

  const email = normalize(user.email);
  const emailLocalPart = email.includes('@') ? email.split('@')[0] : '';
  const name = normalize(user.name);

  const userCandidates = new Set<string>(
    [email, emailLocalPart, name, ...tokenize(user.name)].filter(Boolean).map(normalizeToken),
  );

  const rawValue = normalize(value);
  const extractedEmail = extractEmail(value);
  const valueCandidates = new Set<string>(
    [
      rawValue,
      extractedEmail ?? '',
      extractedEmail?.split('@')[0] ?? '',
      ...tokenize(value),
    ]
      .filter(Boolean)
      .map(normalizeToken),
  );

  for (const candidate of valueCandidates) {
    if (userCandidates.has(candidate)) {
      return true;
    }
  }

  return false;
}

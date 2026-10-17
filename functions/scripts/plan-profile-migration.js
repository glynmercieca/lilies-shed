// Pure migration plan. Never copy arbitrary user fields into a shared document.
function publicProfile(user) {
  const string = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const name = string(user.displayName, 200);
  const parts = name && !name.includes('@') ? name.split(/\s+/) : [];
  const firstName = (!string(user.firstName, 100).includes('@') && string(user.firstName, 100)) || parts[0] || '';
  const lastName = (!string(user.lastName, 100).includes('@') && string(user.lastName, 100)) || parts.slice(1).join(' ').slice(0, 100);
  return { displayName: [firstName, lastName].filter(Boolean).join(' ').slice(0, 200) || 'Member',
    firstName, lastName, photoURL: string(user.photoURL, 2048) };
}
function canonicalRecipient(value, userIds) {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new Error('Invalid recipient type');
  if (userIds.includes(value)) return value;
  const matches = userIds.filter(id => id.toLowerCase() === value.trim().toLowerCase());
  if (matches.length !== 1) throw new Error('Unknown or ambiguous recipient');
  return matches[0];
}
module.exports = { publicProfile, canonicalRecipient };

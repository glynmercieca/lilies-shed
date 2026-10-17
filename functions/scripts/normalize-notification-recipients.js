// Superseded: Firebase UIDs are case-sensitive. Run the canonical migration instead.
console.error('Use GCLOUD_PROJECT=PROJECT node scripts/migrate-profile-privacy.js [--apply]. Never lowercase Firebase UIDs.');
process.exitCode = 1;

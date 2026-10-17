# Database permissions rollout

Local implementation only. No production deployment or migration has been run.

## Privacy step

The users collection (including legacy notification tokens, read marks, email and preferences) is owner-only. Inventory and notification actor lookup use publicProfiles with an explicit four-field display projection; email is no longer shared. Push registration, cleanup and trusted notification fan-out continue using private users documents. Firestore cannot hide selected fields of a readable document.

Notification recipients are exact case-sensitive Firebase UIDs. An empty recipient is a broadcast to signed-in members. Null/missing legacy recipients must be normalized before rollout. All primary and fallback queries are bounded at 50 per stream. The automatic-index fallback cannot guarantee the newest 50; deploy the existing recipientId/createdAt composite index for normal newest-first results.

During a maintenance window, first back up Firestore and suspend client access/writes (including old tabs). Deploy restrictive rules before creating public projections, so legacy private records are immediately protected. With Application Default Credentials and an explicit GCLOUD_PROJECT, run functions/scripts/migrate-profile-privacy.js as a dry run, resolve every reported unknown/ambiguous notification recipient, then run with --apply. The script restores uniquely resolvable legacy UID casing and refuses all writes if recipients are ambiguous. It replaces public projections using only names/photos; private users records are retained without copying their contents. Rerun in the same maintenance window safely. Deploy the updated functions, indexes and client together and require old clients to reload before reopening access. Verify two distinct accounts: display profiles, personal/broadcast notifications, read marks and push registration/cleanup. Never re-enable broad users reads as a compatibility workaround.

The old normalize-notification-recipients.js entrypoint now fails with instructions: lowercasing UIDs can misdeliver notifications.

Rollback must retain the restrictive rules and private/public split. Restore a compatible application/functions version or keep maintenance mode while fixing forward. Do not roll back to broad users/notifications access. Backups containing tokens must stay private.

## Verification

Application tests, emulator permission tests and production build are required before each logical commit. Emulator tests use demo-lilies-tests and no production credentials. Live production authentication and push delivery remain deployment smoke checks.

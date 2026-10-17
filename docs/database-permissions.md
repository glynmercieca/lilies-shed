# Database permissions rollout

Update, 17 October 2026: the full borrowing/profile data migration, Firestore
and Storage rules, notification index, and notification functions have now been
deployed to `shed-3fc03`. See [the production rollout record](production-rollout-2026-10-17.md)
for backups, verification results and outstanding live smoke checks. The earlier
implementation notes below describe the original plan and validation history;
statements that deployment had not yet happened are historical.

## Production owner-profile repair (17 October 2026)

The live `shed-3fc03` database still had its July rules and no `publicProfiles`
collection. Published the four-field `publicProfiles` read/self-write rules and
restricted private `users` reads to the matching account. Other collection rules
were preserved from the live version, avoiding activation of reservation rules
before the borrowing migration. The deployed rules are recorded in
`firestore-profile-rollout-2026-10-17.rules`; these are a transitional production
snapshot, not a replacement for the repository's complete target `firestore.rules`.

Created eight public profile documents using the existing case-sensitive user
document IDs, copying only `displayName`, `firstName`, `lastName`, and `photoURL`.
No notification tokens, email addresses, preferences, or read marks were copied.
This was a focused display-profile backfill through the Console, not execution
of the combined notification/identity migration script.

Reloaded the existing signed-in production app in Chrome and loaded the complete
inventory: 66 available tool cards, zero “Unknown owner” labels, and no remaining
inventory loading indicator. This repair needed no new front-end deployment.

## Privacy step

The users collection (including legacy notification tokens, read marks, email and preferences) is owner-only. Inventory and notification actor lookup use publicProfiles with an explicit four-field display projection; email is no longer shared. Push registration, cleanup and trusted notification fan-out continue using private users documents. Firestore cannot hide selected fields of a readable document.

Notification recipients are exact case-sensitive Firebase UIDs. An empty recipient is a broadcast to signed-in members. Null/missing legacy recipients must be normalized before rollout. All primary and fallback queries are bounded at 50 per stream. The automatic-index fallback cannot guarantee the newest 50; deploy the existing recipientId/createdAt composite index for normal newest-first results.

During a maintenance window, first back up Firestore and suspend client access/writes (including old tabs). Deploy restrictive rules before creating public projections, so legacy private records are immediately protected. With Application Default Credentials and an explicit GCLOUD_PROJECT, run functions/scripts/migrate-profile-privacy.js as a dry run, resolve every reported unknown/ambiguous notification recipient, then run with --apply. The script checks Firebase Auth for canonical UIDs, reports invalid tool owners/active borrowers, restores uniquely resolvable legacy UID casing and refuses all writes if recipients are ambiguous. It replaces public projections using only names/photos; private users records are retained without copying their contents. Rerun in the same maintenance window safely. Deploy the updated functions, indexes and client together and require old clients to reload before reopening access. Verify two distinct accounts: display profiles, personal/broadcast notifications, read marks and push registration/cleanup. Never re-enable broad users reads as a compatibility workaround.

The old normalize-notification-recipients.js entrypoint now fails with instructions: lowercasing UIDs can misdeliver notifications.

Rollback must retain the restrictive rules and private/public split. Restore a compatible application/functions version or keep maintenance mode while fixing forward. Do not roll back to broad users/notifications access. Backups containing tokens must stay private.

## Verification

Application tests, emulator permission tests and production build are required before each logical commit. Emulator tests use demo-lilies-tests and no production credentials. Live production authentication and push delivery remain deployment smoke checks.

## Tool, loan and administrative rules

Tool creates use the generated Firestore document ID as their display ID, bind ownerId to auth, require server timestamps, an exact schema and a known category/name pair. Existing numeric IDs and links are unchanged. Owners may edit validated descriptive fields or soft-delete only an available, migrated, non-deleted tool. Ownership, IDs, creation time and loan pointers cannot be changed through owner edits. Deleted tools cannot be resurrected. Borrowers may change only reservation pointers and server update time, paired atomically with a new self-owned loan. Return requires the borrower or tool owner, an active matching reservation and atomic release; closed loans cannot reopen. Date strings are format-validated; server timestamps provide authoritative write times.

Authenticated members retain the shared inventory and loan-summary visibility used by existing availability/latest-loan screens. Loan records contain tool ID, borrower UID and dates; tokens, email and personal preferences are kept in private users records. Requests are shared among signed-in members, immutable, bound to the requester, limited to 1000 characters and server-timestamped. Notification creation stays server-only.

Category discovery is authorized in rules for the existing administrator UID R01SeK0oBJPFVBt0Okm12BnLxgs2, matching the existing app setting. A forged admin field or custom claim does not confer access. Change both rule and app configuration deliberately if responsibility transfers. Category discovery no longer runs automatically for other accounts. Trusted setup/migration scripts use Admin SDK credentials; IAM access must be controlled separately.

All client meta reads/writes are denied. Counters remain untouched for historical purposes and are no longer needed by new tools. Push registration writes only the caller's private users record and transactionally keeps the latest 20 distinct tokens, including accounts with oversized legacy histories. Existing storage rules already enforce uploader UID, signed-in reads, image MIME types and a 2 MiB nonempty upload cap; emulator coverage now verifies those boundaries. MIME metadata is validated, not image content scanning.

## Complete deployment order

1. Back up Firestore, reserve a maintenance window and stop old/new client access and writes. Never run migrations concurrently with borrowers or active old tabs.
2. Deploy the final restrictive Firestore rules, storage rules and existing firestore.indexes.json. Keep access closed. New tool creation requires seeded categories; the shared counter is intentionally inaccessible.
3. Complete the earlier borrow-state migration exactly as described in high-priority-validation.md: dry run functions/scripts/migrate-borrow-state.js, resolve conflicts, then apply. Run functions/scripts/seed-tool-categories.js with trusted credentials to seed missing fixed categories. Both use explicit GCLOUD_PROJECT. No client may borrow until reconciliation completes.
4. Dry run functions/scripts/migrate-profile-privacy.js, resolve unknown/ambiguous recipients, then apply. Null/missing broadcasts become empty strings, legacy uniquely identifiable recipient casing becomes the canonical case, and all public profile documents are replaced with the safe projection. Inspect representative profiles and verify private tokens/settings remain exclusively under users. Investigate any pre-existing publicProfiles documents not associated with a users record before reopening access; this collection is newly introduced by this change.
5. Deploy the updated notification functions and client, wait for index readiness, invalidate old client versions and require a reload. Verify the real administrator UID and two ordinary accounts. Smoke-test add/edit/delete, competing borrow attempts, both authorized return paths, personal/broadcast notifications, read marks, push registration and sign-out cleanup. Verify direct cross-account private reads and writes fail.
6. Reopen access after all checks pass. If anything fails, keep maintenance mode and fix forward or restore a compatible split-profile client/functions version. Do not restore permissive rules or the retired lowercasing script.

No production migrations, deployments, pushes or data changes are part of the local implementation. The migration has pure-planner and emulator coverage; it has not been run against production. Live OAuth, real push delivery and legacy production data quality remain rollout verification requirements.

Firebase references: [field access](https://firebase.google.com/docs/firestore/security/rules-fields), [query authorization](https://firebase.google.com/docs/firestore/security/rules-query), [atomic cross-document validation](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Local results (17 October 2026)

Privacy step 698ba81 passed 41 application tests, 13 integration checks and the production build. Final implementation passed 46 application tests, 24 integration/security checks (Firestore/Storage emulators plus mocked trusted-function/migration checks), production build, and Chromium offline/reload/version-update smoke checks. Tests include genuine competing Firestore transactions and an offline browser attempting the same borrowing operation used by the app. No production credentials were used for testing. Existing Bootstrap Sass deprecations and the tool-sheet optional-chain compiler warning remain.

## Front-end rollout compatibility (17 October 2026)

### All tools show “Unknown owner”

Publishing the client to Pages does not deploy Firebase rules or backfill `publicProfiles`.
If inventory loads but every owner is unknown, verify that signed-in members can read
`publicProfiles/{ownerId}` and that those documents exist. A permission-denied read
means the public-profile rules still need deploying; a missing document means the
profile backfill is pending. Signing in creates only that member's profile, not
every existing owner's profile.

Complete the Privacy step above with trusted administrator credentials. From `functions`,
set `GCLOUD_PROJECT=shed-3fc03`, run `node scripts/migrate-profile-privacy.js` to review
the dry run, resolve conflicts, then run `node scripts/migrate-profile-privacy.js --apply`
in the maintenance window. Verify that tool owner IDs match public profile document
IDs exactly, then refresh inventory. Do not expose private `users` documents to fix
display names. The client now retains a tool's legacy owner label when available,
fetches display profiles from the server, and retries missing profiles on refresh
instead of retaining a missing result for five minutes. Tools without either source
still require the backend rollout to display a name.

A browser inspection found that the deployed Firebase rules still lacked publicProfiles, while the published client already used that collection. A rejected profile write cleared the client's authenticated account even though Firebase Auth was still signed in. The account then vanished from the shell, removing its header/navigation and desktop container styling, while rejected public-profile reads prevented inventory rendering.

The compatibility fix retains Firebase authentication when profile synchronization fails and treats permission-denied display-profile reads as missing optional metadata. It never falls back to another member's private users record, still reports actual inventory-read failures, and retries profile reads on later refreshes. Explicit sign-out events continue clearing the account. Public-page content is now centered independently of authentication. This front-end compatibility does not replace the pending Firebase rules/data rollout or bypass reservation migration checks.

Verified locally: 50 application tests, production build, and browser rendering with the real shell/state/inventory and local fixtures at 1920, 768 and 390 px. The browser check asserts loaded cards, signed-in header, centered content, grid wrapping, no horizontal page overflow, and signed-out desktop centering. It forbids Firebase initialization and blocks nonlocal requests except fonts; it does not claim live production inventory was restored. Both CI workflows now run npm run test:layout. After releasing this fix, reload the app; signing out and back in alone does not repair the old client's rules mismatch.

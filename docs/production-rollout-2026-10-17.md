# Production rollout: 17 October 2026

## Source and backups

All existing remote branches were merged into `origin/main`, at `72eba39`
(app version 1.17.3). The corresponding Pages workflow completed successfully.
Production operations used the user's signed-in Chrome session and authorized
Google Cloud Shell, against `shed-3fc03` only.

Created the EU bucket `gs://shed-3fc03-rollout-backups` with uniform bucket-level
access and enforced public-access prevention. Both complete Firestore exports
reported `done: true` and `operationState: SUCCESSFUL`, with 125 documents:

- `gs://shed-3fc03-rollout-backups/pre-migration-20261017`
- `gs://shed-3fc03-rollout-backups/maintenance-20261017`

The second export ran under temporary deny-all Firestore rules. App access was
paused approximately 14:31–14:36 UTC, then restored with the repository's final
restrictive rules. The old permissive rules were not restored.

## Deployment and data migration

Deployed all three notification functions to Node.js 22, second generation,
in `europe-west1`: `notifyOwnerOnBorrow`, `notifyOwnerOnReturn`, and
`notifyUsersOnToolRequest`. Each update reported success. Enabled the retry
policy already implemented by the event deduplication and delivery-receipt code.
Deployed `storage.rules`, `firestore.rules` and `firestore.indexes.json`.
The notifications recipient/date composite index reported `READY`.

Dry runs before and during maintenance found no borrowing or identity conflicts.
Applied the borrow-state migration, category seed, and profile-privacy migration.
The category entrypoint initially failed because its shared JSON import traversed
one directory too far. Corrected that path in the rollout checkout, reran it
successfully, and made the same correction in the repository with an executable
dry-run regression test. Existing categories were preserved.

Independent post-migration verification found:

- 71 tools: 66 available, 5 deleted; all inventory invariants passed.
- 7 historical loans retained and canonicalized; zero active loans.
- `appConfig/inventory.schemaVersion == 1`, with server `verifiedAt`
  `2026-10-17T14:33:17.237Z` after transactional verification.
- 8 public profiles, matching the 8 private account document IDs, each containing
  only `displayName`, `firstName`, `lastName` and `photoURL`.
- 14 categories, including every fixed category and both discovered categories.
- No notification recipient updates needed; all 15 notifications were retained.

Notification and category document update timestamps remained unchanged during
the migration. One account write occurred at 14:32:08 UTC during initial rule
propagation, before migration; no private account writes followed before the
post-migration check. A preflight hash therefore did not establish that every
private account document was unchanged throughout maintenance. Migration code
does not write private `users` documents, and those documents were retained.

## Verification and limits

The production browser loaded all 66 inventory cards with zero unknown owners
and no remaining pagination loader, and opened a tool sheet
with the Borrow action available, without the reconciliation warning. Firebase's
production rules simulator denied a cross-account private profile read, allowed
the account's own private profile read, and allowed a cross-account public
display-profile read. These were simulations, not account impersonation.

Local validation of the category-path correction passed all 65 application tests,
the actual seed entrypoint dry run, and its new regression test. The first app
test attempt could not start tests because Windows sandbox temporary-file renames
were blocked; the rerun outside that sandbox passed.

The deployment did not exercise real borrow/return transactions, two real signed-in
accounts, real push delivery, or sign-out token cleanup. Those remain live smoke
checks; the existing CI/emulator tests cover the corresponding transaction and
permission paths. No test notifications were sent and no historical loans or
uploaded images were deleted. This rollout created one-time exports, not a
recurring backup schedule.

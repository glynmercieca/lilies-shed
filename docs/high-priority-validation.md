# High-priority reliability work

Local work only: no deployment, push, or production data changes.

## 1. Test/deployment baseline

The category fixtures and notification snapshot fields were already repaired before
this work. CI now uses `npm ci`, runs the test suite before building/uploading a
deployment artifact, and checks pull requests and non-main pushes. The app-shell
smoke test also renders the shell.

Validation: clean `npm ci`; 28 tests across 7 files; production build.
Initial bundle baseline: 1.75 MB raw / 365.02 kB estimated transfer.
Windows tests need execution outside the restricted sandbox because Vitest's
temporary-file rename fails there. Bootstrap Sass deprecation warnings remain.
The clean install reports dependency audit findings; no automatic dependency
upgrades were applied as part of this scoped work.

## 2. Atomic borrowing

Each tool has `borrowStateVersion: 1` and `activeLoanId` (null when free).
The app creates a loan and reserves its tool in one server transaction. Returns
release the same reservation in a transaction. Rules require both sides of each
transition and prevent edits/deletes during a loan, borrower forgery, standalone
loan creation, and unrelated-user returns. Other permissions are outside scope.

Validation: 28 app tests (including rendered shell), production build, and 8 real
Firestore emulator integration tests exercising the shared app operations and
rules: competing borrowers, return/reborrow, rejected writes and rollback,
borrow/delete race, ownership, missing/deleted tools, migration and legacy loans.
The emulator uses a demo project, never the production Firebase project.

### Later rollout requirements (not performed)

Use a maintenance window with clients closed/borrowing disabled for the ENTIRE
migration, including retries. First deploy the reservation rules so old clients
cannot create unreserved loans or change unmigrated tools. Using a privileged
environment with `npm ci --prefix functions` and Application Default Credentials,
set `GCLOUD_PROJECT` explicitly and run
`node functions/scripts/migrate-borrow-state.js` for a dry run. Resolve every
reported duplicate, orphaned active loan, missing borrower or ambiguous tool ID
manually. Then run with `--apply`. This canonicalizes legacy `itemId`/numeric IDs
to tool document IDs and preserves the existing active loan as the reservation.
It retains loan history, including returned loans. Verify the result before
deploying/opening the new client. Do not run the migration against active clients:
it uses a preflight snapshot and deliberately requires a maintenance window.
Migration writes are resumable but are not an all-database atomic operation.
Unmigrated tools fail closed with a reconciliation message.

CI now also runs the emulator suite with Java 21. Local Windows execution needs
Java 21 on PATH (a portable ignored runtime was used for this validation).
Authenticated live-browser verification was unavailable; no production records
were changed.

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

## 3. Database work reduction

Normal loading no longer writes the 12 fixed categories. A privileged one-time
setup script, `node functions/scripts/seed-tool-categories.js`, previews the seed;
use `--apply` with `GCLOUD_PROJECT` set to create missing categories only. It uses
the same category JSON as the app and preserves existing documents.

The borrow-state migration now also initializes `latestLoanId`. Borrow operations
advance that pointer atomically, with rule enforcement. Loading fetches only the
active/latest referenced loan documents in batches of 30. Unmigrated catalogs
retain the full-history fallback until migration. History stays in Firestore;
latest-loan selection is chronological rather than document-query order. Owner
and borrower profiles are loaded by referenced ID, cached for five minutes, as
are categories. New category discovery invalidates its cache. Tool ID allocation
uses the existing counter and only a one-document maximum lookup for bootstrap.

Successful add/edit/delete/borrow/return operations reload only the affected
tool and loan summaries, retaining notification state and list paging.
Overlapping full refreshes share one operation per account, and old-account
results are discarded. Full catalog reads remain intentional to preserve global
search/category/count behavior: 18-item paging is still rendering pagination.

Validation: 34 app tests across 8 files, rendered app shell, production build,
and all 8 emulator integration tests. An instrumented service fixture with
60 tools, 1,000 historical loans and 100 possible profiles reads 122 tool/loan/
profile documents instead of 1,160 (89.5% fewer), excluding notification/category
reads common to the comparison. A warm targeted mutation refresh reads 2
documents, and reference-data reads are reused. Category writes per refresh:
12 to zero. These are fixture measurements, not production billing estimates.
Statistics continue to use active loans; names, category filtering, owner search,
borrowed counts and latest-loan data have behavior checks. Profiles may display
cached names for up to five minutes. Run the final migration version during the
rollout window described above to get the history-read reduction.

## 4. Startup loading

Pages now use lazy route components while retaining their guards. The root state
service imports dialog classes as types and loads UI code on demand. Route-driven
forms, sheets and previews share one on-demand entry point. A shared pending load
prevents duplicate overlays, and the URL is re-read when loading completes so an
outdated navigation cannot reopen a dismissed overlay. Return/delete/edit and
notification-opt-in dialogs load on demand as well. Initial bundle budgets were
tightened to warn at 1.5 MB and fail at 1.65 MB.

Measured production initial bundle: 1.40 MB raw / 308.62 kB estimated transfer,
versus the current pre-lazy build of 1.75 MB / approximately 366 kB (about 20%
raw and 16% transfer reduction). The original review's 1.94 MB figure was not used
as the comparison baseline. Lazy chunks are downloaded when their features open.

Validation: 36 app tests, all 8 emulator integration tests, production build.
Router smoke tests render shed, borrowed, my-tools, options, about and privacy;
exercise protected-route redirects including the return URL; open add/request
dialog deep links; and open/close the tool-sheet plus image-preview deep link
without duplicate overlays. These use mocked authentication and data services.

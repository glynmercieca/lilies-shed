# Remaining optimization work

Branch: `codex/remaining-project-optimizations`, based on main 2521ea4.

## Verified changes

1. Date-added sorting uses `createdAt`, with deterministic ID ordering only for legacy records without a usable timestamp. No dates are fabricated for old tools.
2. Add/edit preserve discovered category IDs and canonical names. Unknown categories fail with a useful message instead of silently changing to Other.
3. Server-confirmed tool changes trigger targeted reads, update open tool sheets, and preserve list paging. Cached/pending writes do not verify availability. Visible-window focus refreshes are throttled to 30 seconds; listeners are released on sign-out/account changes/destruction. Existing transactions remain the authority for borrowing.
4. Inventory, category and notification signals are independent. Regression tests verify that notification/read changes preserve the exact decorated-tool and filtered-list references. Cards, tool details and inventory pages use OnPush change detection. The unit suite, production build and desktop/tablet/mobile browser checks pass.
5. Storage and image preparation load only for an upload; the Messaging SDK loads when notification functionality is requested. Build metadata confirms neither Firebase Storage nor Messaging contributes bytes to the main chunk. Initial assets are now 1.36 MB raw / 297.40 kB estimated transfer (review baseline 1.40 MB / 308.87 kB). Offline installation still deliberately prefetches lazy code to preserve offline routes. The unit suite and offline/update browser checks pass.
6. Legacy loan reads now query only the relevant tool/document aliases in batches of 30, deduplicating overlapping results. A legacy tool no longer triggers an unrestricted loan-history scan. After trusted migration verification, inventory reads/listeners query `deleted == false`; until then, missing legacy deletion flags remain visible through the compatibility query. The configuration gate costs one cached document read per five minutes. Full active inventory loading remains deliberate for global search, category counts and ownership views; database pagination would require a different search/count design.

### Enabling active-only inventory queries

Deploy the accompanying rules before enabling this read mode. During the existing borrow-migration maintenance window, install the locked backend dependencies (`npm ci --prefix functions`), explicitly set `GCLOUD_PROJECT`, and run `functions/scripts/migrate-borrow-state.js` without `--apply` to inspect its plan. Resolve conflicts before applying. The updated `--apply` migration independently rereads tools/loans in a transaction and verifies canonical links, normalized deletion flags and reservation pointers before publishing `appConfig/inventory` schema version 1. Clients cannot write that marker. Reload clients after migration. Re-running migration requires the same paused-write maintenance window; it is not an online repair operation.

The emulator checks execute the real dry-run and apply scripts, prove dry-run writes no marker, verify a legacy active tool remains queryable, exclude a legacy deleted tool, and reject client marker writes. No production migration has been run. Unit suite: 60 tests; integration suite: 29 checks; production build passed for this step.

## Backend dependency security

Installing the locked backend dependencies exposed 15 audit findings, including a critical proxy-addr advisory. Backend dependencies are upgraded to Firebase Admin 14.5 and Functions 7.4, with the remaining compatible transitive patch applied. The production runtime target is now Node 22, matching the repository pin and Admin 14 requirements. All application scripts already use the supported modular Admin entry points. Backend module loading and all 29 integration/security checks pass under the pinned Node 22.22.3 runtime. `npm audit --prefix functions --omit=dev` reports zero vulnerabilities at verification time. Deploying the functions will apply the new runtime; nothing has been deployed by this work.

## Image lifecycle cleanup

New detail/thumbnail uploads retain an internal handle until their tool write commits. Failed writes discard only those new objects; a failed list refresh after a committed write never deletes saved images or leaves the add form open for an accidental duplicate save. Partial uploads wait for both siblings before removing successful objects. Existing/reused URLs are never accepted as a client cleanup handle. Cleanup failures retain the original save/upload error and can be recovered by maintenance.

`functions/scripts/cleanup-tool-images.js` is a trusted maintenance tool, dry-run by default. Set both `GCLOUD_PROJECT` and `STORAGE_BUCKET` explicitly. It scans all tool references, including soft-deleted tools, and only proposes recognized generated detail/thumbnail objects that are unreferenced and at least seven days old based on creation/update age. Legacy objects, recent uploads, foreign paths and referenced objects are protected. Review its dry-run output. Apply only during paused application writes using `--apply --writes-paused`; the tool rereads references before deletion and uses each planned object's generation as a deletion precondition. This avoids deleting an object rewritten since the scan. Do not run it during active writes: Firestore references and Storage deletion cannot be made one atomic operation. No production objects have been inspected or deleted by this work.

Upload and save-failure regressions pass in the Angular suite. Cleanup-planner and dry-run/apply safeguards are covered by local tests with fake bucket APIs; actual production bucket deletion is intentionally not tested. Final suite at this step: 65 unit tests and 31 integration/security/planner checks passed; initial production assets 1.36 MB / 297.85 kB estimated transfer.

## Notification delivery

Each Firestore event ID maps to one deterministic notification document. Create-only writes preserve its original timestamp on replay. Server-only `notificationDeliveries` records lease delivery for six minutes (longer than the configured five-minute function timeout), serializing concurrent invocations. Per-token hashed receipts record successful and permanently invalid destinations. Transient failures retry only unfinished tokens; batches contain at most 500 unique tokens. Disabled/inactive accounts are skipped and invalid-token cleanup is retriable. Function retries are enabled.

Push delivery cannot be made exactly once across Firestore and FCM: a process can stop after FCM accepts a send and before its receipt is written. Retrying that window can resend; stable browser notification tags replace the same displayed notification, and the foreground client suppresses repeated event IDs. No claim of exactly-once external delivery is made.

Deploy the updated functions with the client to enable this behavior. The new delivery paths deny client access through the existing default-deny rules. No production deployment or data migration is performed by this work.

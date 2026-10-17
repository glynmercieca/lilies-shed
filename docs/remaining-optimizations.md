# Remaining optimization work

Branch: `codex/remaining-project-optimizations`, based on main 2521ea4.

## Verified changes

1. Date-added sorting uses `createdAt`, with deterministic ID ordering only for legacy records without a usable timestamp. No dates are fabricated for old tools.
2. Add/edit preserve discovered category IDs and canonical names. Unknown categories fail with a useful message instead of silently changing to Other.
3. Server-confirmed tool changes trigger targeted reads, update open tool sheets, and preserve list paging. Cached/pending writes do not verify availability. Visible-window focus refreshes are throttled to 30 seconds; listeners are released on sign-out/account changes/destruction. Existing transactions remain the authority for borrowing.
4. Inventory, category and notification signals are independent. Regression tests verify that notification/read changes preserve the exact decorated-tool and filtered-list references. Cards, tool details and inventory pages use OnPush change detection. The unit suite, production build and desktop/tablet/mobile browser checks pass.
5. Storage and image preparation load only for an upload; the Messaging SDK loads when notification functionality is requested. Build metadata confirms neither Firebase Storage nor Messaging contributes bytes to the main chunk. Initial assets are now 1.36 MB raw / 297.40 kB estimated transfer (review baseline 1.40 MB / 308.87 kB). Offline installation still deliberately prefetches lazy code to preserve offline routes. The unit suite and offline/update browser checks pass.

## Notification delivery

Each Firestore event ID maps to one deterministic notification document. Create-only writes preserve its original timestamp on replay. Server-only `notificationDeliveries` records lease delivery for six minutes (longer than the configured five-minute function timeout), serializing concurrent invocations. Per-token hashed receipts record successful and permanently invalid destinations. Transient failures retry only unfinished tokens; batches contain at most 500 unique tokens. Disabled/inactive accounts are skipped and invalid-token cleanup is retriable. Function retries are enabled.

Push delivery cannot be made exactly once across Firestore and FCM: a process can stop after FCM accepts a send and before its receipt is written. Retrying that window can resend; stable browser notification tags replace the same displayed notification, and the foreground client suppresses repeated event IDs. No claim of exactly-once external delivery is made.

Deploy the updated functions with the client to enable this behavior. The new delivery paths deny client access through the existing default-deny rules. No production deployment or data migration is performed by this work.

# Medium-priority optimizations

## Images

New JPEG, PNG and WebP selections are limited to 12 MiB and decoded in the browser.
Canvas generates a detail image with a maximum edge of 1600 pixels (WebP quality
0.82) and a 480-pixel thumbnail (quality 0.75), without upscaling. Transparency is
preserved; browsers that cannot encode WebP fall back to PNG. Both stored files
must be at most 2 MiB. The app rejects unsupported or undecodable images rather
than uploading the original. Animated PNG/WebP input becomes a static photo.

The existing `image` field remains the detail URL. The optional `thumbnail` field
is used by listing cards, falling back to `image` for older records. Editing a
record without replacing its image keeps both URLs; removing the image clears
both. No existing images are rewritten or deleted. Storage rules retain signed-in
reads, owner-only writes/deletes, and validate MIME type and upload size.

## Bootstrap

`src/bootstrap.scss` includes foundations, typography, images, containers, grid,
list groups, helpers and the full responsive utility map. Bootstrap JavaScript
and unused component CSS are removed. Angular Material supplies interactions.
Retaining all utilities avoids problems with Angular's conditional class bindings.
Bootstrap 5.3's Sass imports currently produce upstream deprecation warnings.

Production initial bundle measurements (13 October 2026):

| | Before | After |
| --- | ---: | ---: |
| Initial raw | 1.94 MB | 1.74 MB |
| Estimated transfer | 398.58 kB | 364.88 kB |
| Styles raw | 250.24 kB | 129.78 kB |
| Bootstrap script raw | 80.45 kB | 0 |

The initial budget now warns at 1.8 MB and fails at 2 MB. Browser checks used the
actual card, edit dialog and detail dialog components with local sample data and
production CSS: two listing columns at 390 px, three at 1024 px, edit-dialog
layouts at both widths, category selection, and mobile detail-dialog closure.
This was component-level visual verification, not a signed-in production walkthrough.

## Notifications and release prerequisites

Personal and broadcast queries each read at most 50 documents, using
`recipientId` plus descending `createdAt`. Personal queries include the current UID
and its lowercase form, preserving the old case-insensitive identity matching for
normalized legacy records. Broadcasts accept empty-string and null recipients.
Both streams are retained, deduplicated by document ID and sorted by timestamp,
with document ID as a stable tie break. The drawer still displays the newest ten;
unread counts and mark-all use the bounded combined history of at most 100.

Live updates wait for initial results from both streams and replace each stream's
results independently. Closing the drawer, signing out, changing accounts, or
destroying the state service releases listeners. In-flight refresh results from
another account are discarded.

Read IDs remain in the existing user field. A transaction merges concurrent marks
and caps the list at 500, protecting read marks for the current 100-record window.
Older histories are compacted on the next mark action. Profile updates that leave
an oversized legacy history unchanged still pass the rules. Read marks outside
the retained history can eventually expire; they do not affect the current loaded
window. Dates and notification IDs remain unchanged.

Before a future authorized release:

1. Publish the composite index in `firestore.indexes.json` and wait for it to finish
   building before publishing the app. `firebase.json` references the index file.
2. Audit old recipients using the script below. Firestore cannot query documents
   whose `recipientId` field is absent. Current functions already write explicit
   recipient IDs or `''`; the script supports missing fields, nulls, whitespace
   and old mixed-case values. If the audit finds changes, review and apply them
   before switching clients to bounded queries. It changes only `recipientId`,
   preserving existing read marks, IDs and timestamps.
3. Publish the storage and Firestore rule changes with the app. No notification
   read permissions were widened or restricted. Old clients trying to grow read
   histories above 500 will need to refresh to the new app.

From `functions`, with dependencies installed and Application Default Credentials
configured for the intended project:

```sh
# Read-only audit, the default:
node scripts/normalize-notification-recipients.js --project PROJECT_ID
# Explicit write mode, only after reviewing the audit:
node scripts/normalize-notification-recipients.js --project PROJECT_ID --apply
```

The script scans in pages of 400 and uses bounded write batches. It was syntax
checked locally; neither audit nor write mode was run against Firebase. Rules and
indexes have not been deployed or exercised against an emulator/live database.

## Validation

`npm test -- --watch=false`: 24 tests pass, including query constraints, combined
ordering, independent live stream updates, unsubscribe/late-callback behavior,
transactional history compaction, image bounds and image encoding.
`npm run build`: production build passes. Baseline test repairs add missing
category/snapshot fields and configure a saved theme for JSDOM's absent matchMedia
API. The test runner needs access to its temporary cache outside the restricted
sandbox on this Windows setup. An existing tool-sheet optional-chain warning
remains.

All changes are local. No Firebase deployment, migration, publication or merge was
performed.


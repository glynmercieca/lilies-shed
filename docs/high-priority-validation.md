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

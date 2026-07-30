# Release Chain Before

`SOURCE = COMMIT = ARTIFACT = RUNTIME`: **NO**.

- Source is dirty and contains 32 migrations.
- HEAD does not contain the dirty source changes.
- The checked-in `.release/release-manifest.json` is stale and dirty.
- The existing clean canary artifact represents 30 migrations.
- The operational runtime is older and does not expose current provenance.
- No remote exists, so remote synchronization and CI cannot be evaluated.

The release builder correctly uses `git archive` from a commit. Closure therefore requires classified commits before a clean artifact can be produced.


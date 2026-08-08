# Controlled CI exception (superseded)

- Reason: `EXTERNAL_GITHUB_ACTIONS_BILLING`
- Phase 3 source defect identified: false
- Remote CI pass claimed during exception: false
- Local mirror used: true
- Merge allowed: false
- Deploy allowed: false
- Exception scope: development only

The exception is no longer active. GitHub Actions resumed for correction head `8e9ceeddb251fad9cd7bea70c6c91051f4fb10a2`; run `31243168814` completed successfully across `quality`, immutable artifact, ephemeral E2E and recovery drill. No merge or deployment authorization follows from that PASS.

Phase 3 PR #8 remains draft/open at immutable head `1db4f3b73e7783471b5d5b1a5b88d46841cd49af`. Phase 3 must pass remote CI and merge first; Phase 4 must then be retargeted/rebased to main, fully revalidated and reviewed as a Phase-4-only diff.

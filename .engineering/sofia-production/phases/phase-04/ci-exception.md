# Controlled CI exception

- Reason: `EXTERNAL_GITHUB_ACTIONS_BILLING`
- Phase 3 source defect identified: false
- Remote CI pass claimed: false
- Local mirror used: true
- Merge allowed: false
- Deploy allowed: false
- Exception scope: development only

Phase 3 PR #8 remains draft/open at immutable head `1db4f3b73e7783471b5d5b1a5b88d46841cd49af`. When billing is restored, Phase 3 must pass remote CI and merge first; Phase 4 must then be retargeted/rebased to main, fully revalidated and reviewed as a Phase-4-only diff.

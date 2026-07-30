# Release Chain - Final Gate

| Boundary | Result | Evidence |
| --- | --- | --- |
| Source migration identity | PASS | 32 ordered names/checksums; fresh 3x and upgrade PASS |
| Source contracts | PASS | Final frozen rerun 157/157, exit 0, 660.182 s |
| Source runtime | PASS | Sanitized `/version`, liveness, exact readiness and negative injections |
| Source to commit | FAIL | HEAD does not contain the classified dirty source |
| Commit to artifact | FAIL | No eligible candidate commit; clean build intentionally not attempted |
| Artifact to runtime | FAIL | Existing clean canary is historical at 30 migrations |
| Remote/CI | FAIL | Repository has no configured remote |

`SOURCE = COMMIT = ARTIFACT = RUNTIME`: **NO**.

The dirty validation image proves that the current snapshot can package 32 migrations, uses a non-root user and embeds safe flags. It is explicitly ineligible for production and cannot substitute for a clean commit artifact.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/publish-ghcr.yml'), 'utf8');

test('publication is manual, main-bound and restricted to the authorized release candidate', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUTHORIZED_RELEASE_COMMIT: 8b4020e852e6774fdd6e3ff93221b9628a399cae/);
  assert.match(workflow, /test "\$RELEASE_COMMIT" = "\$AUTHORIZED_RELEASE_COMMIT"/);
  assert.match(workflow, /test "\$WORKFLOW_REF" = refs\/heads\/main/);
  assert.match(workflow, /ref: \$\{\{ inputs\.release_commit \}\}/);
  assert.doesNotMatch(workflow, /\bpush:\s*(?:\n|$)/);
});

test('GITHUB_TOKEN receives only job-scoped package publication and OIDC signing permissions', () => {
  assert.match(workflow, /permissions:\n\s+contents: read\n\nconcurrency:/);
  assert.match(workflow, /publish:[\s\S]*?permissions:\n\s+contents: read\n\s+packages: write\n\s+id-token: write/);
  assert.match(workflow, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /\bPAT\b|REGISTRY_PASSWORD|packages: admin/);
});

test('only the owner-authorized GHCR repositories can be published', () => {
  assert.match(workflow, /API_REPOSITORY: ghcr\.io\/devops-solutions-ia\/2x1-burger-co-api/);
  assert.match(workflow, /WEB_REPOSITORY: ghcr\.io\/devops-solutions-ia\/2x1-burger-co-web/);
  assert.match(workflow, /SOURCE_REPOSITORY: https:\/\/github\.com\/DevOps-Solutions-IA\/2X1-Burger-Co/);
  assert.doesNotMatch(workflow, /:latest\b|:main\b/);
});

test('candidate publication repeats reproducibility, dependency and secret gates', () => {
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm audit --prod --audit-level=low/);
  assert.match(workflow, /\.\/infra\/release\/secret-scan\.sh/);
  assert.equal((workflow.match(/build-artifacts\.sh/g) ?? []).length, 2);
  assert.match(workflow, /verify-artifact-reproducibility\.mjs/);
});

test('published images preserve runtime content and bind all required OCI labels', () => {
  for (const label of ['source', 'revision', 'created', 'title']) {
    assert.match(workflow, new RegExp(`org\\.opencontainers\\.image\\.${label}`));
  }
  assert.match(workflow, /runtime-artifact-digest\.mjs filesystem \/app/);
  assert.match(workflow, /test "\$actual_content" = "\$expected_content"/);
  assert.match(workflow, /RepoDigests/);
});

test('high and critical findings fail publication before keyless signing and attestations', () => {
  assert.equal((workflow.match(/aquasecurity\/trivy-action@b6643a29fecd7f34b3597bc6acb0a98b03d33ff8/g) ?? []).length, 2);
  assert.equal((workflow.match(/severity: HIGH,CRITICAL/g) ?? []).length, 2);
  assert.equal((workflow.match(/exit-code: '1'/g) ?? []).length, 2);
  const lastScan = workflow.lastIndexOf('Scan Web image');
  const signing = workflow.indexOf('cosign sign --yes');
  assert.ok(lastScan > 0 && signing > lastScan);
  assert.match(workflow, /cosign attest --yes --type cyclonedx/);
  assert.match(workflow, /cosign attest --yes --type slsaprovenance/);
  assert.match(workflow, /cosign verify --certificate-identity/);
});

test('workflow never deploys or activates operational providers', () => {
  assert.doesNotMatch(workflow, /\bssh\b|docker compose|prisma migrate|WHATSAPP|BOLD|AUTO_REPLY|production deploy/i);
});

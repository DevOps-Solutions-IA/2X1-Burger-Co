/* eslint-disable security/detect-non-literal-fs-filename -- Architecture test walks the repository-owned src tree. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const sourceRoot = resolve(process.cwd(), 'src');

function typescriptFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = resolve(root, entry);
    return statSync(path).isDirectory()
      ? typescriptFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });
}

function sourcePath(file: string): string {
  return relative(sourceRoot, file).replaceAll('\\', '/');
}

function isExecutableSource(file: string): boolean {
  const path = sourcePath(file);
  return !path.endsWith('.spec.ts') && !path.endsWith('.test.ts') && !path.startsWith('tests/');
}

describe('Phase 8 CRM architecture boundaries', () => {
  const executableFiles = typescriptFiles(sourceRoot).filter(isExecutableSource);

  it('keeps lead, lead-history and note persistence mutations in the canonical repository', () => {
    const modelMutation = /\b(?:crmLead|crmLeadStageHistory|crmNote)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
    const rawSqlMutation = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(?:crm_leads|crm_lead_stage_history|crm_notes)"?/i;
    const mutationAuthorities = executableFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return modelMutation.test(source) || rawSqlMutation.test(source);
      })
      .map(sourcePath)
      .sort();

    expect(mutationAuthorities).toEqual([
      'modules/sofia/crm/phase8-crm.repository.ts',
    ]);
  });

  it('limits trusted customer-resolution capability imports and issuance to approved boundaries', () => {
    const capabilityModule = /crm-customer-resolution\.capability/;
    const capabilityImporters = executableFiles
      .filter((file) => capabilityModule.test(readFileSync(file, 'utf8')))
      .map(sourcePath)
      .sort();
    const issuers = executableFiles
      .filter((file) => /TrustedCrmCustomerResolutionCapability\s*\.\s*issue\s*\(/.test(readFileSync(file, 'utf8')))
      .map(sourcePath)
      .sort();

    expect(capabilityImporters).toEqual([
      'modules/sofia/contracts/sofia-contract.adapters.ts',
      'modules/sofia/sofia-whatsapp.service.ts',
      'modules/sofia/crm/sofia-crm.service.ts',
    ].sort());
    expect(issuers).toEqual([
      'modules/sofia/contracts/sofia-contract.adapters.ts',
      'modules/sofia/sofia-whatsapp.service.ts',
    ].sort());
  });

  it('forbids controllers from importing or issuing trusted customer-resolution capabilities', () => {
    const violatingControllers = executableFiles
      .filter((file) => sourcePath(file).endsWith('.controller.ts'))
      .filter((file) => /crm-customer-resolution\.capability|TrustedCrmCustomerResolutionCapability/.test(
        readFileSync(file, 'utf8'),
      ))
      .map(sourcePath)
      .sort();

    expect(violatingControllers).toEqual([]);
  });
});

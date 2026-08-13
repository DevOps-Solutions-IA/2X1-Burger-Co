import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { SettingsService } from './settings.service';

describe('SettingsService reserved internal settings', () => {
  const findMany = jest.fn();
  const upsert = jest.fn();
  const transaction = jest.fn();
  const auditLog = jest.fn();
  const prisma = {
    setting: { findMany, upsert },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: auditLog } as unknown as AuditService;
  const service = new SettingsService(prisma, audit);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    upsert.mockResolvedValue({ key: 'business.profile', value: {} });
    transaction.mockImplementation((operations) => Promise.all(operations));
    auditLog.mockResolvedValue({ id: 'audit-1' });
  });

  it('does not expose the internal CRM hash generation fingerprint in settings listings', async () => {
    await service.findAll();

    expect(findMany).toHaveBeenCalledWith({
      where: { key: { notIn: ['SOFIA_CRM_HASH_GENERATION_FENCE'] } },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  });

  it('rejects an attempt to overwrite the CRM generation fence before any database or audit mutation', async () => {
    await expect(service.update({
      items: [{
        key: 'SOFIA_CRM_HASH_GENERATION_FENCE',
        category: 'sofia_crm_security',
        description: 'operator overwrite attempt',
        value: { activeFingerprint: '0'.repeat(64), retiredFingerprints: [] },
      }],
    }, 'operator-1')).rejects.toBeInstanceOf(ForbiddenException);

    expect(upsert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects the full update batch when a reserved key is mixed with an ordinary setting', async () => {
    await expect(service.update({
      items: [
        { key: 'business.profile', value: { name: '2X1 Burger Co' } },
        { key: 'SOFIA_CRM_HASH_GENERATION_FENCE', value: { activeFingerprint: '0'.repeat(64) } },
      ],
    }, 'operator-1')).rejects.toThrow('SETTING_KEY_RESERVED');

    expect(upsert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('keeps ordinary settings updates available', async () => {
    await service.update({
      items: [{ key: 'business.profile', value: { name: '2X1 Burger Co' } }],
    }, 'operator-1');

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'business.profile' },
    }));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
  });
});

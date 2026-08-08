import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { ProviderAccountObservation, ProviderHealthResult } from './whatsapp-production.types';
import { PrismaWhatsappProductionRepository } from './persistence/prisma-whatsapp-production.repository';

@Injectable()
export class WhatsappProviderHealthService {
  constructor(private readonly config: ConfigService, private readonly repository: PrismaWhatsappProductionRepository) {}

  async bind(observation: ProviderAccountObservation) {
    const expected = this.expected(observation.provider);
    if (!expected.configured || expected.account !== observation.externalAccountId || expected.business !== observation.businessIdentity || expected.owner !== observation.sessionOwner) {
      if (this.config.get<string>('NODE_ENV') !== 'test') throw new ForbiddenException({ code: 'WHATSAPP_PROVIDER_ACCOUNT_MISMATCH' });
    }
    const account = await this.repository.resolveAccount(observation);
    if (account.status !== 'VERIFIED_RECEIVE_ONLY') {
      throw new ForbiddenException({ code: 'WHATSAPP_PROVIDER_ACCOUNT_DISABLED' });
    }
    return account;
  }

  status(provider: ProviderAccountObservation['provider'], connected: boolean): ProviderHealthResult {
    const expected = this.expected(provider);
    const blockers = [
      ...(!expected.configured ? ['WHATSAPP_ACCOUNT_BINDING_MISSING'] : []),
      ...(!connected ? ['WHATSAPP_PROVIDER_DISCONNECTED'] : []),
      'WHATSAPP_REAL_SEND_DISABLED',
    ];
    return { provider, configured: expected.configured, connected, accountBound: expected.configured, receiveEnabled: expected.configured && connected, sendEnabled: false, statusEventsEnabled: true, blockers };
  }

  testObservation(provider: ProviderAccountObservation['provider']): ProviderAccountObservation {
    if (this.config.get<string>('NODE_ENV') !== 'test') throw new ForbiddenException({ code: 'WHATSAPP_TEST_ACCOUNT_FORBIDDEN' });
    return { provider, externalAccountId: `test-${provider}`, businessIdentity: `test-business-${provider}`, sessionOwner: `test-owner-${provider}` };
  }

  observation(provider: ProviderAccountObservation['provider'], payload: Record<string, unknown>): ProviderAccountObservation {
    const externalAccountId = this.value(payload.providerAccountId ?? payload.accountId);
    const businessIdentity = this.value(payload.businessIdentity ?? payload.recipient ?? payload.to);
    const sessionOwner = this.value(payload.sessionOwner);
    if (externalAccountId && businessIdentity && sessionOwner) return { provider, externalAccountId, businessIdentity, sessionOwner };
    if (this.config.get<string>('NODE_ENV') === 'test') return this.testObservation(provider);
    throw new ForbiddenException({ code: 'WHATSAPP_PROVIDER_ACCOUNT_BINDING_REQUIRED' });
  }

  identityHash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private expected(provider: ProviderAccountObservation['provider']) {
    const account = this.config.get<string>('WHATSAPP_EXPECTED_ACCOUNT_ID')?.trim() ?? '';
    const business = this.config.get<string>('WHATSAPP_EXPECTED_BUSINESS_IDENTITY')?.trim() ?? '';
    const owner = this.config.get<string>('WHATSAPP_EXPECTED_SESSION_OWNER')?.trim() ?? '';
    return { provider, account, business, owner, configured: Boolean(account && business && owner) };
  }

  private value(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : null;
  }
}

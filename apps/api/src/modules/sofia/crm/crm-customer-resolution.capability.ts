export type TrustedCrmCustomerResolutionSource =
  | 'SOFIA_DOMAIN_ADAPTER'
  | 'WHATSAPP_INBOUND';

export class TrustedCrmCustomerResolutionCapability {
  readonly kind = 'TRUSTED_CRM_CUSTOMER_RESOLUTION';

  private constructor(
    readonly actorId: string,
    readonly source: TrustedCrmCustomerResolutionSource,
  ) {
    Object.freeze(this);
  }

  static issue(
    actorId: string,
    source: TrustedCrmCustomerResolutionSource,
  ): TrustedCrmCustomerResolutionCapability {
    const normalizedActorId = actorId.trim();
    if (!normalizedActorId || normalizedActorId.length > 128) {
      throw new Error('CRM_TRUSTED_ACTOR_ID_INVALID');
    }
    return new TrustedCrmCustomerResolutionCapability(normalizedActorId, source);
  }
}

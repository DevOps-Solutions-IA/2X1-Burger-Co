import { DeliveryPricingEngine } from './delivery-pricing.engine';
import type { DeliveryContextResult } from '../providers/provider-types';

const engine = new DeliveryPricingEngine();

function context(overrides: Partial<DeliveryContextResult> = {}): DeliveryContextResult {
  return {
    origin: {
      latitude: 3.2601,
      longitude: -76.5405,
      label: '2X1 Burger Co',
      address: 'Local',
      configured: true,
    },
    destination: {
      latitude: 3.258,
      longitude: -76.542,
      addressText: 'Cliente',
      neighborhood: 'Jamundí',
      confidence: 'HIGH',
    },
    geocoding: {
      attempted: true,
      result: {
        provider: 'mock-geocode',
        latitude: 3.258,
        longitude: -76.542,
        formattedAddress: 'Cliente',
        neighborhood: 'Jamundí',
        matchQuality: 'EXACT',
        confidence: 'HIGH',
        warnings: [],
      },
    },
    route: {
      attempted: true,
      distanceKm: 3.5,
      durationMinutes: 15,
      result: {
        provider: 'mock-route',
        distanceKm: 3.5,
        durationMinutes: 15,
        routeConfidence: 'HIGH',
        warnings: [],
      },
      haversineReferenceKm: 1.2,
    },
    weather: {
      attempted: true,
      isRaining: false,
      rainIntensity: 'NONE',
      result: {
        provider: 'mock-weather',
        isRaining: false,
        precipitationMm: 0,
        rainIntensity: 'NONE',
        confidence: 'HIGH',
        fetchedAt: new Date('2026-06-20T12:00:00.000Z'),
        warnings: [],
      },
    },
    localZoneMatch: {
      matched: false,
      zoneLabel: null,
      confidence: 'LOW',
      ambiguous: false,
      reason: 'NO_MATCH',
    },
    confidence: 'HIGH',
    requiresManualQuote: false,
    warnings: [],
    ...overrides,
  };
}

describe('DeliveryPricingEngine enterprise pricing', () => {
  // SOFIA Address Remediation (MANDATORY RULE 1/2/6): a bare zone alias with NO other context —
  // no real geocoded point, no proven address complement — still prices the known free zone at 0
  // (zoneMatched=true), but must NEVER be checkout-eligible by itself: a courier cannot be
  // dispatched to "Alborada" with nothing else. This is the exact false-positive both prior
  // remediation rounds failed to close for real (the fix stayed in-memory but never survived
  // persistence onto the order). See delivery-checkout-authorization.ts.
  it.each(['Condados', 'La Alborada', 'Condados de la Alborada', '  CÓNDADOS   de la   ALBORADA  '])(
    'prices local free exact alias as 0 but blocks checkout until the address is complete: %s',
    (addressText) => {
      const result = engine.quote({ addressText });

      expect(result.pricingStatus).toBe('LOCAL_FREE');
      expect(result.suggestedFee).toBe(0);
      expect(result.finalFee).toBe(0);
      expect(result.zoneType).toBe('LOCAL_FREE');
      expect(result.zoneLabel).toBe('Condados / Alborada');
      expect(result.checkoutAuthorization.zoneMatched).toBe(true);
      expect(result.checkoutAuthorization.addressComplete).toBe(false);
      expect(result.canCheckout).toBe(false);
      expect(result.checkoutAuthorization.canCheckout).toBe(false);
      expect(result.requiresManualQuote).toBe(true);
      expect(result.warnings).toContain('LOCAL_ZONE_ADDRESS_INCOMPLETE');
    },
  );

  it.each(['Condados', 'La Alborada'])(
    'prices local free alias as checkout-eligible once a real geocoded point is already known (TRUSTED_POST_GEOCODING_ZONE_HANDLING): %s',
    (addressText) => {
      const result = engine.quote({
        addressText,
        context: context({
          localZoneMatch: { matched: true, zoneLabel: 'Alborada', confidence: 'HIGH', ambiguous: false, reason: 'test' },
        }),
      });

      expect(result.pricingStatus).toBe('LOCAL_FREE');
      expect(result.finalFee).toBe(0);
      expect(result.checkoutAuthorization.zoneMatched).toBe(true);
      expect(result.checkoutAuthorization.addressComplete).toBe(true);
      expect(result.canCheckout).toBe(true);
      expect(result.checkoutAuthorization.canCheckout).toBe(true);
      expect(result.requiresManualQuote).toBe(false);
    },
  );

  it('reports a full DeliveryCheckoutAuthorization breakdown, not just the final AND, for an incomplete zone-only match', () => {
    const result = engine.quote({ addressText: 'Alborada' });

    expect(result.checkoutAuthorization).toEqual({
      addressValid: true,
      addressComplete: false,
      zoneMatched: true,
      coverageAllowed: true,
      deliveryFeeResolved: true,
      canCheckout: false,
    });
  });

  it.each(['cerca de alborada', 'por alborada', 'vía alborada'])('requires address correction for ambiguous local text: %s', (addressText) => {
    const result = engine.quote({ addressText });

    expect(result.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(result.canCheckout).toBe(false);
    expect(result.requiresAddressCorrection).toBe(true);
    expect(result.finalFee).toBeNull();
    expect(result.warnings).toContain('LOCAL_ZONE_AMBIGUOUS');
  });

  it('does not apply min fare, rain or peak surcharges to LOCAL_FREE', () => {
    const result = engine.quote({
      addressText: 'Alborada',
      weatherMode: 'HEAVY',
      scheduleMode: 'PEAK',
      orderSubtotal: 200000,
    });

    expect(result.finalFee).toBe(0);
    expect(result.weather.surcharge).toBe(0);
    expect(result.schedule.surcharge).toBe(0);
    expect(result.subtotalBenefit).toBe(0);
  });

  it.each([
    [0.6, 5000],
    [1.5, 5000],
    [3.5, 8000],
  ])('charges only extra km after included km for %s km', (distanceKm, expected) => {
    const result = engine.quote({
      context: context({ route: { ...context().route, distanceKm, durationMinutes: 15 } }),
    });

    expect(result.pricingStatus).toBe('AUTO_PRICED');
    expect(result.finalFee).toBe(expected);
  });

  it('charges time by configured blocks', () => {
    const result = engine.quote({
      context: context({ route: { ...context().route, distanceKm: 1.5, durationMinutes: 27 } }),
    });

    expect(result.breakdown.find((item) => item.code === 'TIME_CHARGE')?.amount).toBe(1500);
    expect(result.finalFee).toBe(6500);
  });

  it.each([
    ['LIGHT', 1000],
    ['HEAVY', 2500],
    ['UNKNOWN', 0],
  ] as const)('applies weather policy %s', (weatherMode, expectedSurcharge) => {
    const result = engine.quote({
      weatherMode,
      context: context({ route: { ...context().route, distanceKm: 1.5, durationMinutes: 15 } }),
    });

    expect(result.weather.surcharge).toBe(expectedSurcharge);
    expect(result.finalFee).toBe(Math.max(5000, 5000 + expectedSurcharge));
  });

  it('keeps Google route pricing unchanged when Open-Meteo reports no rain', () => {
    const result = engine.quote({
      context: context({
        geocoding: {
          ...context().geocoding,
          result: {
            ...context().geocoding.result!,
            provider: 'google',
          },
        },
        route: {
          ...context().route,
          distanceKm: 3.5,
          durationMinutes: 15,
          result: {
            provider: 'google',
            distanceKm: 3.5,
            durationMinutes: 15,
            routeConfidence: 'HIGH',
            warnings: [],
          },
        },
        weather: {
          attempted: true,
          isRaining: false,
          rainIntensity: 'NONE',
          result: {
            provider: 'openmeteo',
            isRaining: false,
            precipitationMm: 0,
            rainIntensity: 'NONE',
            confidence: 'HIGH',
            fetchedAt: new Date('2026-06-20T12:00:00.000Z'),
            warnings: [],
          },
        },
      }),
    });

    expect(result.pricingStatus).toBe('AUTO_PRICED');
    expect(result.canCheckout).toBe(true);
    expect(result.providersUsed.routingProvider).toBe('google');
    expect(result.providersUsed.weatherProvider).toBe('openmeteo');
    expect(result.weather.rainIntensity).toBe('NONE');
    expect(result.weather.surcharge).toBe(0);
    expect(result.breakdown.find((item) => item.code === 'WEATHER_SURCHARGE')).toMatchObject({
      amount: 0,
      metadata: { rainIntensity: 'NONE' },
    });
    expect(result.finalFee).toBe(8000);
  });

  it('applies rain surcharge when Google route is priced and Open-Meteo reports moderate rain', () => {
    const result = engine.quote({
      context: context({
        geocoding: {
          ...context().geocoding,
          result: {
            ...context().geocoding.result!,
            provider: 'google',
          },
        },
        route: {
          ...context().route,
          distanceKm: 3.5,
          durationMinutes: 15,
          result: {
            provider: 'google',
            distanceKm: 3.5,
            durationMinutes: 15,
            routeConfidence: 'HIGH',
            warnings: [],
          },
        },
        weather: {
          attempted: true,
          isRaining: true,
          rainIntensity: 'MODERATE',
          result: {
            provider: 'openmeteo',
            isRaining: true,
            precipitationMm: 4.2,
            rainIntensity: 'MODERATE',
            confidence: 'HIGH',
            fetchedAt: new Date('2026-06-20T12:00:00.000Z'),
            warnings: [],
          },
        },
      }),
    });

    expect(result.pricingStatus).toBe('AUTO_PRICED');
    expect(result.canCheckout).toBe(true);
    expect(result.providersUsed.routingProvider).toBe('google');
    expect(result.providersUsed.weatherProvider).toBe('openmeteo');
    expect(result.weather.rainIntensity).toBe('MODERATE');
    expect(result.weather.surcharge).toBe(1500);
    expect(result.breakdown.find((item) => item.code === 'WEATHER_SURCHARGE')).toMatchObject({
      amount: 1500,
      metadata: { rainIntensity: 'MODERATE' },
    });
    expect(result.finalFee).toBe(9500);
  });

  it('does not call Google-priced route or apply rain surcharge for LOCAL_FREE even when weather context says rain', () => {
    const result = engine.quote({
      addressText: 'Condados de la Alborada',
      context: context({
        localZoneMatch: {
          matched: true,
          zoneLabel: 'Condados de la Alborada',
          confidence: 'HIGH',
          ambiguous: false,
          reason: 'EXACT_ALIAS',
        },
        geocoding: {
          attempted: false,
          result: null,
        },
        route: {
          attempted: false,
          distanceKm: null,
          durationMinutes: null,
          result: null,
          haversineReferenceKm: null,
        },
        weather: {
          attempted: false,
          isRaining: true,
          rainIntensity: 'HEAVY',
          result: {
            provider: 'openmeteo',
            isRaining: true,
            precipitationMm: 10,
            rainIntensity: 'HEAVY',
            confidence: 'HIGH',
            fetchedAt: new Date('2026-06-20T12:00:00.000Z'),
            warnings: [],
          },
        },
      }),
    });

    expect(result.pricingStatus).toBe('LOCAL_FREE');
    expect(result.finalFee).toBe(0);
    expect(result.canCheckout).toBe(true);
    expect(result.weather.rainIntensity).toBe('NONE');
    expect(result.weather.surcharge).toBe(0);
    expect(result.providersUsed.routingProvider).toBeNull();
    expect(result.breakdown).toEqual([
      { code: 'LOCAL_FREE_ZONE', label: 'Domicilio gratis - Condados / Alborada', amount: 0 },
    ]);
  });

  it('applies peak schedule surcharge', () => {
    const result = engine.quote({
      scheduleMode: 'PEAK',
      context: context({ route: { ...context().route, distanceKm: 1.5, durationMinutes: 15 } }),
    });

    expect(result.schedule.surcharge).toBe(1000);
    expect(result.finalFee).toBe(6000);
  });

  it.each([
    [80000, 1000],
    [120000, 2000],
  ])('applies subtotal benefit for %s without going under min fare', (orderSubtotal, benefit) => {
    const result = engine.quote({
      orderSubtotal,
      context: context({ route: { ...context().route, distanceKm: 3.5, durationMinutes: 15 } }),
    });

    expect(result.subtotalBenefit).toBe(benefit);
    expect(result.finalFee).toBeGreaterThanOrEqual(5000);
  });

  it('blocks checkout over max auto distance', () => {
    const result = engine.quote({ context: context({ route: { ...context().route, distanceKm: 9, durationMinutes: 20 } }) });

    expect(result.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(result.canCheckout).toBe(false);
    expect(result.finalFee).toBeNull();
  });

  it('blocks checkout over max auto duration', () => {
    const result = engine.quote({ context: context({ route: { ...context().route, distanceKm: 5, durationMinutes: 50 } }) });

    expect(result.pricingStatus).toBe('OUT_OF_COVERAGE');
    expect(result.canCheckout).toBe(false);
    expect(result.finalFee).toBeNull();
  });

  it('requires address correction for low confidence', () => {
    const result = engine.quote({ context: context({ confidence: 'LOW' }) });

    expect(result.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(result.canCheckout).toBe(false);
    expect(result.finalFee).toBeNull();
  });

  it('returns provider unavailable without invented fee when route is unavailable', () => {
    const result = engine.quote({
      context: context({
        route: { ...context().route, distanceKm: null, durationMinutes: null, result: null },
        warnings: ['ROUTING_UNAVAILABLE'],
      }),
    });

    expect(result.pricingStatus).toBe('PROVIDER_UNAVAILABLE');
    expect(result.canCheckout).toBe(false);
    expect(result.finalFee).toBeNull();
  });

  it('blocks automated checkout without origin or destination', () => {
    expect(engine.quote({ context: context({ origin: { ...context().origin, configured: false } }) }).pricingStatus).toBe('PROVIDER_UNAVAILABLE');
    expect(engine.quote({ addressText: '' }).pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
  });

  it('ignores legacy manual fee as an operational pricing source', () => {
    const accepted = engine.quote({ manualFee: 7000, manualReason: 'Barrio confirmado por llamada' });
    const rejected = engine.quote({ manualFee: 7000 });

    expect(accepted.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(accepted.finalFee).toBeNull();
    expect(accepted.manualEdited).toBe(false);
    expect(rejected.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(rejected.finalFee).toBeNull();
    expect(rejected.manualEdited).toBe(false);
  });

  it('does not use silent 5000 fallback or haversine for unknown address', () => {
    const result = engine.quote({ addressText: 'Destino desconocido' });

    expect(result.finalFee).toBeNull();
    expect(result.finalFee).not.toBe(5000);
    expect(result.breakdown.some((item) => item.code.includes('HAVERSINE'))).toBe(false);
  });
});

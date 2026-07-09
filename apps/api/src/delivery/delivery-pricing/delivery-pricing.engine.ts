import { matchLocalZone } from '../providers/local-zone-match';
import type { DeliveryContextResult, LocalZoneMatchResult } from '../providers/provider-types';
import { deliveryPricingConfig } from './delivery-pricing.config';
import type {
  DeliveryPricingBreakdownItem,
  DeliveryPricingRequest,
  DeliveryPricingResult,
  DeliveryScheduleMode,
  DeliveryWeatherMode,
  DeliveryZoneType,
} from './delivery-pricing.types';

const VERSION = deliveryPricingConfig.calculationVersion;

export class DeliveryPricingEngine {
  quote(request: DeliveryPricingRequest): DeliveryPricingResult {
    const context = request.context ?? null;
    const warnings = new Set<string>(context?.warnings ?? []);
    const orderSubtotal = normalizeNonNegative(request.orderSubtotal) ?? 0;
    const localZoneMatch = context?.localZoneMatch ?? matchLocalZone(request);
    const scheduleMode = resolveScheduleMode(request.scheduleMode, request.requestedAt);
    const weatherMode = resolveWeatherMode(request.weatherMode, context);

    if (localZoneMatch.ambiguous) {
      warnings.add('LOCAL_ZONE_AMBIGUOUS');
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: 'NEEDS_ADDRESS_CORRECTION',
        reasonCode: 'LOCAL_ZONE_AMBIGUOUS',
        humanMessage: 'La referencia a Condados / Alborada es ambigua. Corrige la dirección para calcular el domicilio.',
      });
    }

    if (localZoneMatch.matched) {
      return baseResult({
        pricingStatus: 'LOCAL_FREE',
        suggestedFee: 0,
        finalFee: 0,
        requiresManualQuote: false,
        confidence: localZoneMatch.confidence,
        zoneType: 'LOCAL_FREE',
        zoneLabel: 'Condados / Alborada',
        localZoneMatch,
        context,
        weatherMode: 'NONE',
        weatherSurcharge: 0,
        scheduleMode: 'NORMAL',
        scheduleSurcharge: 0,
        logisticsSurcharge: 0,
        subtotalBenefit: 0,
        breakdown: [
          {
            code: 'LOCAL_FREE_ZONE',
            label: 'Domicilio gratis - Condados / Alborada',
            amount: 0,
          },
        ],
        warnings: [...warnings],
        reasonCode: 'LOCAL_FREE_ZONE',
        humanMessage: 'Domicilio gratis - Condados / Alborada.',
      });
    }

    if (request.forceManual) {
      warnings.add('MANUAL_FLOW_LEGACY_DISABLED');
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: 'NEEDS_ADDRESS_CORRECTION',
        reasonCode: 'MANUAL_FLOW_DISABLED',
        humanMessage: 'El flujo manual quedó deshabilitado. Corrige la dirección para calcular el domicilio desde backend.',
      });
    }

    const hasInput =
      hasAnyDestinationInput(request) ||
      (context?.destination.latitude != null && context.destination.longitude != null);
    if (!hasInput) {
      warnings.add('DESTINATION_MISSING');
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: 'NEEDS_ADDRESS_CORRECTION',
        reasonCode: 'DESTINATION_MISSING',
        humanMessage: 'Completa una dirección de domicilio para calcular la tarifa.',
      });
    }

    if (!context?.origin.configured) {
      warnings.add('ORIGIN_COORDINATES_MISSING');
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: 'PROVIDER_UNAVAILABLE',
        reasonCode: 'ORIGIN_COORDINATES_MISSING',
        humanMessage: 'La ubicación base del local está pendiente. No se puede calcular la ruta automática.',
      });
    }

    if (context.destination.latitude == null || context.destination.longitude == null) {
      warnings.add('DESTINATION_MISSING');
      const providerUnavailable = warnings.has('EXTERNAL_PROVIDERS_DISABLED') || warnings.has('GEOCODING_UNAVAILABLE');
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: providerUnavailable ? 'PROVIDER_UNAVAILABLE' : 'NEEDS_ADDRESS_CORRECTION',
        reasonCode: providerUnavailable ? 'GEOCODING_UNAVAILABLE' : 'DESTINATION_COORDINATES_MISSING',
        humanMessage: providerUnavailable
          ? 'El proveedor de geocodificación no está disponible. Intenta de nuevo o revisa configuración.'
          : 'La dirección no tiene coordenadas confiables. Corrige la dirección para calcular el domicilio.',
      });
    }

    if (context.requiresManualQuote || context.confidence === 'LOW') {
      const reasonCode = warnings.has('GEOCODING_AMBIGUOUS')
        ? 'GEOCODING_AMBIGUOUS'
        : warnings.has('GEOCODING_NOT_FOUND')
          ? 'GEOCODING_NOT_FOUND'
          : 'LOW_CONFIDENCE_ROUTE';
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: reasonCode === 'LOW_CONFIDENCE_ROUTE' ? 'NEEDS_ADDRESS_CORRECTION' : 'NEEDS_ADDRESS_CORRECTION',
        reasonCode,
        humanMessage: 'La dirección no tiene confianza suficiente. Corrige la dirección antes de cobrar el domicilio.',
      });
    }

    const distanceKm = context.route.distanceKm;
    const durationMinutes = context.route.durationMinutes;
    if (distanceKm == null || durationMinutes == null) {
      warnings.add('ROUTING_UNAVAILABLE');
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: 'PROVIDER_UNAVAILABLE',
        reasonCode: 'ROUTING_UNAVAILABLE',
        humanMessage: 'No fue posible calcular la ruta automática del domicilio.',
      });
    }

    const zoneType = resolveZoneType(distanceKm, durationMinutes);
    if (zoneType === 'OUT_OF_COVERAGE' || zoneType === 'DIFFICULT_ACCESS') {
      warnings.add(zoneType);
      return this.blockedResult({
        request,
        warnings,
        context,
        localZoneMatch,
        status: 'OUT_OF_COVERAGE',
        reasonCode: 'OUT_OF_COVERAGE',
        humanMessage: 'La dirección queda fuera de la cobertura automática de domicilios.',
      });
    }

    const extraKm = Math.max(0, distanceKm - deliveryPricingConfig.includedKm);
    const distanceCharge = roundUp(extraKm * deliveryPricingConfig.pricePerExtraKm, deliveryPricingConfig.roundTo);
    const extraMinutes = Math.max(0, durationMinutes - deliveryPricingConfig.includedMinutes);
    const timeBlocks = Math.ceil(extraMinutes / deliveryPricingConfig.timeBlockMinutes);
    const timeCharge = timeBlocks * deliveryPricingConfig.pricePerExtraTimeBlock;
    const weatherSurcharge = deliveryPricingConfig.weatherSurcharge[weatherMode] ?? 0;
    const scheduleSurcharge = deliveryPricingConfig.scheduleSurcharge[scheduleMode] ?? 0;
    const logisticsSurcharge = deliveryPricingConfig.logisticsSurcharge[zoneType] ?? 0;
    const subtotalBenefit = resolveSubtotalBenefit(orderSubtotal);

    const rawFee =
      deliveryPricingConfig.baseFare +
      distanceCharge +
      timeCharge +
      weatherSurcharge +
      scheduleSurcharge +
      logisticsSurcharge -
      subtotalBenefit;
    const suggestedFee = Math.min(
      deliveryPricingConfig.maxAutoFare,
      Math.max(deliveryPricingConfig.minFare, roundUp(rawFee, deliveryPricingConfig.roundTo)),
    );

    const breakdown: DeliveryPricingBreakdownItem[] = [
      { code: 'BASE_FARE', label: 'Tarifa base', amount: deliveryPricingConfig.baseFare },
      { code: 'DISTANCE_CHARGE', label: 'Distancia adicional', amount: distanceCharge, metadata: { distanceKm, includedKm: deliveryPricingConfig.includedKm } },
      { code: 'TIME_CHARGE', label: 'Tiempo adicional', amount: timeCharge, metadata: { durationMinutes, includedMinutes: deliveryPricingConfig.includedMinutes } },
      { code: 'WEATHER_SURCHARGE', label: 'Clima', amount: weatherSurcharge, metadata: { rainIntensity: weatherMode } },
      { code: 'SCHEDULE_SURCHARGE', label: 'Horario', amount: scheduleSurcharge, metadata: { scheduleMode } },
      { code: 'LOGISTICS_SURCHARGE', label: 'Zona logística', amount: logisticsSurcharge, metadata: { zoneType } },
      { code: 'SUBTOTAL_BENEFIT', label: 'Beneficio por subtotal', amount: -subtotalBenefit, metadata: { orderSubtotal } },
    ];

    return baseResult({
      pricingStatus: 'AUTO_PRICED',
      suggestedFee,
      finalFee: suggestedFee,
      requiresManualQuote: false,
      confidence: context.confidence,
      zoneType,
      zoneLabel: zoneTypeLabel(zoneType),
      localZoneMatch,
      context,
      weatherMode,
      weatherSurcharge,
      scheduleMode,
      scheduleSurcharge,
      logisticsSurcharge,
      subtotalBenefit,
      breakdown,
      warnings: [...warnings],
      reasonCode: 'AUTO_PRICED',
      humanMessage: 'Tarifa de domicilio calculada automáticamente.',
    });
  }

  private blockedResult(input: {
    request: DeliveryPricingRequest;
    warnings: Set<string>;
    context: DeliveryContextResult | null;
    localZoneMatch: LocalZoneMatchResult;
    status: DeliveryPricingResult['pricingStatus'];
    reasonCode: string;
    humanMessage: string;
  }): DeliveryPricingResult {
    return baseResult({
      pricingStatus: input.status,
      suggestedFee: null,
      finalFee: null,
      requiresManualQuote: true,
      confidence: 'LOW',
      zoneType: 'UNKNOWN',
      zoneLabel: null,
      localZoneMatch: input.localZoneMatch,
      context: input.context,
      weatherMode: resolveWeatherMode(input.request.weatherMode, input.context),
      weatherSurcharge: 0,
      scheduleMode: resolveScheduleMode(input.request.scheduleMode, input.request.requestedAt),
      scheduleSurcharge: 0,
      logisticsSurcharge: 0,
      subtotalBenefit: 0,
      breakdown: [{ code: input.reasonCode, label: input.humanMessage, amount: 0 }],
      warnings: [...input.warnings],
      reasonCode: input.reasonCode,
      humanMessage: input.humanMessage,
    });
  }
}

function baseResult(input: {
  pricingStatus: DeliveryPricingResult['pricingStatus'];
  suggestedFee: number | null;
  finalFee: number | null;
  requiresManualQuote: boolean;
  confidence: DeliveryPricingResult['confidence'];
  zoneType: DeliveryZoneType;
  zoneLabel: string | null;
  localZoneMatch: LocalZoneMatchResult | null;
  context: DeliveryContextResult | null;
  weatherMode: DeliveryWeatherMode;
  weatherSurcharge: number;
  scheduleMode: DeliveryScheduleMode;
  scheduleSurcharge: number;
  logisticsSurcharge: number;
  subtotalBenefit: number;
  breakdown: DeliveryPricingBreakdownItem[];
  warnings: string[];
  manualEdited?: boolean;
  manualEditReason?: string | null;
  reasonCode: string;
  humanMessage: string;
}): DeliveryPricingResult {
  const canCheckout = input.pricingStatus === 'LOCAL_FREE' || input.pricingStatus === 'AUTO_PRICED';
  const weatherImpact = {
    rainIntensity: input.weatherMode,
    surcharge: input.weatherSurcharge,
    provider: input.context?.weather.result?.provider ?? null,
    unavailable: input.warnings.includes('WEATHER_UNAVAILABLE'),
  };
  const providerUsage = {
    weatherProvider: input.context?.weather.result?.provider ?? null,
    geocodingProvider: input.context?.geocoding.result?.provider ?? null,
    routingProvider: input.context?.route.result?.provider ?? null,
    cacheWarnings: input.warnings.filter((warning) => warning.includes('CACHE')),
    warnings: input.warnings,
  };

  return {
    status: input.pricingStatus,
    pricingStatus: input.pricingStatus,
    suggestedFee: input.suggestedFee,
    finalFee: input.finalFee,
    currency: 'COP',
    canCheckout,
    requiresAddressCorrection: input.pricingStatus === 'NEEDS_ADDRESS_CORRECTION' || input.pricingStatus === 'INVALID_INPUT',
    reasonCode: input.reasonCode,
    humanMessage: input.humanMessage,
    requiresManualQuote: input.requiresManualQuote,
    confidence: input.confidence,
    zoneType: input.zoneType,
    zoneLabel: input.zoneLabel,
    localZoneMatch: input.localZoneMatch,
    zoneMatch: input.localZoneMatch,
    distanceKm: input.context?.route.distanceKm ?? null,
    durationMinutes: input.context?.route.durationMinutes ?? null,
    estimatedMinutes: input.context?.route.durationMinutes ?? null,
    weather: weatherImpact,
    schedule: {
      mode: input.scheduleMode,
      surcharge: input.scheduleSurcharge,
    },
    logistics: {
      zoneType: input.zoneType,
      surcharge: input.logisticsSurcharge,
    },
    subtotalBenefit: input.subtotalBenefit,
    manualEdited: input.manualEdited ?? false,
    manualEditReason: input.manualEditReason ?? null,
    breakdown: input.breakdown,
    warnings: input.warnings,
    providerUsage,
    providersUsed: providerUsage,
    weatherImpact,
    calculationVersion: VERSION,
  };
}

function hasAnyDestinationInput(request: DeliveryPricingRequest) {
  return Boolean(
    request.addressText?.trim() ||
      request.reference?.trim() ||
      request.neighborhood?.trim() ||
      (request.latitude != null && request.longitude != null),
  );
}

function normalizeNonNegative(value: number | null | undefined) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function resolveWeatherMode(value: string | null | undefined, context: DeliveryContextResult | null): DeliveryWeatherMode {
  const candidate = (value ?? context?.weather.rainIntensity ?? 'UNKNOWN').toUpperCase();
  if (candidate === 'NONE' || candidate === 'LIGHT' || candidate === 'MODERATE' || candidate === 'HEAVY' || candidate === 'UNKNOWN') {
    return candidate;
  }
  return 'UNKNOWN';
}

function resolveScheduleMode(value: string | null | undefined, requestedAt: Date | string | null | undefined): DeliveryScheduleMode {
  const candidate = value?.toUpperCase();
  if (candidate === 'NORMAL' || candidate === 'PEAK' || candidate === 'NIGHT' || candidate === 'WEEKEND_PEAK') return candidate;
  if (!requestedAt) return 'NORMAL';
  const date = new Date(requestedAt);
  if (Number.isNaN(date.getTime())) return 'NORMAL';
  const day = date.getDay();
  const hour = date.getHours();
  const weekend = day === 0 || day === 6;
  if (hour >= 21 || hour < 6) return 'NIGHT';
  if (weekend && hour >= 18 && hour <= 21) return 'WEEKEND_PEAK';
  if ((hour >= 12 && hour <= 14) || (hour >= 18 && hour <= 20)) return 'PEAK';
  return 'NORMAL';
}

function resolveZoneType(distanceKm: number, durationMinutes: number): DeliveryZoneType {
  if (distanceKm > deliveryPricingConfig.maxAutoDistanceKm || durationMinutes > deliveryPricingConfig.maxAutoDurationMinutes) {
    return 'OUT_OF_COVERAGE';
  }
  if (distanceKm <= 3) return 'NEAR';
  if (distanceKm <= 6) return 'MEDIUM';
  return 'FAR';
}

function resolveSubtotalBenefit(orderSubtotal: number) {
  const rule = deliveryPricingConfig.subtotalBenefit.find((item) => orderSubtotal >= item.minSubtotal);
  return rule?.discount ?? 0;
}

function zoneTypeLabel(zoneType: DeliveryZoneType) {
  if (zoneType === 'NEAR') return 'Zona cercana';
  if (zoneType === 'MEDIUM') return 'Zona media';
  if (zoneType === 'FAR') return 'Zona lejana';
  if (zoneType === 'OUT_OF_COVERAGE') return 'Fuera de cobertura';
  if (zoneType === 'DIFFICULT_ACCESS') return 'Acceso difícil';
  if (zoneType === 'LOCAL_FREE') return 'Condados / Alborada';
  return 'Zona desconocida';
}

function roundUp(value: number, roundTo: number) {
  return Math.ceil(value / roundTo) * roundTo;
}

function addWarning(warnings: Set<string>, warning: string) {
  const next = new Set(warnings);
  next.add(warning);
  return next;
}

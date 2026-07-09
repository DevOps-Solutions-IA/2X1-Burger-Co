/**
 * LEGACY - NOT ACTIVE - DO NOT USE FOR FINAL DELIVERY PRICING.
 *
 * Kept only as historical reference during AUDIT-8G.0. OrdersService no longer
 * imports this module for fee calculation. AUDIT-8G.1 must replace this with
 * the enterprise delivery pricing engine.
 */
export const JAMUNDI_BASE_LOCATION = {
  label: 'Cra. 5a Sur #23a-68, Alfaguara, Jamundí',
  latitude: 3.2554,
  longitude: -76.5419,
} as const;

export type DeliveryRateBand = {
  key: string;
  label: string;
  minKm: number;
  maxKm: number | null;
  fee: number;
  aliases: string[];
};

export const DEFAULT_JAMUNDI_URBAN_RATE_BANDS: DeliveryRateBand[] = [
  {
    key: 'close',
    label: 'Cerca',
    minKm: 0,
    maxKm: 2.2,
    fee: 5000,
    aliases: [
      'alfaguara',
      'verde alfaguara',
      'ciudad country',
      'canasgordas',
      'las mercedes',
      'las flores',
      'bosquelago',
      'oporto',
      'los cinco soles',
      'parque natura',
      'oceano verde',
      'marbella',
      'la cibita',
      'cibita',
    ],
  },
  {
    key: 'intermediate',
    label: 'Intermedia',
    minKm: 2.2,
    maxKm: 4.8,
    fee: 8000,
    aliases: [
      'sachamate',
      'pangola',
      'terracota',
      'guaduales',
      'los guaduales',
      'terranova',
      'prados del sur',
      'la pradera',
      'riberas del rosario',
      'condados del sur',
      'verdi',
      'parques de castilla',
      'villa tatiana',
      'ciudadela del viento',
    ],
  },
  {
    key: 'far',
    label: 'Lejana',
    minKm: 4.8,
    maxKm: 7.5,
    fee: 10000,
    aliases: [
      'centro',
      'libertadores',
      'portal de jamundi',
      'portal del jordan',
      'el jordan',
      'bonanza',
      'el rodeo',
      'torres de jamundi',
      'ciro velazco',
      'belalcazar',
      'belalcazar ii',
      'el piloto',
      'jalisco',
      'primero de mayo',
      'el rosario',
      'rosario',
      'ciudad de dios',
      'los naranjos',
      'villa paulina',
      'rincon de zaragoza',
      'hojarasca',
      'las margaritas',
    ],
  },
  {
    key: 'urban-edge',
    label: 'Límite urbano',
    minKm: 7.5,
    maxKm: null,
    fee: 12000,
    aliases: [
      'ciudadela las flores',
      'villas de jamundi',
      'el castillo jamundi',
      'villa monica',
      'villa stella',
      'popular',
      'panamericano',
      'alferez real',
      'la aurora',
      'tulipanes',
      'el socorro',
      'ciudad sur',
      'belalcazar',
      'belalcazar ii',
    ],
  },
];

export function haversineDistanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRad(toLat - fromLat);
  const deltaLng = toRad(toLng - fromLng);
  const startLat = toRad(fromLat);
  const endLat = toRad(toLat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function normalizeAddressText(input: string | null | undefined) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function resolveBandFromDistance(distanceKm: number, bands = DEFAULT_JAMUNDI_URBAN_RATE_BANDS) {
  return (
    bands.find((band) => distanceKm >= band.minKm && (band.maxKm == null || distanceKm < band.maxKm)) ??
    bands[bands.length - 1]
  );
}

export function resolveBandFromAddress(address: string, bands = DEFAULT_JAMUNDI_URBAN_RATE_BANDS) {
  const normalized = normalizeAddressText(address);
  return (
    bands.find((band) => band.aliases.some((alias) => normalized.includes(normalizeAddressText(alias)))) ?? null
  );
}

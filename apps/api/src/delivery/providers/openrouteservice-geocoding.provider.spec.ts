import { OpenRouteServiceGeocodingProvider } from './openrouteservice-geocoding.provider';

describe('OpenRouteServiceGeocodingProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps strong geocoding response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-76.542, 3.258] },
            properties: { label: 'Condados de la Alborada', confidence: 0.9, neighbourhood: 'Condados de la Alborada' },
          },
        ],
      }),
    } as Response);

    const result = await new OpenRouteServiceGeocodingProvider(3000, 'test-key').geocodeAddress({
      addressText: 'Condados de la Alborada',
      city: 'Jamundí',
      country: 'Colombia',
    });

    expect(result.provider).toBe('openrouteservice');
    expect(result.latitude).toBe(3.258);
    expect(result.longitude).toBe(-76.542);
    expect(result.matchQuality).toBe('EXACT');
  });

  it('marks close results as ambiguous', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          { geometry: { coordinates: [-76.542, 3.258] }, properties: { confidence: 0.62, label: 'A' } },
          { geometry: { coordinates: [-76.543, 3.259] }, properties: { confidence: 0.58, label: 'B' } },
        ],
      }),
    } as Response);

    const result = await new OpenRouteServiceGeocodingProvider(3000, 'test-key').geocodeAddress({
      addressText: 'Alborada',
    });

    expect(result.matchQuality).toBe('AMBIGUOUS');
    expect(result.warnings).toContain('GEOCODING_AMBIGUOUS');
  });

  it('fails safely when API key is missing', async () => {
    await expect(new OpenRouteServiceGeocodingProvider(3000, undefined).geocodeAddress({ addressText: 'X' })).rejects.toMatchObject({
      warning: 'PROVIDER_API_KEY_MISSING',
    });
  });
});

import { OpenRouteServiceRoutingProvider } from './openrouteservice-routing.provider';

describe('OpenRouteServiceRoutingProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps route response to distance and duration', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ summary: { distance: 2400, duration: 540 } }] }),
    } as Response);

    const result = await new OpenRouteServiceRoutingProvider(3000, 'test-key').getRoute({
      originLatitude: 3.26,
      originLongitude: -76.54,
      destinationLatitude: 3.25,
      destinationLongitude: -76.53,
      profile: 'MOTORCYCLE',
    });

    expect(result.provider).toBe('openrouteservice');
    expect(result.distanceKm).toBe(2.4);
    expect(result.durationMinutes).toBe(9);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v2/directions/driving-car'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      }),
    );
  });

  it('fails safely when API key is missing', async () => {
    await expect(
      new OpenRouteServiceRoutingProvider(3000, undefined).getRoute({
        originLatitude: 3.26,
        originLongitude: -76.54,
        destinationLatitude: 3.25,
        destinationLongitude: -76.53,
        profile: 'MOTORCYCLE',
      }),
    ).rejects.toMatchObject({ warning: 'PROVIDER_API_KEY_MISSING' });
  });
});

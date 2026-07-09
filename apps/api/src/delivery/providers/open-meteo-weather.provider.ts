import type { WeatherProvider } from './weather-provider.interface';
import type { WeatherRequest, WeatherResult, WeatherRainIntensity } from './provider-types';
import { fetchJsonWithTimeout } from './provider-http';

type OpenMeteoResponse = {
  current?: {
    precipitation?: number;
    rain?: number;
    weather_code?: number;
    temperature_2m?: number;
  };
};

export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly providerName = 'openmeteo';

  constructor(private readonly timeoutMs: number) {}

  async getCurrentWeather(request: WeatherRequest): Promise<WeatherResult> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(request.latitude));
    url.searchParams.set('longitude', String(request.longitude));
    url.searchParams.set('current', 'precipitation,rain,weather_code,temperature_2m');
    url.searchParams.set('timezone', request.timezone ?? 'America/Bogota');

    const response = await fetchJsonWithTimeout<OpenMeteoResponse>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'WEATHER_UNAVAILABLE',
    );
    const precipitation = Number(response.current?.precipitation ?? response.current?.rain ?? 0);
    const precipitationMm = Number.isFinite(precipitation) ? precipitation : null;

    return {
      provider: this.providerName,
      isRaining: precipitationMm == null ? null : precipitationMm > 0,
      precipitationMm,
      rainIntensity: intensityFromPrecipitation(precipitationMm),
      weatherCode: response.current?.weather_code ?? null,
      temperatureC: response.current?.temperature_2m ?? null,
      confidence: precipitationMm == null ? 'LOW' : 'HIGH',
      fetchedAt: new Date(),
      warnings: [],
      rawSummary: response.current ?? null,
    };
  }
}

function intensityFromPrecipitation(precipitationMm: number | null): WeatherRainIntensity {
  if (precipitationMm == null) return 'UNKNOWN';
  if (precipitationMm <= 0) return 'NONE';
  if (precipitationMm < 2.5) return 'LIGHT';
  if (precipitationMm < 7.6) return 'MODERATE';
  return 'HEAVY';
}

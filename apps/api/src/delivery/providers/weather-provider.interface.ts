import type { WeatherRequest, WeatherResult } from './provider-types';

export interface WeatherProvider {
  readonly providerName: string;
  getCurrentWeather(request: WeatherRequest): Promise<WeatherResult>;
}

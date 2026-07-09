import { DeliveryProviderError } from './provider-errors';
import type { DeliveryProviderWarning } from './provider-errors';

export async function fetchJsonWithTimeout<T>(
  provider: string,
  url: string,
  timeoutMs: number,
  unavailableWarning: DeliveryProviderWarning,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new DeliveryProviderError(`${provider} responded ${response.status}`, unavailableWarning, provider);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DeliveryProviderError) {
      throw error;
    }

    throw new DeliveryProviderError(`${provider} unavailable`, unavailableWarning, provider);
  } finally {
    clearTimeout(timeout);
  }
}

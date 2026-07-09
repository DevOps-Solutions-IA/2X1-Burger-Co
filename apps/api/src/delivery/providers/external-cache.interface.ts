import type { ExternalCacheType } from './provider-types';

export type ExternalCacheLookup = {
  provider: string;
  cacheType: ExternalCacheType;
  cacheKey: string;
  requestHash?: string;
};

export interface ExternalCache {
  get<T>(entry: ExternalCacheLookup): Promise<T | null>;
  set<T>(entry: ExternalCacheLookup, value: T, ttlSeconds: number): Promise<void>;
  delete(entry: ExternalCacheLookup): Promise<void>;
}

import { Injectable } from '@nestjs/common';
import {
  developmentReleaseManifest,
  loadReleaseManifest,
  type ReleaseManifest,
} from './release-manifest';

@Injectable()
export class ReleaseMetadataService {
  private readonly manifest: ReleaseManifest;

  constructor() {
    const manifestPath = process.env.RELEASE_MANIFEST_PATH ?? '/app/release-manifest.json';
    try {
      this.manifest = loadReleaseManifest(manifestPath);
    } catch (error) {
      if (!this.isMissingManifest(error)) throw error;
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Release manifest is required in production runtime', { cause: error });
      }
      this.manifest = developmentReleaseManifest();
    }
  }

  getVersion() {
    return {
      application: 'inventory-fastfood-api',
      environment: this.manifest.environment,
      version: this.manifest.releaseVersion,
      commitSha: this.manifest.gitCommit,
      buildId: this.manifest.backendBuildId,
      artifactDigest: this.manifest.artifactDigest,
      buildTimestamp: this.manifest.buildTimestamp,
      schemaVersion: this.manifest.schemaVersion,
      migrationCount: this.manifest.schemaMigrationCount ?? null,
      releaseManifestVersion: this.manifest.releaseManifestVersion,
    };
  }

  getEnvironment(): ReleaseManifest['environment'] {
    return this.manifest.environment;
  }

  getSchemaMigrationCount(): number | null {
    return this.manifest.schemaMigrationCount ?? null;
  }

  getMigrationInventory(): ReleaseManifest['migrationInventory'] {
    return this.manifest.migrationInventory;
  }

  getMigrationAttestations(): ReleaseManifest['migrationAttestations'] {
    return this.manifest.migrationAttestations;
  }

  getRequiredSafetyFlags(): ReleaseManifest['safetyFlags'] {
    return this.manifest.safetyFlags;
  }

  private isMissingManifest(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) return false;
    return error.code === 'ENOENT' || error.code === 'ENOTDIR';
  }
}

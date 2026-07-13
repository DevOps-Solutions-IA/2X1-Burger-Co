import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
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
    this.manifest = existsSync(manifestPath)
      ? loadReleaseManifest(manifestPath)
      : developmentReleaseManifest();
  }

  getVersion() {
    return {
      component: 'api' as const,
      ...this.manifest,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    const startedAt = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const databaseLatencyMs = Date.now() - startedAt;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      services: {
        api: 'ok',
        database: 'ok',
      },
      checks: {
        databaseLatencyMs,
      },
      environment: process.env.NODE_ENV ?? 'development',
    };
  }
}

import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaExceptionFilter } from '../../common/filters/prisma-exception.filter';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { HermesWhatsappProvider } from '../../modules/sofia/whatsapp/hermes-whatsapp.provider';
import { MockWhatsappProvider } from '../../modules/sofia/whatsapp/mock-whatsapp.provider';
import { NullWhatsappProvider } from '../../modules/sofia/whatsapp/null-whatsapp.provider';
import { SofiaWhatsappQrGatewayProvider } from '../../modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider';
import { WhatsappProviderFactory } from '../../modules/sofia/whatsapp/whatsapp-provider.factory';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WhatsappProviderFactory)
    .useFactory({
      factory: (
        config: ConfigService,
        hermes: HermesWhatsappProvider,
        qrGateway: SofiaWhatsappQrGatewayProvider,
        nullProvider: NullWhatsappProvider,
      ) => new WhatsappProviderFactory(config, new MockWhatsappProvider(), hermes, qrGateway, nullProvider),
      inject: [ConfigService, HermesWhatsappProvider, SofiaWhatsappQrGatewayProvider, NullWhatsappProvider],
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma };
}

export async function closeTestApp(app?: INestApplication) {
  if (app) {
    const httpServer = app.getHttpServer?.();
    if (httpServer && typeof httpServer.closeAllConnections === 'function') {
      httpServer.closeAllConnections();
    }
    await app.close();
    try {
      await app.get(PrismaService).$disconnect();
    } catch {
      // The Nest lifecycle normally disconnects Prisma; this is a defensive test teardown.
    }
    if (httpServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
}

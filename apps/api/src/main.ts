import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import type { AppEnv } from './config/env';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
  });

  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  if (nodeEnv === 'production' && !config.get('COOKIE_SECURE', { infer: true })) {
    logger.warn(
      'COOKIE_SECURE=false en produccion. Las cookies de refresh token se enviaran sin flag Secure. ' +
        'Esto las expone a interceptacion en redes no seguras. Se recomienda activar HTTPS y establecer COOKIE_SECURE=true.',
    );
  }
  const origins = config
    .get('CORS_ORIGIN', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins,
    credentials: true,
  });

  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();

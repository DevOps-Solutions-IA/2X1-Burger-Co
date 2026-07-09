import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch()
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest<{
      method?: string;
      url?: string;
    }>();

    if (exception instanceof HttpException) {
      if (exception.getStatus() >= 500) {
        this.logger.error(
          `HTTP ${exception.getStatus()} on ${request.method ?? 'UNKNOWN'} ${request.url ?? ''}`,
          exception.stack,
        );
      }
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        throw new ConflictException('El recurso ya existe.');
      }

      if (exception.code === 'P2025') {
        throw new NotFoundException('No se encontró el recurso solicitado.');
      }
    }

    this.logger.error(
      `Unhandled exception on ${request.method ?? 'UNKNOWN'} ${request.url ?? ''}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    response.status(500).json(
      new InternalServerErrorException('Ocurrió un error inesperado en el servidor.').getResponse(),
    );
  }
}

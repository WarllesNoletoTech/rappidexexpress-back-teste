import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof Error
        ? exception.message
        : 'Erro inesperado ao processar requisição.';

    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `Erro HTTP tratado sem encerrar o processo: ${request?.method} ${request?.url} - ${message}`,
      stack,
    );

    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      statusCode: status,
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Erro interno do servidor.'
          : message,
      timestamp: new Date().toISOString(),
      path: request?.url,
    });
  }
}

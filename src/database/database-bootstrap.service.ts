import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CitySeedService } from './seeds/city-seed.service';

@Injectable()
export class DatabaseBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseBootstrapService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly citySeedService: CitySeedService,
  ) {}

  onApplicationBootstrap(): void {
    setImmediate(() => {
      void this.initializeDatabaseSafely();
    });
  }

  private async initializeDatabaseSafely(): Promise<void> {
    try {
      if (!this.dataSource.isInitialized) {
        this.logger.log('Inicializando conexão MongoDB em segundo plano.');
        await this.dataSource.initialize();
      }

      this.logger.log('Conexão MongoDB inicializada com sucesso.');
      await this.citySeedService.seedDefaultCitySafely();
    } catch (error: any) {
      this.logger.error(
        `Falha ao inicializar MongoDB em segundo plano; servidor continuará ativo. ${error?.message || error}`,
        error?.stack,
      );
    }
  }
}

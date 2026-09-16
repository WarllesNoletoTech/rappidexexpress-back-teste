import { Global, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CityEntity,
  DeliveryEntity,
  FinancialSettlementHistoryEntity,
  IfoodCreditHistoryEntity,
  IfoodEventEntity,
  IfoodOrderLinkEntity,
  LogEntity,
  UserEntity,
} from './entities';
import { CitySeedService } from './seeds/city-seed.service';
import { PostgresCompatRepository } from './postgres-compat.repository';

const DATABASE_ENTITIES = [
  UserEntity,
  DeliveryEntity,
  LogEntity,
  CityEntity,
  IfoodOrderLinkEntity,
  IfoodEventEntity,
  IfoodCreditHistoryEntity,
  FinancialSettlementHistoryEntity,
];

const repositoryProviders: Provider[] = DATABASE_ENTITIES.map((entity) => ({
  provide: getRepositoryToken(entity),
  inject: [DataSource],
  useFactory: (dataSource: DataSource) =>
    new PostgresCompatRepository(dataSource.getRepository(entity)),
}));

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');

        if (!databaseUrl) {
          throw new Error(
            'DATABASE_URL não configurada. Copie a string Session pooler do Supabase para DATABASE_URL.',
          );
        }

        const sslEnabled =
          configService.get<string>('DATABASE_SSL', 'true') !== 'false';
        const poolMax = Math.max(
          1,
          Number(configService.get<string>('DATABASE_POOL_MAX', '5')) || 5,
        );

        return {
          type: 'postgres' as const,
          url: databaseUrl,
          entities: DATABASE_ENTITIES,
          synchronize:
            configService.get<string>('TYPEORM_SYNCHRONIZE', 'false') === 'true',
          logging:
            configService.get<string>('TYPEORM_LOGGING', 'false') === 'true',
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
          extra: {
            max: poolMax,
            connectionTimeoutMillis: 15000,
            idleTimeoutMillis: 30000,
            keepAlive: true,
          },
        };
      },
    }),
  ],
  providers: [...repositoryProviders, CitySeedService],
  exports: [...repositoryProviders],
})
export class DatabaseModule {}

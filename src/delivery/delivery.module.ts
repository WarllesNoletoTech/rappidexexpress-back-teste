import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CityEntity,
  DeliveryEntity,
  LogEntity,
  UserEntity,
} from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { IfoodModule } from '../ifood/ifood.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      DeliveryEntity,
      LogEntity,
      CityEntity,
    ]),
    forwardRef(() => IfoodModule),
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService, OrdersGateway],
  exports: [DeliveryService, OrdersGateway],
})
export class DeliveryModule {}

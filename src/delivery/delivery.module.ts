import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { OrdersGateway } from '../gateway/orders.gateway';
import { IfoodModule } from '../ifood/ifood.module';

@Module({
  imports: [forwardRef(() => IfoodModule)],
  controllers: [DeliveryController],
  providers: [DeliveryService, OrdersGateway],
  exports: [DeliveryService, OrdersGateway],
})
export class DeliveryModule {}

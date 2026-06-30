import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { IfoodOrderLinkEntity } from '../database/entities';

@Injectable()
export class IfoodOrderLinkService implements OnModuleInit {
  private readonly logger = new Logger(IfoodOrderLinkService.name);
  constructor(
    @InjectRepository(IfoodOrderLinkEntity)
    private readonly ifoodOrderLinkRepository: MongoRepository<IfoodOrderLinkEntity>,
  ) {}

  async onModuleInit() {
    await this.ensureIfoodOrderLinkIndexes();
  }

  private async ensureIfoodOrderLinkIndexes() {
    const indexName = 'IDX_IFOOD_ORDER_LINK_ORDER_MERCHANT_UNIQUE';

    try {
      await this.ifoodOrderLinkRepository.createCollectionIndex(
        { ifoodOrderId: 1, merchantId: 1 },
        {
          name: indexName,
          unique: true,
          partialFilterExpression: {
            ifoodOrderId: { $type: 'string' },
            merchantId: { $type: 'string' },
          },
        },
      );
      this.logger.log(
        `Índice MongoDB garantido em ifood_order_link: ${indexName}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Falha ao garantir índice MongoDB em ifood_order_link: ${indexName}. keys={"ifoodOrderId":1,"merchantId":1} unique=true code=${error?.code || 'N/A'} codeName=${error?.codeName || 'N/A'} message=${error?.message || error}. Rode npm run diagnose:mongo no Heroku para localizar vínculos duplicados.`,
        error?.stack,
      );
    }
  }

  async findByIfoodOrderId(ifoodOrderId: string, merchantId?: string | null) {
    if (merchantId) {
      return this.ifoodOrderLinkRepository.findOneBy({
        ifoodOrderId,
        merchantId,
      });
    }
    return this.ifoodOrderLinkRepository.findOneBy({ ifoodOrderId });
  }

  async findByDeliveryId(deliveryId: string) {
    return this.ifoodOrderLinkRepository.findOneBy({ deliveryId });
  }

  async findByDeliveryIds(deliveryIds: string[]) {
    if (!deliveryIds.length) {
      return [];
    }

    return this.ifoodOrderLinkRepository.find({
      where: {
        deliveryId: { $in: deliveryIds },
      } as any,
    });
  }

  async findByShopkeeperId(shopkeeperId: string) {
    return this.ifoodOrderLinkRepository.find({
      where: { shopkeeperId },
      order: { createdAt: 'DESC' as any },
    } as any);
  }

  async createLink(data: {
    ifoodOrderId: string;
    ifoodDisplayId: string;
    merchantId: string;
    merchantName?: string;
    deliveryId: string;
    shopkeeperId: string;
  }) {
    return this.ifoodOrderLinkRepository.save({
      ...data,
      createdAt: new Date(),
    });
  }
}

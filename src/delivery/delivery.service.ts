import {
  BadRequestException,
  forwardRef,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CityEntity,
  DeliveryEntity,
  LogEntity,
  UserEntity,
} from '../database/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { addHours } from 'date-fns';

import {
  ConfigsDto,
  CreateDeliveryDto,
  DeliveryResult,
  ListDeliveriesQueryDTO,
  ListDeliverysResult,
  UpdateDeliveryDto,
  ReleaseDeliveryDto,
} from './dto';
import { UserRequest } from '../shared/interfaces';
import {
  Permissions,
  StatusDelivery,
  UserType,
} from '../shared/constants/enums.constants';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { IfoodCreditsService } from '../ifood/ifood-credits.service';
import { IfoodEventService } from '../ifood/ifood-event.service';
import { sendNotificationsFor } from 'src/shared/utils/notification.functions';
import { OrdersGateway } from '../gateway/orders.gateway';

type DashboardDateRange = {
  createdIn: string;
  createdUntil: string;
  start: Date;
  end: Date;
};

@Injectable()
export class DeliveryService implements OnModuleInit {
  private readonly logger = new Logger(DeliveryService.name);
  motoboysDeliveriesAmount = 2;
  blockDeliverys = false;
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    @InjectRepository(LogEntity)
    private readonly logRepository: MongoRepository<LogEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepository: MongoRepository<CityEntity>,
    private readonly ordersGateway: OrdersGateway,
    @Inject(forwardRef(() => IfoodOrdersService))
    private readonly ifoodOrdersService: IfoodOrdersService,
    @Inject(forwardRef(() => IfoodOrderLinkService))
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    @Inject(forwardRef(() => IfoodCreditsService))
    private readonly ifoodCreditsService: IfoodCreditsService,
    @Inject(forwardRef(() => IfoodEventService))
    private readonly ifoodEventService: IfoodEventService,
  ) {}

  private isAdminOrSuperAdmin(user: UserEntity | UserRequest) {
    const type = String(user?.type || '').toLowerCase();
    const permission = String(
      (user as UserEntity)?.permission || '',
    ).toLowerCase();

    return (
      type === UserType.ADMIN ||
      type === UserType.SUPERADMIN ||
      type === Permissions.MASTER ||
      permission === Permissions.MASTER
    );
  }

  private isShopkeeperUser(user: UserEntity | UserRequest) {
    const shopkeeperTypes = [
      UserType.SHOPKEEPER,
      UserType.SHOPKEEPERADMIN,
      'establishment',
      'store',
      'company',
      'lojista',
    ];
    const type = String(user?.type || '').toLowerCase();

    return shopkeeperTypes.includes(type as UserType);
  }

  private isDeliveryAssigned(delivery: DeliveryEntity) {
    const assignedStatuses: StatusDelivery[] = [
      StatusDelivery.ONCOURSE,
      StatusDelivery.ARRIVED_AT_STORE,
      StatusDelivery.COLLECTED,
      StatusDelivery.ARRIVED_AT_DESTINATION,
      StatusDelivery.AWAITING_CODE,
    ];

    const deliveryData = delivery as any;

    return Boolean(
      deliveryData?.motoboy?.id ||
      deliveryData?.motoboyId ||
      deliveryData?.deliveryManId ||
      deliveryData?.assignedTo ||
      deliveryData?.courierId ||
      (deliveryData?.motoboy && Object.keys(deliveryData.motoboy).length > 0) ||
      assignedStatuses.includes(delivery?.status),
    );
  }

  private validateStoreCanUpdateDeliveryStatus(
    user: UserEntity | UserRequest,
    delivery: DeliveryEntity,
  ) {
    if (this.isAdminOrSuperAdmin(user)) {
      return;
    }

    if (this.isShopkeeperUser(user) && this.isDeliveryAssigned(delivery)) {
      throw new ForbiddenException(
        'Este pedido já foi atribuído a um motoboy. Apenas administradores podem alterar o status.',
      );
    }
  }

  private ensureShopkeeperCanCancelDelivery(
    user: UserEntity | UserRequest,
    delivery: DeliveryEntity,
  ) {
    this.validateStoreCanUpdateDeliveryStatus(user, delivery);
  }

  private async sendIfoodStatusUpdate<T>(params: {
    deliveryId: string;
    ifoodOrderId: string;
    merchantId: string;
    oldStatus?: StatusDelivery;
    newStatus: StatusDelivery;
    action: string;
    request: () => Promise<T>;
  }): Promise<T> {
    const {
      deliveryId,
      ifoodOrderId,
      merchantId,
      oldStatus,
      newStatus,
      action,
      request,
    } = params;

    this.logger.log(
      `ifood_status_sync tentativa deliveryId=${deliveryId} ifoodOrderId=${ifoodOrderId} merchantId=${merchantId} statusAntigo=${oldStatus || 'N/A'} statusNovo=${newStatus} acao=${action}`,
    );

    try {
      const response = await request();

      this.logger.log(
        `ifood_status_sync sucesso deliveryId=${deliveryId} ifoodOrderId=${ifoodOrderId} merchantId=${merchantId} statusAntigo=${oldStatus || 'N/A'} statusNovo=${newStatus} acao=${action} resposta=${JSON.stringify(response)}`,
      );

      return response;
    } catch (error: any) {
      this.logger.error(
        `ifood_status_sync falha deliveryId=${deliveryId} ifoodOrderId=${ifoodOrderId} merchantId=${merchantId} statusAntigo=${oldStatus || 'N/A'} statusNovo=${newStatus} acao=${action} httpStatus=${error?.response?.status || error?.status || 'N/A'} resposta=${JSON.stringify(error?.response?.data || null)} erro=${error?.response?.data?.message || error?.message || error}`,
        error?.stack || error,
      );

      throw error;
    }
  }

  private async syncIfoodOnCourseIfNeeded(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    orderId?: string,
    merchantId?: string,
  ) {
    void orderId;
    void merchantId;

    return this.syncIfoodIfNeeded(previousDelivery, nextDelivery, {
      status: StatusDelivery.ONCOURSE,
    } as UpdateDeliveryDto);
  }

  private async ensureIfoodOnCourseSynced(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    orderId: string,
    merchantId: string,
  ): Promise<
    Partial<
      Record<
        | 'ifoodAssignDriverSynced'
        | 'ifoodGoingToOriginSynced'
        | 'ifoodArrivedAtOriginSynced'
        | 'ifoodDispatchSynced',
        boolean
      >
    >
  > {
    const flags: Partial<
      Record<
        | 'ifoodAssignDriverSynced'
        | 'ifoodGoingToOriginSynced'
        | 'ifoodArrivedAtOriginSynced'
        | 'ifoodDispatchSynced',
        boolean
      >
    > = {};

    const motoboy = nextDelivery?.motoboy || previousDelivery?.motoboy;

    if (!motoboy) {
      this.logger.warn(
        `Não foi possível sincronizar ACAMINHO sem motoboy. DeliveryId: ${previousDelivery?.id}.`,
      );
      return flags;
    }

    if (!previousDelivery.ifoodAssignDriverSynced) {
      await this.sendIfoodStatusUpdate({
        deliveryId: previousDelivery.id,
        ifoodOrderId: orderId,
        merchantId,
        oldStatus: previousDelivery.status,
        newStatus: StatusDelivery.ONCOURSE,
        action: 'assignDriver',
        request: () =>
          this.ifoodOrdersService.assignDriver(orderId, motoboy, merchantId),
      });
      flags.ifoodAssignDriverSynced = true;

      this.logger.log(
        `assignDriver enviado ao iFood quando motoboy aceitou entrega. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
      );
    }

    if (!previousDelivery.ifoodGoingToOriginSynced) {
      await this.sendIfoodStatusUpdate({
        deliveryId: previousDelivery.id,
        ifoodOrderId: orderId,
        merchantId,
        oldStatus: previousDelivery.status,
        newStatus: StatusDelivery.ONCOURSE,
        action: 'goingToOrigin',
        request: () =>
          this.ifoodOrdersService.notifyGoingToOrigin(orderId, merchantId),
      });
      flags.ifoodGoingToOriginSynced = true;

      this.logger.log(
        `goingToOrigin enviado ao iFood quando pedido ficou ACAMINHO. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
      );
    }

    return flags;
  }

  private async syncIfoodIfNeeded(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ): Promise<
    Partial<
      Record<
        | 'ifoodAssignDriverSynced'
        | 'ifoodGoingToOriginSynced'
        | 'ifoodArrivedAtOriginSynced'
        | 'ifoodDispatchSynced'
        | 'ifoodArrivedAtDestinationSynced',
        boolean
      >
    >
  > {
    const nextStatus = deliveryData.status || nextDelivery?.status;

    if (!nextStatus) {
      return {};
    }

    if (
      previousDelivery.status === nextStatus &&
      ![
        StatusDelivery.ONCOURSE,
        StatusDelivery.ARRIVED_AT_STORE,
        StatusDelivery.COLLECTED,
        StatusDelivery.ARRIVED_AT_DESTINATION,
        StatusDelivery.AWAITING_CODE,
      ].includes(nextStatus)
    ) {
      return {};
    }

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      previousDelivery.id,
    );

    if (!ifoodLink) {
      return {};
    }

    this.logger.log(
      `Pedido iFood identificado para sincronização. DeliveryId: ${previousDelivery.id}.`,
    );

    const orderId = String(ifoodLink.ifoodOrderId || '').trim();
    const merchantId = String(ifoodLink.merchantId || '').trim();

    if (!orderId || !merchantId) {
      this.logger.warn(
        `Delivery ${previousDelivery.id} é iFood, mas sem orderId/merchantId válidos. Sincronização ignorada.`,
      );
      return {};
    }

    try {
      if (nextStatus === StatusDelivery.ONCOURSE) {
        return await this.ensureIfoodOnCourseSynced(
          previousDelivery,
          nextDelivery,
          orderId,
          merchantId,
        );
      }

      if (nextStatus === StatusDelivery.ARRIVED_AT_STORE) {
        const flags = await this.ensureIfoodOnCourseSynced(
          previousDelivery,
          nextDelivery,
          orderId,
          merchantId,
        );

        if (!previousDelivery.ifoodArrivedAtOriginSynced) {
          await this.sendIfoodStatusUpdate({
            deliveryId: previousDelivery.id,
            ifoodOrderId: orderId,
            merchantId,
            oldStatus: previousDelivery.status,
            newStatus: StatusDelivery.ARRIVED_AT_STORE,
            action: 'arrivedAtOrigin',
            request: () =>
              this.ifoodOrdersService.notifyArrivedAtOrigin(
                orderId,
                merchantId,
              ),
          });
          flags.ifoodArrivedAtOriginSynced = true;
          this.logger.log(
            `arrivedAtOrigin enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
          );
        }

        return flags;
      }

      if (nextStatus === StatusDelivery.COLLECTED) {
        const flags = await this.ensureIfoodOnCourseSynced(
          previousDelivery,
          nextDelivery,
          orderId,
          merchantId,
        );

        if (!previousDelivery.ifoodDispatchSynced) {
          await this.sendIfoodStatusUpdate({
            deliveryId: previousDelivery.id,
            ifoodOrderId: orderId,
            merchantId,
            oldStatus: previousDelivery.status,
            newStatus: StatusDelivery.COLLECTED,
            action: 'dispatch',
            request: () =>
              this.ifoodOrdersService.dispatchLogisticsOrder(
                orderId,
                merchantId,
              ),
          });
          flags.ifoodDispatchSynced = true;
          this.logger.log(
            `dispatch enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
          );
        }

        return flags;
      }

      if (
        nextStatus === StatusDelivery.ARRIVED_AT_DESTINATION ||
        nextStatus === StatusDelivery.AWAITING_CODE
      ) {
        if (!previousDelivery.ifoodArrivedAtDestinationSynced) {
          await this.sendIfoodStatusUpdate({
            deliveryId: previousDelivery.id,
            ifoodOrderId: orderId,
            merchantId,
            oldStatus: previousDelivery.status,
            newStatus: nextStatus,
            action: 'arrivedAtDestination',
            request: () =>
              this.ifoodOrdersService.notifyArrivedAtDestination(
                orderId,
                merchantId,
              ),
          });
          this.logger.log(
            `arrivedAtDestination enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
          );
        }
        return { ifoodArrivedAtDestinationSynced: true };
      }

      if (nextStatus === StatusDelivery.CANCELED) {
        try {
          const cancellationResult =
            await this.ifoodOrdersService.requestCancellation(
              orderId,
              'Cancelado no Rappidex pela alteração do status da entrega.',
              merchantId,
            );
          this.logger.warn(
            `Solicitação de cancelamento enviada ao iFood por mudança de status. DeliveryId: ${previousDelivery.id}. OrderId: ${orderId}. Accepted: ${cancellationResult?.accepted === true}. Resultado: ${JSON.stringify(cancellationResult)}`,
          );

          if (cancellationResult?.accepted !== true) {
            this.logger.warn(
              `iFood não aceitou a solicitação de cancelamento para delivery ${previousDelivery.id}. Divergência evitada: pedido local cancelado, aguardando evento CANCELLED. Motivo: ${cancellationResult?.message || 'não informado'}`,
            );
          }
        } catch (error: any) {
          this.logger.warn(
            `Falha ao solicitar cancelamento no iFood para delivery ${previousDelivery.id}. Divergência potencial: pedido local cancelado sem confirmação externa. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
          );
        }

        return {};
      }

      if (nextStatus === StatusDelivery.FINISHED) {
        if (previousDelivery.status === StatusDelivery.FINISHED) {
          this.logger.log(
            `Finalização idempotente no Rappidex. DeliveryId: ${previousDelivery.id}. IfoodOrderId: ${orderId}.`,
          );
          return {};
        }

        if (
          !previousDelivery.ifoodArrivedAtDestinationSynced &&
          previousDelivery.status !== StatusDelivery.ARRIVED_AT_DESTINATION &&
          previousDelivery.status !== StatusDelivery.AWAITING_CODE
        ) {
          throw new BadRequestException(
            'Antes de finalizar, informe a chegada no destino para sincronizar o iFood.',
          );
        }

        const isOrderAlreadyCanceled = await this.isIfoodOrderCanceled(
          orderId,
          merchantId,
        );

        if (isOrderAlreadyCanceled) {
          throw new BadRequestException(
            'Este pedido foi cancelado no iFood e não pode ser finalizado no Rappidex. Cancele a entrega localmente.',
          );
        }

        const hasDeliveryDropCodeRequested =
          await this.ifoodEventService.hasDeliveryDropCodeRequested(orderId);

        const usesExternalIfoodPdv = Boolean(
          previousDelivery?.establishment?.usesExternalIfoodPdv,
        );

        if (!hasDeliveryDropCodeRequested) {
          const ifoodConclusionStatus = await this.getIfoodConclusionStatus(
            orderId,
            merchantId,
          );

          if (ifoodConclusionStatus.isConcluded) {
            this.logger.warn(
              `ifood_sync action=finalizado_localmente_sem_drop_code loja="${previousDelivery?.establishment?.name || ''}" merchantId="${merchantId || ''}" usesExternalIfoodPdv=${usesExternalIfoodPdv} ifoodOrderId="${orderId}" displayId="${previousDelivery?.id || ''}" ifoodStatus="${ifoodConclusionStatus.status}" localStatusBefore="${previousDelivery.status}" localStatusAfter="${StatusDelivery.FINISHED}"`,
            );
            return {};
          }

          throw new BadRequestException(
            'O pedido ainda não está elegível para validação do código no iFood (DELIVERY_DROP_CODE_REQUESTED).',
          );
        }

        if (!deliveryData.deliveryCode) {
          throw new BadRequestException(
            'Informe o código de entrega do iFood para finalizar este pedido.',
          );
        }

        this.logger.log(
          `verifyDeliveryCode enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
        );

        let verifyResult: any;
        try {
          verifyResult = await this.ifoodOrdersService.verifyDeliveryCode(
            orderId,
            deliveryData.deliveryCode,
            merchantId,
          );
        } catch (error: any) {
          const usesExternalIfoodPdv = Boolean(
            previousDelivery?.establishment?.usesExternalIfoodPdv,
          );
          const ifoodConclusionStatus = await this.getIfoodConclusionStatus(
            orderId,
            merchantId,
          );

          if (ifoodConclusionStatus.isConcluded) {
            this.logger.warn(
              `ifood_sync action=finalizado_localmente loja="${previousDelivery?.establishment?.name || ''}" merchantId="${merchantId || ''}" usesExternalIfoodPdv=${usesExternalIfoodPdv} ifoodOrderId="${orderId}" displayId="${previousDelivery?.id || ''}" ifoodStatus="${ifoodConclusionStatus.status}" localStatusBefore="${previousDelivery.status}" localStatusAfter="${StatusDelivery.FINISHED}"`,
            );
            return {};
          }

          throw error;
        }

        if (verifyResult?.success === false) {
          throw new BadRequestException('Código de entrega inválido.');
        }
      }

      return {};
    } catch (error: any) {
      this.logger.error(
        `Falha ao sincronizar delivery ${previousDelivery.id} com o iFood. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
        error?.stack || error,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Não foi possível sincronizar o status da entrega com o iFood.',
      );
    }
  }

  private async isIfoodOrderCanceled(
    orderId: string,
    merchantId?: string | null,
  ) {
    try {
      const orderDetails = await this.ifoodOrdersService.getOrderDetails(
        orderId,
        merchantId,
      );

      const orderStatus = String(
        orderDetails?.orderStatus ||
          orderDetails?.status ||
          orderDetails?.metadata?.status ||
          '',
      ).toUpperCase();

      return orderStatus.includes('CANCEL');
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível verificar o status do pedido iFood ${orderId} antes da finalização local. ${error?.message || error}`,
      );
      return false;
    }
  }

  private async getIfoodConclusionStatus(
    orderId: string,
    merchantId?: string | null,
  ) {
    try {
      const orderDetails = await this.ifoodOrdersService.getOrderDetails(
        orderId,
        merchantId,
      );
      const orderStatus = String(
        orderDetails?.orderStatus ||
          orderDetails?.status ||
          orderDetails?.metadata?.status ||
          '',
      )
        .trim()
        .toUpperCase();

      const isConcluded = [
        'CONCLUDED',
        'COMPLETED',
        'DELIVERED',
        'FINALIZED',
        'ENTREGUE',
        'CONCLUID',
      ].some((statusToken) => orderStatus.includes(statusToken));

      return { status: orderStatus || 'UNKNOWN', isConcluded };
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível consultar o status final do pedido iFood ${orderId}. ${error?.message || error}`,
      );
      return { status: 'UNKNOWN', isConcluded: false };
    }
  }

  async onModuleInit() {
    await this.ensureDeliveryIndexes();
  }

  private async ensureDeliveryIndexes() {
    const indexes = [
      { keys: { status: 1 }, options: { name: 'IDX_DELIVERIES_STATUS' } },
      {
        keys: { 'establishment.cityId': 1 },
        options: { name: 'IDX_DELIVERIES_CITY_ID' },
      },
      {
        keys: { 'motoboy.id': 1 },
        options: { name: 'IDX_DELIVERIES_MOTOBOY_ID' },
      },
      {
        keys: { 'establishment.id': 1 },
        options: { name: 'IDX_DELIVERIES_ESTABLISHMENT_ID' },
      },
      {
        keys: { createdAt: -1 },
        options: { name: 'IDX_DELIVERIES_CREATED_AT' },
      },
      {
        keys: { updatedAt: -1 },
        options: { name: 'IDX_DELIVERIES_UPDATED_AT' },
      },
      {
        keys: { finishedAt: -1 },
        options: { name: 'IDX_DELIVERIES_FINISHED_AT' },
      },
      { keys: { isActive: 1 }, options: { name: 'IDX_DELIVERIES_IS_ACTIVE' } },
      {
        keys: { isActive: 1, 'establishment.cityId': 1, createdAt: -1 },
        options: { name: 'IDX_DELIVERIES_ACTIVE_CITY_CREATED_AT' },
      },
      {
        keys: {
          isActive: 1,
          status: 1,
          'establishment.cityId': 1,
          finishedAt: -1,
        },
        options: { name: 'IDX_DELIVERIES_ACTIVE_STATUS_CITY_FINISHED_AT' },
      },
      {
        keys: {
          isActive: 1,
          status: 1,
          'establishment.cityId': 1,
          createdAt: -1,
        },
        options: { name: 'IDX_DELIVERIES_ACTIVE_STATUS_CITY_CREATED_AT' },
      },
      {
        keys: { isActive: 1, 'motoboy.id': 1, finishedAt: -1 },
        options: { name: 'IDX_DELIVERIES_ACTIVE_MOTOBOY_FINISHED_AT' },
      },
      {
        keys: { isActive: 1, 'establishment.id': 1, finishedAt: -1 },
        options: { name: 'IDX_DELIVERIES_ACTIVE_ESTABLISHMENT_FINISHED_AT' },
      },
      {
        keys: { isActive: 1, 'motoboy.id': 1, status: 1, createdAt: -1 },
        options: { name: 'IDX_DELIVERIES_ACTIVE_MOTOBOY_STATUS_CREATED_AT' },
      },
      {
        keys: { ifoodOrderId: 1, ifoodMerchantId: 1 },
        options: {
          name: 'IDX_DELIVERIES_IFOOD_ORDER_MERCHANT_UNIQUE',
          unique: true,
          partialFilterExpression: {
            ifoodOrderId: { $type: 'string' },
            ifoodMerchantId: { $type: 'string' },
          },
        },
      },
    ];

    for (const index of indexes) {
      try {
        await this.deliveryRepository.createCollectionIndex(
          index.keys,
          index.options,
        );
        this.logger.log(
          `Índice MongoDB garantido em delivery: ${index.options.name}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Falha ao garantir índice MongoDB em delivery: ${index.options.name}. keys=${JSON.stringify(index.keys)} unique=${Boolean((index.options as any).unique)} code=${error?.code || 'N/A'} codeName=${error?.codeName || 'N/A'} message=${error?.message || error}. Rode npm run diagnose:mongo no Heroku para localizar documentos duplicados/incompatíveis.`,
          error?.stack,
        );
      }
    }
  }

  private shouldSyncIfoodInBackground(status?: StatusDelivery) {
    void status;
    return false;
  }

  private syncIfoodInBackground(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ) {
    void this.syncIfoodIfNeeded(
      previousDelivery,
      nextDelivery,
      deliveryData,
    ).catch((error: any) => {
      this.logger.error(
        `Falha assíncrona ao sincronizar delivery ${previousDelivery.id} com iFood.`,
        error?.stack || error,
      );
    });
  }

  private async refundCreditForCanceledDelivery(
    delivery: DeliveryEntity,
    reason: string,
    ifoodOrderId?: string,
  ) {
    const establishmentId = delivery?.establishment?.id;
    if (!establishmentId) {
      return;
    }

    await this.ifoodCreditsService.refundCreditForOrder(
      establishmentId,
      ifoodOrderId || delivery.id,
      reason,
    );
  }

  private sendStatusNotificationInBackground(
    subscriptionId: string,
    message: string,
  ) {
    void sendNotificationsFor([subscriptionId], message).catch((error: any) => {
      this.logger.warn(
        `Falha assíncrona ao enviar notificação de status da entrega. ${error?.message || error}`,
      );
    });
  }

  private notifyNewDeliveryInBackground(
    newDelivery: DeliveryEntity,
    deliveryStatus: StatusDelivery,
    establishment: UserEntity,
    motoboy: UserEntity | null,
    userFinded: UserEntity,
  ) {
    const newLog = {
      id: uuid(),
      where: 'Criação de um delivery',
      type: 'Log para notificações',
      error: 'Sem error',
      user: userFinded,
      status: 'Notificação enviada.',
    };

    const notifyPromise =
      deliveryStatus !== StatusDelivery.ONCOURSE
        ? this.sendNotificationsToRelevantUsers(
            newDelivery.establishment.name,
            newDelivery.establishment.cityId,
          )
        : this.sendAssignedMotoboyNotification(establishment, motoboy);

    void notifyPromise.catch(async (error) => {
      newLog.error = `${error}`;
      newLog.status = 'Notificação não enviada devido ao error';

      try {
        await this.logRepository.save(newLog);
      } catch (logError: any) {
        this.logger.warn(
          `Falha ao salvar log de erro de notificação: ${logError?.message || logError}`,
        );
      }
    });
  }

  private async sendAssignedMotoboyNotification(
    establishment: UserEntity,
    motoboy: UserEntity | null,
  ) {
    const subscriptionId = motoboy?.notification?.subscriptionId;

    if (!subscriptionId) {
      return;
    }

    await sendNotificationsFor(
      [subscriptionId],
      `Você foi atribuido a uma entrega no estabelecimento: ${establishment.name}`,
    );
  }

  async listDeliveries(
    user: UserRequest,
    queryParams: ListDeliveriesQueryDTO,
  ): Promise<ListDeliverysResult> {
    const requestStartedAt = Date.now();
    const userForRequest = await this.findOneUserById(user.id);

    const page = Number(queryParams.page || 1);
    const itemsPerPageParam = Number(queryParams.itemsPerPage || 100);
    const skip = (page - 1) * itemsPerPageParam;
    const take = itemsPerPageParam;
    const where = this.buildDeliveriesWhere(userForRequest, queryParams);
    const sortField = this.shouldUseFinishedDateFilter(queryParams)
      ? 'finishedAt'
      : 'createdAt';

    const shouldIncludeDashboardCounts = this.parseBooleanQuery(
      queryParams.includeDashboardCounts,
    );

    const dashboardCountsPromise = shouldIncludeDashboardCounts
      ? this.getDashboardCountsByUser(userForRequest, queryParams)
      : Promise.resolve(undefined);

    const queryStartedAt = Date.now();
    const [deliveries, count, dashboardCounts] = await Promise.all([
      this.deliveryRepository.find({
        relations: { motoboy: true, establishment: true },
        where,
        skip,
        take,
        order: { [sortField]: 'ASC', createdAt: 'ASC' } as any,
      }),
      this.deliveryRepository.count(where),
      dashboardCountsPromise,
    ]);
    const queryDurationMs = Date.now() - queryStartedAt;

    const ifoodLinks = await this.ifoodOrderLinkService.findByDeliveryIds(
      deliveries.map((delivery) => delivery.id),
    );
    const ifoodLinkByDeliveryId = new Map(
      ifoodLinks.map((link) => [link.deliveryId, link]),
    );
    const deliveriesWithSource = deliveries.map((delivery) => {
      const ifoodLink = ifoodLinkByDeliveryId.get(delivery.id);

      return {
        ...delivery,
        isIfoodOrder: Boolean(ifoodLink),
        ifoodOrderId: ifoodLink?.ifoodOrderId ?? null,
        ifoodDisplayId: ifoodLink?.ifoodDisplayId ?? null,
        ifoodMerchantId: ifoodLink?.merchantId ?? null,
        ifoodMerchantName: ifoodLink?.merchantName ?? null,
      };
    });

    const totalDurationMs = Date.now() - requestStartedAt;
    this.logger.log(
      `GET /api/delivery performance userId=${userForRequest.id} userType=${userForRequest.type} filters=${JSON.stringify(
        queryParams,
      )} returned=${deliveries.length} total=${count} dbQueryMs=${queryDurationMs} totalMs=${totalDurationMs}`,
    );

    return ListDeliverysResult.fromEntities(
      deliveriesWithSource as any,
      deliveries.length,
      page,
      count,
      dashboardCounts,
    );
  }

  async getDashboardCounts(
    user: UserRequest,
    queryParams: ListDeliveriesQueryDTO = {} as ListDeliveriesQueryDTO,
  ) {
    const userForRequest = await this.findOneUserById(user.id);

    return this.getDashboardCountsByUser(userForRequest, queryParams);
  }

  private async getDashboardCountsByUser(
    userForRequest: UserEntity,
    queryParams: ListDeliveriesQueryDTO = {} as ListDeliveriesQueryDTO,
  ) {
    const countQueryParams = this.applyDashboardCityFilter(
      userForRequest,
      queryParams,
    );
    const dateRange = this.resolveDashboardDateRange(countQueryParams);

    this.logger.log(
      `delivery_counts userId=${userForRequest.id} userType=${userForRequest.type} cityId=${
        countQueryParams.cityId || 'N/A'
      } createdIn=${dateRange.createdIn} createdUntil=${dateRange.createdUntil}`,
    );

    if (
      userForRequest.type === UserType.SUPERADMIN &&
      !countQueryParams.cityId
    ) {
      return {
        pending: 0,
        assigned: 0,
        waitingRelease: 0,
        totalEntregas: 0,
        valorAdminPorEntrega: 0,
        totalValorAdmin: 0,
        cityId: null,
        cityName: null,
        createdIn: dateRange.createdIn,
        createdUntil: dateRange.createdUntil,
        weekStartsOn: 'TUESDAY',
        weekEndsOn: 'MONDAY',
      };
    }

    const pendingWhere = this.buildDeliveriesWhere(userForRequest, {
      ...countQueryParams,
      status: StatusDelivery.PENDING,
    } as ListDeliveriesQueryDTO);
    Object.assign(
      pendingWhere,
      this.buildDashboardDateWhere(StatusDelivery.PENDING, dateRange),
    );

    const assignedWhere = this.buildAssignedDeliveriesWhere(
      userForRequest,
      countQueryParams,
    );
    Object.assign(
      assignedWhere,
      this.buildDashboardDateWhere(StatusDelivery.ONCOURSE, dateRange),
    );

    const waitingReleaseWhere = this.buildDeliveriesWhere(userForRequest, {
      ...countQueryParams,
      status: StatusDelivery.AWAITING_RELEASE,
    } as ListDeliveriesQueryDTO);
    Object.assign(
      waitingReleaseWhere,
      this.buildDashboardDateWhere(StatusDelivery.AWAITING_RELEASE, dateRange),
    );

    const adminFinancialWhere = this.buildDeliveriesWhere(userForRequest, {
      ...countQueryParams,
      status: StatusDelivery.FINISHED,
    } as ListDeliveriesQueryDTO);
    Object.assign(
      adminFinancialWhere,
      this.buildDashboardDateWhere(StatusDelivery.FINISHED, dateRange),
    );

    try {
      const [pending, assigned, waitingRelease, totalEntregas, city] =
        await Promise.all([
          this.deliveryRepository.count(pendingWhere),
          this.deliveryRepository.count(assignedWhere),
          this.deliveryRepository.count(waitingReleaseWhere),
          this.deliveryRepository.count(adminFinancialWhere),
          countQueryParams.cityId
            ? this.findCityEntityById(countQueryParams.cityId)
            : Promise.resolve(null),
        ]);

      const valorAdminPorEntrega = this.getAdminDeliveryFeeValue(city);

      return {
        pending,
        assigned,
        waitingRelease,
        totalEntregas,
        valorAdminPorEntrega,
        totalValorAdmin: totalEntregas * valorAdminPorEntrega,
        cityId: city?.id?.toHexString?.() ?? countQueryParams.cityId ?? null,
        cityName: city?.name ?? null,
        createdIn: dateRange.createdIn,
        createdUntil: dateRange.createdUntil,
        weekStartsOn: 'TUESDAY',
        weekEndsOn: 'MONDAY',
      };
    } catch (error: any) {
      this.logger.error(
        `delivery_counts_error userId=${userForRequest.id} userType=${userForRequest.type} cityId=${
          countQueryParams.cityId || 'N/A'
        } createdIn=${dateRange.createdIn} createdUntil=${dateRange.createdUntil} message=${
          error?.message || error
        }`,
        error?.stack,
      );
      throw new BadRequestException(
        'Não foi possível carregar o contador de entregas.',
      );
    }
  }

  private resolveDashboardDateRange(
    queryParams: ListDeliveriesQueryDTO = {} as ListDeliveriesQueryDTO,
  ): DashboardDateRange {
    const startYmd =
      this.normalizeReportDateToYmd(queryParams.createdIn || null) ||
      this.getCurrentRappidexWeekYmdRange().start;
    const endYmd =
      this.normalizeReportDateToYmd(
        queryParams.createdUntil || queryParams.createdIn || null,
      ) || this.getCurrentRappidexWeekYmdRange().end;

    return {
      createdIn: startYmd,
      createdUntil: endYmd,
      start: this.createDashboardDate(startYmd),
      end: this.createDashboardDate(endYmd, true),
    };
  }

  private buildDashboardDateWhere(
    status: StatusDelivery,
    dateRange: DashboardDateRange,
  ) {
    if (status !== StatusDelivery.FINISHED) {
      return { createdAt: { $gte: dateRange.start, $lte: dateRange.end } };
    }

    const missingFinishedAt = {
      $or: [{ finishedAt: null }, { finishedAt: { $exists: false } }],
    };
    const missingUpdatedAt = {
      $or: [{ updatedAt: null }, { updatedAt: { $exists: false } }],
    };

    return {
      $or: [
        { finishedAt: { $gte: dateRange.start, $lte: dateRange.end } },
        {
          $and: [
            missingFinishedAt,
            { updatedAt: { $gte: dateRange.start, $lte: dateRange.end } },
          ],
        },
        {
          $and: [
            missingFinishedAt,
            missingUpdatedAt,
            { createdAt: { $gte: dateRange.start, $lte: dateRange.end } },
          ],
        },
      ],
    };
  }

  private getCurrentRappidexWeekYmdRange(referenceDate = new Date()) {
    const date = new Date(referenceDate);
    const weekStartDay = 2;
    const diffToTuesday = (date.getDay() - weekStartDay + 7) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - diffToTuesday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return {
      start: this.formatDashboardDateToYmd(start),
      end: this.formatDashboardDateToYmd(end),
    };
  }

  private formatDashboardDateToYmd(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private createDashboardDate(dateString: string, endOfDay = false) {
    const [year, month, day] = dateString.split('-').map(Number);

    return new Date(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
  }

  private buildAssignedDeliveriesWhere(
    userForRequest: UserEntity,
    queryParams: ListDeliveriesQueryDTO = {} as ListDeliveriesQueryDTO,
  ) {
    const where: Record<string, any> = {
      isActive: true,
      motoboy: { $ne: null },
      status: {
        $nin: [StatusDelivery.FINISHED, StatusDelivery.CANCELED],
      },
    };

    this.applyCityWhere(userForRequest, where, queryParams.cityId);

    if (userForRequest.type === UserType.MOTOBOY) {
      where['motoboy.id'] = userForRequest.id;
    }

    if (
      userForRequest.type === UserType.SHOPKEEPER ||
      userForRequest.type === UserType.SHOPKEEPERADMIN
    ) {
      where['establishment.id'] = userForRequest.id;
    }

    return where;
  }

  private applyDashboardCityFilter(
    userForRequest: UserEntity,
    queryParams: ListDeliveriesQueryDTO,
  ): ListDeliveriesQueryDTO {
    const cityId =
      userForRequest.type === UserType.SUPERADMIN
        ? queryParams.cityId || userForRequest.cityId || undefined
        : userForRequest.cityId || undefined;

    return { ...queryParams, cityId };
  }

  private applyCityWhere(
    userForRequest: UserEntity,
    where: Record<string, any>,
    selectedCityId?: string,
  ) {
    if (userForRequest.type !== UserType.SUPERADMIN) {
      where['establishment.cityId'] = userForRequest.cityId;
      return;
    }

    const cityId = selectedCityId || userForRequest.cityId;
    if (cityId) {
      where['establishment.cityId'] = cityId;
    }
  }

  private async findCityEntityById(cityId: string) {
    if (!cityId || !ObjectId.isValid(cityId)) {
      return null;
    }

    return this.cityRepository.findOne({
      where: { _id: new ObjectId(cityId) },
    });
  }

  private getAdminDeliveryFeeValue(city: CityEntity | null) {
    const value = Number(city?.deliveryFeeValue);
    return Number.isFinite(value) ? value : 0;
  }

  private parseBooleanQuery(value?: boolean | string) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  async updateDelivery(
    deliveryId: string,
    deliveryData: UpdateDeliveryDto,
    user: UserRequest,
  ) {
    const [userFinded, deliveryFinded] = await Promise.all([
      this.findOneUserById(user.id),
      this.deliveryRepository.findOneOrFail({
        where: { id: deliveryId },
        relations: { motoboy: true, establishment: true },
      }),
    ]);

    this.ensureCityAccess(
      userFinded,
      deliveryFinded.establishment?.cityId ?? userFinded.cityId,
    );

    let establishmentFinded;
    let motoboyFinded;
    const normalizedMotoboyId = this.normalizeMotoboyId(deliveryData.motoboyId);

    let changedDelivery: Record<string, any> = {};

    const isAdminUser = this.isAdminOrSuperAdmin(userFinded);

    const isShopkeeperUser = this.isShopkeeperUser(userFinded);

    if (deliveryData.status) {
      this.validateStoreCanUpdateDeliveryStatus(userFinded, deliveryFinded);
    }

    if (isAdminUser || isShopkeeperUser) {
      changedDelivery = { ...deliveryFinded, ...deliveryData };

      if (deliveryData.establishmentId) {
        if (!isAdminUser) {
          throw new UnauthorizedException(
            'Você não tem permissão para alterar o estabelecimento da entrega.',
          );
        }

        establishmentFinded = await this.findOneUserById(
          deliveryData.establishmentId,
        );
        this.ensureCityAccess(userFinded, establishmentFinded.cityId);
      }

      if (normalizedMotoboyId) {
        motoboyFinded = await this.findOneUserById(normalizedMotoboyId);

        if (motoboyFinded.type !== UserType.MOTOBOY) {
          throw new BadRequestException('Usuário selecionado não é motoboy.');
        }

        this.ensureCityAccess(userFinded, motoboyFinded.cityId);
      }
    }

    if (userFinded.type === UserType.MOTOBOY) {
      if (
        deliveryFinded.motoboy != null &&
        deliveryFinded.motoboy.id != userFinded.id
      ) {
        throw new BadRequestException(
          'Essa entrega já foi atribuída a outro entregador.',
        );
      }

      changedDelivery = { ...deliveryFinded, ...deliveryData };

      if (
        deliveryData.status === StatusDelivery.ONCOURSE &&
        !normalizedMotoboyId
      ) {
        throw new BadRequestException(
          'É necessario que você selecione a opção de motoboy.',
        );
      }

      if (normalizedMotoboyId) {
        const where = {};
        where['motoboy.id'] = userFinded.id;
        where['isActive'] = true;
        where['status'] = {
          $in: [
            StatusDelivery.PENDING,
            StatusDelivery.ONCOURSE,
            StatusDelivery.ARRIVED_AT_STORE,
            StatusDelivery.COLLECTED,
            StatusDelivery.ARRIVED_AT_DESTINATION,
            StatusDelivery.AWAITING_CODE,
          ],
        };
        where['establishment.cityId'] = userFinded.cityId;

        const deliveriesForMotoboy = await this.deliveryRepository.count(where);

        if (deliveriesForMotoboy >= this.motoboysDeliveriesAmount) {
          throw new BadRequestException(
            `Você não pode pegar mais do que ${this.motoboysDeliveriesAmount} solicitações.`,
          );
        }
        motoboyFinded = userFinded;
      }
    }

    if (establishmentFinded) {
      changedDelivery = {
        ...changedDelivery,
        establishment: establishmentFinded,
      };
    }

    if (motoboyFinded) {
      changedDelivery = {
        ...changedDelivery,
        motoboy: motoboyFinded,
      };
    }

    if (normalizedMotoboyId && !deliveryData.status) {
      const canAutoAssignStatus =
        deliveryFinded.status === StatusDelivery.PENDING;

      if (canAutoAssignStatus) {
        changedDelivery.status = StatusDelivery.ONCOURSE;
        changedDelivery['onCoursedAt'] = addHours(new Date(), -3);
      }
    }

    if (deliveryData.status === StatusDelivery.ARRIVED_AT_DESTINATION) {
      const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
        deliveryFinded.id,
      );

      if (ifoodLink?.ifoodOrderId) {
        const canRequestCode =
          await this.ifoodEventService.hasDeliveryDropCodeRequested(
            ifoodLink.ifoodOrderId,
          );

        if (canRequestCode) {
          changedDelivery.status = StatusDelivery.AWAITING_CODE;
          deliveryData.status = StatusDelivery.AWAITING_CODE;
        }
      }
    }

    if (deliveryData.status) {
      const dateForUse = addHours(new Date(), -3);
      if (deliveryData.status === StatusDelivery.ONCOURSE) {
        changedDelivery['onCoursedAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.ARRIVED_AT_STORE) {
        changedDelivery['arrivedAtStoreAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.COLLECTED) {
        changedDelivery['collectedAt'] = dateForUse;
      } else if (
        deliveryData.status === StatusDelivery.ARRIVED_AT_DESTINATION ||
        deliveryData.status === StatusDelivery.AWAITING_CODE
      ) {
        changedDelivery['arrivedAtDestinationAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.FINISHED) {
        changedDelivery['finishedAt'] = dateForUse;
      }
    }

    if (!Object.keys(changedDelivery).length) {
      throw new UnauthorizedException(
        'Você não tem permissão para atualizar esta entrega.',
      );
    }

    if (this.isObservationOnlyUpdate(deliveryData)) {
      const deliveryUpdated = await this.persistDeliveryUpdate(
        deliveryFinded.id,
        {
          ...changedDelivery,
          updatedAt: addHours(new Date(), -3),
        },
      );

      this.ordersGateway.emitDeliveryUpdated(
        DeliveryResult.fromEntity(deliveryUpdated),
        deliveryUpdated.establishment?.cityId ??
          deliveryFinded.establishment?.cityId,
      );

      return DeliveryResult.fromEntity(deliveryUpdated);
    }

    const isPendingClaimAttempt = this.isPendingClaimAttempt(
      deliveryFinded,
      deliveryData,
    );

    let deliveryUpdated: DeliveryEntity;

    if (isPendingClaimAttempt && motoboyFinded) {
      deliveryUpdated = await this.claimPendingDeliveryAtomically(
        deliveryFinded,
        changedDelivery,
        motoboyFinded,
      );

      let ifoodSyncFlags = {};

      try {
        ifoodSyncFlags =
          deliveryUpdated.status === StatusDelivery.ONCOURSE
            ? await this.syncIfoodOnCourseIfNeeded(
                deliveryFinded,
                deliveryUpdated,
              )
            : await this.syncIfoodIfNeeded(
                deliveryFinded,
                deliveryUpdated,
                deliveryData,
              );
      } catch (error: any) {
        this.logger.error(
          `Claim atômico concluído para delivery ${deliveryFinded.id}, mas falhou sincronização iFood no fluxo PENDENTE -> ACAMINHO. Mantendo atribuição local e registrando para retentativa. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
          error?.stack || error,
        );
      }

      await this.saveIfoodSyncFlags(deliveryUpdated.id, ifoodSyncFlags);
      deliveryUpdated = {
        ...deliveryUpdated,
        ...ifoodSyncFlags,
      } as DeliveryEntity;
    } else {
      const deliveryForSync = {
        ...changedDelivery,
        motoboy: motoboyFinded || changedDelivery['motoboy'],
        establishment: establishmentFinded || changedDelivery['establishment'],
      };

      const shouldSyncInBackground = this.shouldSyncIfoodInBackground(
        deliveryData.status,
      );

      let ifoodSyncFlags = {};

      if (!shouldSyncInBackground) {
        ifoodSyncFlags =
          (deliveryForSync as DeliveryEntity).status === StatusDelivery.ONCOURSE
            ? await this.syncIfoodOnCourseIfNeeded(
                deliveryFinded,
                deliveryForSync as DeliveryEntity,
              )
            : await this.syncIfoodIfNeeded(
                deliveryFinded,
                deliveryForSync as DeliveryEntity,
                deliveryData,
              );
      }

      try {
        deliveryUpdated = await this.persistDeliveryUpdate(deliveryFinded.id, {
          ...changedDelivery,
          ...ifoodSyncFlags,
          updatedAt: addHours(new Date(), -3),
        });
      } catch (error: any) {
        this.logger.error(
          `Falha ao salvar entrega ${deliveryFinded.id} no updateDelivery. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
          error?.stack || error,
        );
        throw new InternalServerErrorException(
          'Não foi possível atualizar o pedido. Tente novamente.',
        );
      }

      if (shouldSyncInBackground) {
        this.syncIfoodInBackground(
          deliveryFinded,
          deliveryUpdated,
          deliveryData,
        );
      }
    }

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(deliveryUpdated),
      deliveryUpdated.establishment?.cityId ??
        deliveryFinded.establishment?.cityId,
    );

    if (
      deliveryData.status === StatusDelivery.CANCELED &&
      deliveryFinded.status !== StatusDelivery.CANCELED
    ) {
      const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
        deliveryFinded.id,
      );

      await this.refundCreditForCanceledDelivery(
        deliveryFinded,
        'Crédito estornado por cancelamento da entrega.',
        ifoodLink?.ifoodOrderId,
      );
    }

    const subscriptionId =
      deliveryFinded.establishment?.notification?.subscriptionId;

    if (subscriptionId) {
      if (
        deliveryData.status &&
        deliveryData.status === StatusDelivery.ONCOURSE
      ) {
        const motoboyName =
          deliveryUpdated.motoboy?.name ||
          motoboyFinded?.name ||
          changedDelivery['motoboy']?.name ||
          deliveryFinded.motoboy?.name ||
          'o motoboy';

        this.sendStatusNotificationInBackground(
          subscriptionId,
          `O motoboy ${motoboyName} aceitou a entrega do pedido do(a) ${deliveryFinded.clientName} e está a caminho!`,
        );
      } else if (deliveryData.status) {
        this.sendStatusNotificationInBackground(
          subscriptionId,
          `Houve uma alteração no status da entrega do pedido do(a) ${deliveryFinded.clientName}`,
        );
      }
    }

    return DeliveryResult.fromEntity(deliveryUpdated);
  }

  private normalizeMotoboyId(motoboyId?: string | null) {
    if (motoboyId === undefined || motoboyId === null) {
      return null;
    }

    const normalized = String(motoboyId).trim();
    return normalized.length ? normalized : null;
  }

  private isObservationOnlyUpdate(data: UpdateDeliveryDto) {
    const allowedKeys = new Set([
      'destinationObservation',
      'destinationObservationConfirmed',
      'updatedAt',
    ]);

    const payloadKeys = Object.keys(data || {}).filter(
      (key) => (data as any)[key] !== undefined,
    );

    return (
      payloadKeys.length > 0 && payloadKeys.every((key) => allowedKeys.has(key))
    );
  }

  async createDelivery(
    deliveryData: CreateDeliveryDto,
    user: UserRequest,
    options?: { skipCreditConsumption?: boolean; creditOrderId?: string },
  ): Promise<DeliveryResult> {
    const userFinded = await this.findOneUserById(user.id);
    let establishment;
    let motoboy = null;
    let onCoursedAt = null;
    const {
      clientName,
      clientPhone,
      status,
      value,
      payment,
      soda,
      observation,
      clientLocation,
      clientAddress,
      addressComplement,
      addressReference,
      addressNeighborhood,
      addressCity,
      addressState,
      addressZipCode,
      addressLatitude,
      addressLongitude,
      addressMapsUrl,
      ifoodOrderId,
      ifoodDisplayId,
      orderLocator,
      ifoodMerchantId,
      ifoodMerchantName,
    } = deliveryData;

    let deliveryStatus = status;

    if (
      this.blockDeliverys &&
      user.type !== UserType.ADMIN &&
      user.type !== UserType.SUPERADMIN
    ) {
      throw new BadRequestException(
        'Infelizmente as entregas foram encerradas por hoje.',
      );
    }

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN) &&
      deliveryData.establishmentId
    ) {
      establishment = await this.findOneUserById(deliveryData.establishmentId);
      this.ensureCityAccess(userFinded, establishment.cityId);
    } else {
      establishment = userFinded;
    }

    if (!establishment?.cityId) {
      throw new BadRequestException(
        'Estabelecimento sem cidade configurada. Verifique cityId/cityName.',
      );
    }

    const normalizedMotoboyId = this.normalizeMotoboyId(deliveryData.motoboyId);

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN ||
        userFinded.type === UserType.SHOPKEEPERADMIN) &&
      normalizedMotoboyId
    ) {
      motoboy = await this.findOneUserById(normalizedMotoboyId);
      this.ensureCityAccess(userFinded, motoboy.cityId);
      deliveryStatus = StatusDelivery.ONCOURSE;
      onCoursedAt = addHours(new Date(), -3);
    }

    try {
      const deliveryId = uuid();

      if (!options?.skipCreditConsumption) {
        await this.ifoodCreditsService.consumeCreditForOrder(
          establishment.id,
          options?.creditOrderId || deliveryId,
        );
      }

      const newDelivery = await this.deliveryRepository.save({
        id: deliveryId,
        clientName,
        clientPhone,
        status: deliveryStatus,
        establishment,
        motoboy,
        value,
        payment,
        soda,
        observation,
        clientLocation,
        clientAddress,
        addressComplement,
        addressReference,
        addressNeighborhood,
        addressCity,
        addressState,
        addressZipCode,
        addressLatitude,
        addressLongitude,
        addressMapsUrl,
        ifoodOrderId,
        ifoodDisplayId,
        orderLocator: orderLocator || undefined,
        ifoodMerchantId,
        ifoodMerchantName,
        ifoodImportedAt: ifoodOrderId ? addHours(new Date(), -3) : undefined,
        isActive: true,
        createdBy: user.id,
        onCoursedAt,
        createdAt: addHours(new Date(), -3),
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryCreated(
        DeliveryResult.fromEntity(newDelivery),
        newDelivery.establishment?.cityId,
      );
      this.logger.log(
        `delivery_created id=${newDelivery.id} status=${newDelivery.status} cityId=${newDelivery.establishment?.cityId} cityName=${newDelivery.establishment?.cityName ?? ''} createdBy=${newDelivery.createdBy}`,
      );

      this.notifyNewDeliveryInBackground(
        newDelivery,
        deliveryStatus,
        establishment,
        motoboy,
        userFinded,
      );

      return DeliveryResult.fromEntity(newDelivery);
    } catch (error) {
      throw error;
    }
  }

  async cleanupStaleIfoodDeliveries(
    user: UserRequest,
    companyIdFromAdmin?: string,
  ) {
    const userFinded = await this.userRepository.findOneBy({ id: user.id });

    if (!userFinded) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const companyId =
      userFinded.type === UserType.ADMIN
        ? String(companyIdFromAdmin || '').trim() || null
        : userFinded.id;

    if (!companyId) {
      throw new BadRequestException(
        'Informe o companyId para limpeza em usuário admin.',
      );
    }

    const links =
      await this.ifoodOrderLinkService.findByShopkeeperId(companyId);

    if (links.length === 0) {
      return {
        checked: 0,
        removed: 0,
        message: 'Nenhum pedido iFood vinculado encontrado.',
      };
    }

    const deliveryIds = links.map((link) => link.deliveryId).filter(Boolean);
    const deliveries = await this.deliveryRepository.find({
      where: {
        id: { $in: deliveryIds } as any,
        isActive: true,
        status: {
          $in: [StatusDelivery.PENDING, StatusDelivery.ONCOURSE],
        } as any,
      } as any,
      relations: { establishment: true },
    });

    let removed = 0;

    for (const delivery of deliveries) {
      const link = links.find((item) => item.deliveryId === delivery.id);
      const orderId = String(link?.ifoodOrderId || '').trim();
      const merchantId = String(link?.merchantId || '').trim();

      if (!orderId) continue;

      let shouldRemove = false;

      try {
        const order = await this.ifoodOrdersService.getOrderDetails(
          orderId,
          merchantId || undefined,
        );
        const status = String(
          order?.orderStatus || order?.status || order?.metadata?.status || '',
        )
          .trim()
          .toUpperCase();
        shouldRemove = status === 'CONCLUDED' || status === 'CANCELLED';
      } catch (error: any) {
        const status = Number(error?.response?.status || error?.status || 0);
        shouldRemove = status === 404 || status === 410;
      }

      if (!shouldRemove) continue;

      await this.deliveryRepository.save({
        ...delivery,
        status: StatusDelivery.CANCELED,
        isActive: false,
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryDeleted(
        delivery.id,
        delivery.establishment?.cityId,
      );
      removed += 1;
    }

    return {
      checked: deliveries.length,
      removed,
      criteria:
        'Somente pedidos iFood em PENDENTE/ACAMINHO no Rappidex e CONCLUDED/CANCELLED no iFood.',
    };
  }

  async deleteDelivery(deliveryId: string, user: UserRequest) {
    const deliveryFinded = await this.deliveryRepository.findOne({
      where: {
        id: deliveryId,
        isActive: true,
      },
      relations: { establishment: true, motoboy: true },
    });

    if (!deliveryFinded) {
      throw new BadRequestException('Entrega não encontrada.');
    }

    const userFinded = await this.userRepository.findOneBy({
      id: user.id,
    });

    if (
      (userFinded.type === UserType.SHOPKEEPER ||
        userFinded.type === UserType.SHOPKEEPERADMIN) &&
      deliveryFinded.establishment.id != userFinded.id
    ) {
      throw new BadRequestException('Você não é o dono dessa entrega.');
    }

    this.ensureShopkeeperCanCancelDelivery(userFinded, deliveryFinded);

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      deliveryFinded.id,
    );

    if (ifoodLink) {
      const cancellationResult =
        await this.ifoodOrdersService.requestCancellation(
          ifoodLink.ifoodOrderId,
          'Cancelado no Rappidex pela exclusão da entrega.',
          ifoodLink.merchantId,
        );

      this.logger.warn(
        `Solicitação de cancelamento enviada ao iFood por DELETE /delivery/:id. DeliveryId: ${deliveryFinded.id}. OrderId: ${ifoodLink.ifoodOrderId}. Accepted: ${cancellationResult?.accepted === true}. Resultado: ${JSON.stringify(cancellationResult)}`,
      );

      if (cancellationResult?.accepted !== true) {
        throw new BadRequestException(
          `Cancelamento não aceito pelo iFood: ${cancellationResult?.message || 'não foi possível confirmar a solicitação'}. A entrega não foi cancelada localmente para evitar divergência.`,
        );
      }
    }

    try {
      await this.deliveryRepository.save({
        ...deliveryFinded,
        status: StatusDelivery.CANCELED,
        isActive: false,
        updatedAt: addHours(new Date(), -3),
      });

      await this.refundCreditForCanceledDelivery(
        deliveryFinded,
        'Crédito estornado por exclusão da entrega.',
        ifoodLink?.ifoodOrderId,
      );

      this.ordersGateway.emitDeliveryDeleted(
        deliveryFinded.id,
        deliveryFinded.establishment?.cityId,
      );
    } catch (error) {
      return error;
    }

    return { status: 200, message: 'Entrega apagada com sucesso!' };
  }

  async cancelDeliveryFromIfood(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

    if (!ifoodLink) {
      return;
    }

    const deliveryFinded = await this.deliveryRepository.findOne({
      where: {
        id: ifoodLink.deliveryId,
      },
      relations: { establishment: true },
    });

    if (!deliveryFinded || !deliveryFinded.isActive) {
      return;
    }

    const ifoodCancellationCode = event?.fullCode || event?.code || 'CANCELLED';
    const ifoodCancellationNote = `Cancelamento iFood: ${ifoodCancellationCode} | OrderId: ${orderId}`;
    const nextObservation = deliveryFinded.observation
      ? `${deliveryFinded.observation} | ${ifoodCancellationNote}`
      : ifoodCancellationNote;

    await this.deliveryRepository.save({
      ...deliveryFinded,
      status: StatusDelivery.CANCELED,
      isActive: false,
      observation: nextObservation,
      updatedAt: addHours(new Date(), -3),
    });

    await this.refundCreditForCanceledDelivery(
      deliveryFinded,
      'Crédito estornado por cancelamento recebido do iFood.',
      orderId,
    );

    this.ordersGateway.emitDeliveryDeleted(
      deliveryFinded.id,
      deliveryFinded.establishment?.cityId,
    );

    this.logger.warn(
      `Entrega ${deliveryFinded.id} cancelada no Rappidex por evento ${event?.fullCode || event?.code || 'CANCELLED'} do iFood. OrderId: ${orderId}`,
    );
  }

  async handleIfoodCancellationRequestFailed(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);
    if (!ifoodLink) return;

    const delivery = await this.deliveryRepository.findOne({
      where: { id: ifoodLink.deliveryId, isActive: true } as any,
      relations: { establishment: true },
    });
    if (!delivery) return;

    const ifoodFailureCode =
      event?.fullCode || event?.code || 'CANCELLATION_REQUEST_FAILED';
    const failureNote = `Falha de cancelamento iFood: ${ifoodFailureCode} | OrderId: ${orderId}`;
    const nextObservation = delivery.observation
      ? `${delivery.observation} | ${failureNote}`
      : failureNote;

    await this.deliveryRepository.save(
      this.buildPersistableDelivery({
        ...delivery,
        ifoodStatus: ifoodFailureCode,
        externalStatus: ifoodFailureCode,
        logisticsStatus: ifoodFailureCode,
        observation: nextObservation,
        updatedAt: addHours(new Date(), -3),
      }),
    );

    this.logger.error(
      `iFood recusou/falhou o cancelamento. DeliveryId: ${delivery.id}. OrderId: ${orderId}. Event: ${ifoodFailureCode}. A entrega foi mantida para rastreabilidade.`,
    );
  }

  async finishDeliveryFromIfood(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

    if (!ifoodLink) {
      return;
    }

    const deliveryFinded = await this.deliveryRepository.findOne({
      where: {
        id: ifoodLink.deliveryId,
      },
      relations: { establishment: true },
    });

    if (!deliveryFinded || !deliveryFinded.isActive) {
      return;
    }

    if (deliveryFinded.status === StatusDelivery.FINISHED) {
      return;
    }

    const deliveryUpdated = await this.deliveryRepository.save({
      ...deliveryFinded,
      status: StatusDelivery.FINISHED,
      finishedAt: addHours(new Date(), -3),
      updatedAt: addHours(new Date(), -3),
    });

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(deliveryUpdated),
      deliveryUpdated.establishment?.cityId,
    );

    this.logger.log(
      `Entrega ${deliveryFinded.id} finalizada no Rappidex por evento ${event?.fullCode || event?.code || 'CONCLUDED'} do iFood. OrderId: ${orderId}`,
    );
  }

  async findOneUserById(userId: string) {
    const user = await this.userRepository.findOneBy({ id: userId });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return user;
  }

  async findConfigs() {
    return {
      status: 200,
      amount: this.motoboysDeliveriesAmount,
      blockDeliverys: this.blockDeliverys,
    };
  }

  async markArrivedAtStore(deliveryId: string, user: UserRequest) {
    return this.updateDelivery(
      deliveryId,
      { status: StatusDelivery.ARRIVED_AT_STORE },
      user,
    );
  }

  async releaseDelivery(
    deliveryId: string,
    user: UserRequest,
    data?: ReleaseDeliveryDto,
  ) {
    const userFinded = await this.findOneUserById(user.id);
    if (
      ![
        UserType.ADMIN,
        UserType.SUPERADMIN,
        UserType.SHOPKEEPER,
        UserType.SHOPKEEPERADMIN,
      ].includes(userFinded.type as any)
    ) {
      throw new UnauthorizedException(
        'Você não tem permissão para liberar pedido.',
      );
    }
    const delivery = await this.deliveryRepository.findOneByOrFail({
      id: deliveryId,
    });
    if (delivery.status !== StatusDelivery.AWAITING_RELEASE) {
      throw new BadRequestException('Entrega não está aguardando liberação.');
    }

    this.ensureCityAccess(
      userFinded,
      delivery.establishment?.cityId ?? userFinded.cityId,
    );

    const motoboyIdFromBody = this.normalizeMotoboyId(data?.motoboyId);
    const motoboyIdAlreadySaved = this.normalizeMotoboyId(
      delivery?.motoboy?.id,
    );
    const finalMotoboyId = motoboyIdFromBody || motoboyIdAlreadySaved;

    let motoboy = null;
    let nextStatus = StatusDelivery.PENDING;
    let onCoursedAt = delivery.onCoursedAt ?? null;

    if (finalMotoboyId) {
      motoboy = await this.findOneUserById(finalMotoboyId);

      if (motoboy.type !== UserType.MOTOBOY) {
        throw new BadRequestException('Usuário selecionado não é motoboy.');
      }
      this.ensureCityAccess(userFinded, motoboy.cityId);

      nextStatus = StatusDelivery.ONCOURSE;
      onCoursedAt = delivery.onCoursedAt ?? addHours(new Date(), -3);
    }

    const updated = await this.deliveryRepository.save(
      this.buildPersistableDelivery({
        ...delivery,
        status: nextStatus,
        motoboy,
        onCoursedAt,
        releasedAt: addHours(new Date(), -3),
        releasedBy: userFinded.id,
        updatedAt: addHours(new Date(), -3),
      }),
    );

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      delivery.id,
    );
    if (ifoodLink && nextStatus === StatusDelivery.ONCOURSE && motoboy) {
      try {
        const syncFlags = await this.syncIfoodOnCourseIfNeeded(
          delivery,
          updated,
          ifoodLink.ifoodOrderId,
          ifoodLink.merchantId,
        );

        if (Object.keys(syncFlags).length > 0) {
          await this.saveIfoodSyncFlags(updated.id, syncFlags);
          Object.assign(updated, syncFlags);
        }
      } catch (error: any) {
        this.logger.error(
          `Falha ao sincronizar ACAMINHO no iFood durante liberação da entrega ${delivery.id}. orderId=${ifoodLink.ifoodOrderId} merchantId=${ifoodLink.merchantId} status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
          error?.stack || error,
        );
        // não bloquear liberação local por falha externa do iFood
      }
    }

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(updated),
      updated.establishment?.cityId,
    );
    return DeliveryResult.fromEntity(updated);
  }

  async updateExternalIfoodStatus(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);
    if (!ifoodLink) return;

    const delivery = await this.deliveryRepository.findOne({
      where: { id: ifoodLink.deliveryId, isActive: true } as any,
    });
    if (!delivery) return;

    const externalCode = String(
      event?.fullCode || event?.code || event?.metadata?.status || '',
    ).trim();
    if (!externalCode) return;

    const updated = await this.deliveryRepository.save(
      this.buildPersistableDelivery({
        ...delivery,
        ifoodStatus: externalCode,
        externalStatus: externalCode,
        logisticsStatus: externalCode,
        updatedAt: addHours(new Date(), -3),
      }),
    );

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(updated),
      updated.establishment?.cityId,
    );
  }

  async changeConfigs(configs: ConfigsDto) {
    if (configs.amountDeliverys) {
      this.motoboysDeliveriesAmount = parseInt(configs.amountDeliverys);
    }

    if (configs.blockDeliverys) {
      this.blockDeliverys = !this.blockDeliverys;
    }

    return {
      status: 200,
      message: 'Configurações foram alterada com sucesso.',
    };
  }

  private isPendingClaimAttempt(
    delivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ) {
    const requestedMotoboyId = this.normalizeMotoboyId(deliveryData.motoboyId);

    return (
      delivery.status === StatusDelivery.PENDING &&
      !!requestedMotoboyId &&
      (!deliveryData.status || deliveryData.status === StatusDelivery.ONCOURSE)
    );
  }

  private async persistDeliveryUpdate(
    deliveryId: string,
    data: Record<string, any>,
  ) {
    const currentDelivery = await this.deliveryRepository.findOneByOrFail({
      id: deliveryId,
    });

    const sanitizedData = Object.fromEntries(
      Object.entries(data || {}).filter(([, value]) => value !== undefined),
    );

    const persistable = this.buildPersistableDelivery({
      ...currentDelivery,
      ...sanitizedData,
    });

    const { internalId, id, ...setPayload } = persistable;

    void internalId;
    void id;

    const result = await this.deliveryRepository.updateOne(
      { id: deliveryId } as any,
      { $set: setPayload } as any,
    );

    if (!result?.matchedCount) {
      throw new BadRequestException('Entrega não encontrada.');
    }

    return await this.deliveryRepository.findOneByOrFail({
      id: deliveryId,
    });
  }

  private buildPersistableDelivery(data: Record<string, any>) {
    return {
      internalId: data.internalId,
      id: data.id,
      clientName: data.clientName,
      clientPhone: data.clientPhone,
      clientLocation: data.clientLocation ?? null,
      clientAddress: data.clientAddress ?? null,
      addressComplement: data.addressComplement ?? null,
      addressReference: data.addressReference ?? null,
      addressNeighborhood: data.addressNeighborhood ?? null,
      addressCity: data.addressCity ?? null,
      addressState: data.addressState ?? null,
      addressZipCode: data.addressZipCode ?? null,
      addressLatitude: data.addressLatitude ?? null,
      addressLongitude: data.addressLongitude ?? null,
      addressMapsUrl: data.addressMapsUrl ?? null,
      status: data.status,
      establishment: data.establishment ?? null,
      motoboy: data.motoboy ?? null,
      value: data.value,
      observation: data.observation,
      destinationObservation: data.destinationObservation ?? null,
      destinationObservationConfirmed:
        data.destinationObservationConfirmed ?? false,
      soda: data.soda,
      payment: data.payment,
      isActive: data.isActive,
      createdAt: data.createdAt ?? null,
      createdBy: data.createdBy ?? null,
      updatedAt: data.updatedAt ?? null,
      onCoursedAt: data.onCoursedAt ?? null,
      collectedAt: data.collectedAt ?? null,
      arrivedAtStoreAt: data.arrivedAtStoreAt ?? null,
      arrivedAtDestinationAt: data.arrivedAtDestinationAt ?? null,
      ifoodStatus: data.ifoodStatus ?? null,
      externalStatus: data.externalStatus ?? null,
      logisticsStatus: data.logisticsStatus ?? null,
      ifoodImportedAt: data.ifoodImportedAt ?? null,
      ifoodLastEventCode: data.ifoodLastEventCode ?? null,
      ifoodLastEventFullCode: data.ifoodLastEventFullCode ?? null,
      ifoodConfirmedAt: data.ifoodConfirmedAt ?? null,
      releasedAt: data.releasedAt ?? null,
      releasedBy: data.releasedBy ?? null,
      finishedAt: data.finishedAt ?? null,
      ifoodAssignDriverSynced: data.ifoodAssignDriverSynced ?? false,
      ifoodGoingToOriginSynced: data.ifoodGoingToOriginSynced ?? false,
      ifoodArrivedAtOriginSynced: data.ifoodArrivedAtOriginSynced ?? false,
      ifoodDispatchSynced: data.ifoodDispatchSynced ?? false,
      ifoodArrivedAtDestinationSynced:
        data.ifoodArrivedAtDestinationSynced ?? false,
    };
  }

  async updateIfoodOrderLocatorIfBetter(
    deliveryId: string,
    nextLocator?: string | null,
    ifoodDisplayId?: string | null,
  ) {
    const normalizedLocator = String(nextLocator || '').trim();

    if (!normalizedLocator) {
      return;
    }

    const delivery = await this.deliveryRepository.findOne({
      where: { id: deliveryId, isActive: true } as any,
    });

    if (!delivery) {
      return;
    }

    const currentLocator = String((delivery as any).orderLocator || '').trim();
    const displayId = String(
      ifoodDisplayId || (delivery as any).ifoodDisplayId || '',
    ).trim();
    const ifoodOrderId = String((delivery as any).ifoodOrderId || '').trim();

    if (
      currentLocator &&
      currentLocator !== displayId &&
      currentLocator !== ifoodOrderId
    ) {
      return;
    }

    await this.deliveryRepository.updateOne(
      { id: deliveryId } as any,
      {
        $set: {
          orderLocator: normalizedLocator,
          updatedAt: addHours(new Date(), -3),
        },
      } as any,
    );
  }

  private async saveIfoodSyncFlags(
    deliveryId: string,
    flags: Partial<Record<string, boolean>>,
  ) {
    const keysToPersist = Object.keys(flags).filter((key) => flags[key]);

    if (!keysToPersist.length) {
      return;
    }

    const updatePayload = keysToPersist.reduce(
      (acc, key) => {
        acc[key] = true;
        return acc;
      },
      { updatedAt: addHours(new Date(), -3) } as Record<string, any>,
    );

    await this.deliveryRepository.updateOne(
      { id: deliveryId } as any,
      { $set: updatePayload } as any,
    );
  }

  private async rollbackPendingClaimAfterIfoodSyncFailure(
    deliveryId: string,
    motoboyId: string,
  ) {
    const rollbackAt = addHours(new Date(), -3);

    const rollbackResult = await this.deliveryRepository.updateOne(
      {
        id: deliveryId,
        isActive: true,
        status: StatusDelivery.ONCOURSE,
        'motoboy.id': motoboyId,
      } as any,
      {
        $set: {
          status: StatusDelivery.PENDING,
          motoboy: null,
          onCoursedAt: null,
          ifoodAssignDriverSynced: false,
          ifoodGoingToOriginSynced: false,
          updatedAt: rollbackAt,
        },
      } as any,
    );

    if (rollbackResult?.modifiedCount) {
      this.logger.warn(
        `Rollback aplicado para delivery ${deliveryId} após falha de sincronização iFood no fluxo PENDENTE -> ACAMINHO. Entrega retornada para PENDENTE e motoboy removido.`,
      );
      return;
    }

    this.logger.warn(
      `Rollback não aplicado para delivery ${deliveryId} após falha de sincronização iFood, pois a entrega não estava mais em ACAMINHO com o mesmo motoboy.`,
    );
  }

  private async claimPendingDeliveryAtomically(
    deliveryFinded: DeliveryEntity,
    changedDelivery: Record<string, any>,
    motoboyFinded: UserEntity,
  ) {
    const dateForUse = addHours(new Date(), -3);

    const deliveryToPersist = this.buildPersistableDelivery({
      ...changedDelivery,
      status: StatusDelivery.ONCOURSE,
      motoboy: motoboyFinded,
      onCoursedAt: changedDelivery.onCoursedAt ?? dateForUse,
      updatedAt: dateForUse,
    });

    const { internalId, id, ...claimPayload } = deliveryToPersist;

    void internalId;
    void id;

    const claimResult = await this.deliveryRepository.updateOne(
      {
        id: deliveryFinded.id,
        isActive: true,
        status: StatusDelivery.PENDING,
        $or: [{ motoboy: null }, { motoboy: { $exists: false } }],
      } as any,
      {
        $set: claimPayload,
      } as any,
    );

    if (!claimResult?.modifiedCount) {
      const currentDelivery = await this.deliveryRepository.findOne({
        where: {
          id: deliveryFinded.id,
        } as any,
        relations: {
          motoboy: true,
          establishment: true,
        },
      });

      if (
        currentDelivery?.motoboy?.id &&
        currentDelivery.motoboy.id !== motoboyFinded.id
      ) {
        throw new BadRequestException(
          'Essa entrega já foi atribuída a outro entregador.',
        );
      }

      throw new BadRequestException(
        'Essa entrega acabou de ser aceita por outro entregador. Atualize a lista.',
      );
    }

    const deliveryUpdated = await this.deliveryRepository.findOneByOrFail({
      id: deliveryFinded.id,
    });

    return deliveryUpdated;
  }

  private ensureCityAccess(user: UserEntity, resourceCityId: string) {
    if (user.type !== UserType.SUPERADMIN && user.cityId !== resourceCityId) {
      throw new UnauthorizedException(
        'Você não tem permissão para acessar recursos de outra cidade.',
      );
    }
  }

  private async sendNotificationsToRelevantUsers(
    establishmentName: string,
    cityId: string,
  ) {
    console.log('=== INÍCIO NOTIFICAÇÃO DE NOVO PEDIDO (MOTOBOYS/ADMINS) ===');
    console.log('Estabelecimento:', establishmentName);
    console.log('Cidade do pedido:', cityId);

    const where: Record<string, unknown> = {
      type: { $in: [UserType.MOTOBOY, UserType.ADMIN, UserType.SUPERADMIN] },
      isActive: true,
    };

    console.log('Filtro usado para buscar usuários notificados:', where);

    const usersToNotify = await this.userRepository.find({ where });

    console.log('Usuários encontrados para notificação:', usersToNotify.length);

    const usersNotificationsIds = usersToNotify
      .filter((userToNotify: UserEntity) => {
        if (userToNotify.type === UserType.SUPERADMIN) {
          return true;
        }

        return !!cityId && userToNotify.cityId === cityId;
      })
      .map((userToNotify: UserEntity) => {
        console.log('Usuário candidato à notificação:', {
          id: userToNotify.id,
          name: userToNotify.name,
          cityId: userToNotify.cityId,
          type: userToNotify.type,
          isActive: userToNotify.isActive,
          subscriptionId: userToNotify.notification?.subscriptionId ?? null,
        });

        if (
          userToNotify.notification &&
          userToNotify.notification.subscriptionId
        ) {
          return userToNotify.notification.subscriptionId;
        }

        return null;
      })
      .filter((i) => !!i);

    console.log('Subscription IDs encontrados:', usersNotificationsIds);

    await sendNotificationsFor(
      usersNotificationsIds,
      `Nova solicitação de entrega no estabelecimento: ${establishmentName}`,
    );

    console.log('=== FIM NOTIFICAÇÃO DE NOVO PEDIDO (MOTOBOYS/ADMINS) ===');
  }

  private parseReportDateFilter(dateValue: string, endOfDay = false): Date {
    const onlyDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue);

    if (onlyDate) {
      const [year, month, day] = dateValue.split('-').map(Number);

      return new Date(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
      );
    }

    const parsedDate = new Date(dateValue);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Data inválida no filtro de relatório.');
    }

    return parsedDate;
  }

  private shouldUseFinishedDateFilter(
    queryParams: ListDeliveriesQueryDTO,
  ): boolean {
    const selectedStatuses = queryParams.status
      ? queryParams.status.split(',')
      : [];

    return (
      selectedStatuses.length > 0 &&
      selectedStatuses.every((status) => status === StatusDelivery.FINISHED)
    );
  }

  private buildReportDateRange(queryParams: ListDeliveriesQueryDTO) {
    if (!queryParams.createdIn && !queryParams.createdUntil) {
      return null;
    }

    const start = queryParams.createdIn
      ? this.parseReportDateFilter(queryParams.createdIn)
      : undefined;
    const end = this.parseReportDateFilter(
      queryParams.createdUntil || queryParams.createdIn,
      true,
    );

    return { start, end };
  }

  private buildDateRangeFilter(start?: Date, end?: Date) {
    const range: Record<string, Date> = {};

    if (start) range.$gte = start;
    if (end) range.$lte = end;

    return range;
  }

  private applyReportDateWhere(
    where: Record<string, any>,
    queryParams: ListDeliveriesQueryDTO,
  ) {
    const dateRange = this.buildReportDateRange(queryParams);

    if (!dateRange) {
      return;
    }

    const rangeFilter = this.buildDateRangeFilter(
      dateRange.start,
      dateRange.end,
    );

    if (!this.shouldUseFinishedDateFilter(queryParams)) {
      where.createdAt = rangeFilter;
      return;
    }

    where.$or = [
      { finishedAt: rangeFilter },
      {
        $and: [
          { $or: [{ finishedAt: null }, { finishedAt: { $exists: false } }] },
          { updatedAt: rangeFilter },
        ],
      },
      {
        $and: [
          { $or: [{ finishedAt: null }, { finishedAt: { $exists: false } }] },
          { $or: [{ updatedAt: null }, { updatedAt: { $exists: false } }] },
          { createdAt: rangeFilter },
        ],
      },
    ];
  }

  private normalizeReportDateToYmd(
    value?: Date | string | null,
  ): string | null {
    if (!value) return null;

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    const textValue = String(value).trim();

    const isoDateMatch = textValue.match(/^\d{4}-\d{2}-\d{2}/);
    if (isoDateMatch) {
      return isoDateMatch[0];
    }

    const parsedDate = new Date(textValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate.toISOString().slice(0, 10);
  }

  private isDeliveryInsideReportDateFilter(
    delivery: DeliveryEntity,
    queryParams: ListDeliveriesQueryDTO,
  ): boolean {
    const selectedStatuses = queryParams.status
      ? queryParams.status.split(',')
      : [];

    const shouldUseFinishedAt =
      selectedStatuses.length > 0 &&
      selectedStatuses.every((status) => status === StatusDelivery.FINISHED);

    const dateValue = shouldUseFinishedAt
      ? delivery.finishedAt || delivery.updatedAt || delivery.createdAt
      : delivery.createdAt;

    const deliveryDate = this.normalizeReportDateToYmd(dateValue);

    if (!deliveryDate) return false;

    const startDate = this.normalizeReportDateToYmd(
      queryParams.createdIn || null,
    );
    const endDate = this.normalizeReportDateToYmd(
      queryParams.createdUntil || queryParams.createdIn || null,
    );

    if (startDate && deliveryDate < startDate) {
      return false;
    }

    if (endDate && deliveryDate > endDate) {
      return false;
    }

    return true;
  }

  private buildDeliveriesWhere(
    userForRequest: UserEntity,
    queryParams: ListDeliveriesQueryDTO,
  ) {
    const selectedStatuses = queryParams.status
      ? queryParams.status.split(',')
      : [];
    const includeCanceled = selectedStatuses.includes(StatusDelivery.CANCELED);
    const where: Record<string, any> = {
      isActive: includeCanceled ? { $in: [true, false] } : true,
    };

    this.applyCityWhere(userForRequest, where, queryParams.cityId);

    if (
      userForRequest.type === UserType.ADMIN ||
      userForRequest.type === UserType.SUPERADMIN
    ) {
      if (selectedStatuses.length) where['status'] = { $in: selectedStatuses };
      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
      if (queryParams.createdBy) where['createdBy'] = queryParams.createdBy;
    }

    if (userForRequest.type === UserType.MOTOBOY) {
      if (selectedStatuses.length) {
        where['status'] = {
          $in: selectedStatuses.filter(
            (status) => status !== StatusDelivery.AWAITING_RELEASE,
          ),
        };

        // Se tiver um momento em que for necessario que o motoboy solicite todos os pedidos, ele vai conseguir ver tudo
        if (!selectedStatuses.includes(StatusDelivery.PENDING)) {
          where['motoboy.id'] = userForRequest.id;
        }
      } else {
        where['motoboy.id'] = userForRequest.id;
        where['status'] = { $ne: StatusDelivery.AWAITING_RELEASE };
      }

      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
    }

    //Lojistaadmin pode ver o mesmo que o lojista normal, unica diferença é que eles podem atribuir uma entrega ao motoboy
    if (
      userForRequest.type === UserType.SHOPKEEPER ||
      userForRequest.type === UserType.SHOPKEEPERADMIN
    ) {
      where['establishment.id'] = userForRequest.id;
      if (selectedStatuses.length) where['status'] = { $in: selectedStatuses };
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
    }

    // if (queryParams.hasOwnProperty('isActive')) {
    //   where['isActive'] = queryParams.isActive ? true : false;
    // }

    this.applyReportDateWhere(where, queryParams);

    return where;
  }
}

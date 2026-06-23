import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeliveryService } from './delivery.service';
import {
  CityEntity,
  DeliveryEntity,
  LogEntity,
  UserEntity,
} from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodCreditsService } from '../ifood/ifood-credits.service';
import { IfoodEventService } from '../ifood/ifood-event.service';
import {
  Permissions,
  StatusDelivery,
  UserType,
} from '../shared/constants/enums.constants';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let ifoodOrdersService: any;
  let ifoodOrderLinkService: any;
  let ifoodEventService: any;
  let userRepository: any;
  let deliveryRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOneBy: jest.fn(),
            findOneOrFail: jest.fn(),
            findOneByOrFail: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(DeliveryEntity),
          useValue: {
            findOneBy: jest.fn(),
            findOneOrFail: jest.fn(),
            findOneByOrFail: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            deleteOne: jest.fn(),
            updateOne: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(LogEntity),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CityEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: OrdersGateway,
          useValue: {
            emit: jest.fn(),
            emitDeliveryUpdated: jest.fn(),
            emitDeliveryDeleted: jest.fn(),
          },
        },
        {
          provide: IfoodOrdersService,
          useValue: {
            assignDriver: jest.fn(),
            notifyGoingToOrigin: jest.fn(),
            notifyArrivedAtOrigin: jest.fn(),
            dispatchLogisticsOrder: jest.fn(),
            dispatchOrder: jest.fn(),
            notifyArrivedAtDestination: jest.fn(),
            verifyDeliveryCode: jest.fn().mockResolvedValue({ success: true }),
            requestCancellation: jest.fn(),
            getOrderDetails: jest
              .fn()
              .mockResolvedValue({ orderStatus: 'CON' }),
          },
        },
        {
          provide: IfoodOrderLinkService,
          useValue: {
            findByDeliveryId: jest.fn(),
            findByDeliveryIds: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: IfoodCreditsService,
          useValue: {
            consumeCredit: jest.fn(),
            rollbackCreditUsage: jest.fn(),
          },
        },
        {
          provide: IfoodEventService,
          useValue: {
            hasDeliveryDropCodeRequested: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
    ifoodOrdersService = module.get(IfoodOrdersService);
    ifoodOrderLinkService = module.get(IfoodOrderLinkService);
    ifoodEventService = module.get(IfoodEventService);
    userRepository = module.get(getRepositoryToken(UserEntity));
    deliveryRepository = module.get(getRepositoryToken(DeliveryEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('deve executar sequência logística no status ONCOURSE', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-1',
      merchantId: 'merchant-1',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-1',
        status: StatusDelivery.PENDING,
        ifoodAssignDriverSynced: false,
        ifoodGoingToOriginSynced: false,
      },
      { motoboy: { id: 'm1', name: 'João', phone: '11999999999' } },
      { status: StatusDelivery.ONCOURSE },
    );

    expect(ifoodOrdersService.assignDriver).toHaveBeenCalledWith(
      'ifood-1',
      expect.objectContaining({ id: 'm1' }),
      'merchant-1',
    );
    expect(ifoodOrdersService.notifyGoingToOrigin).toHaveBeenCalledWith(
      'ifood-1',
      'merchant-1',
    );
  });

  it('não deve sincronizar ACAMINHO sem motoboy em pedido iFood', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-10',
      merchantId: 'merchant-10',
    });

    const result = await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-10',
        status: StatusDelivery.PENDING,
        ifoodAssignDriverSynced: false,
        ifoodGoingToOriginSynced: false,
      },
      {},
      { status: StatusDelivery.ONCOURSE },
    );

    expect(result).toEqual({});
    expect(ifoodOrdersService.assignDriver).not.toHaveBeenCalled();
    expect(ifoodOrdersService.notifyGoingToOrigin).not.toHaveBeenCalled();
  });

  it('deve executar apenas dispatch no status COLLECTED sem chamar arrivedAtOrigin', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-2',
      merchantId: 'merchant-2',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-2',
        status: StatusDelivery.ONCOURSE,
        ifoodArrivedAtOriginSynced: false,
        ifoodDispatchSynced: false,
      },
      {},
      { status: StatusDelivery.COLLECTED },
    );

    expect(ifoodOrdersService.notifyArrivedAtOrigin).not.toHaveBeenCalled();
    expect(ifoodOrdersService.dispatchLogisticsOrder).toHaveBeenCalledWith(
      'ifood-2',
      'merchant-2',
    );
    expect(ifoodOrdersService.dispatchOrder).not.toHaveBeenCalled();
  });

  it('deve enviar arrivedAtOrigin no status ARRIVED_AT_STORE', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-8',
      merchantId: 'merchant-8',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-8',
        status: StatusDelivery.ONCOURSE,
        ifoodArrivedAtOriginSynced: false,
      },
      {},
      { status: StatusDelivery.ARRIVED_AT_STORE },
    );

    expect(ifoodOrdersService.notifyArrivedAtOrigin).toHaveBeenCalledWith(
      'ifood-8',
      'merchant-8',
    );
    expect(ifoodOrdersService.dispatchLogisticsOrder).not.toHaveBeenCalled();
  });

  it('deve enviar arrivedAtDestination no status ARRIVED_AT_DESTINATION', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-9',
      merchantId: 'merchant-9',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-9',
        status: StatusDelivery.COLLECTED,
        ifoodArrivedAtDestinationSynced: false,
      },
      {},
      { status: StatusDelivery.ARRIVED_AT_DESTINATION },
    );

    expect(ifoodOrdersService.notifyArrivedAtDestination).toHaveBeenCalledWith(
      'ifood-9',
      'merchant-9',
    );
  });

  it('deve validar código de entrega quando houver DELIVERY_DROP_CODE_REQUESTED', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-3',
      merchantId: 'merchant-3',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(true);

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-3',
        status: StatusDelivery.AWAITING_CODE,
        ifoodArrivedAtDestinationSynced: true,
      },
      {},
      { status: StatusDelivery.FINISHED, deliveryCode: '1234' },
    );

    expect(
      ifoodOrdersService.notifyArrivedAtDestination,
    ).not.toHaveBeenCalled();
    expect(ifoodOrdersService.verifyDeliveryCode).toHaveBeenCalledWith(
      'ifood-3',
      '1234',
      'merchant-3',
    );
  });

  it('deve rejeitar finalização quando não houver evento DELIVERY_DROP_CODE_REQUESTED', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-4',
      merchantId: 'merchant-4',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(false);

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-4',
          status: StatusDelivery.AWAITING_CODE,
          ifoodArrivedAtDestinationSynced: true,
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '9999' },
      ),
    ).rejects.toThrow('DELIVERY_DROP_CODE_REQUESTED');
  });

  it('deve finalizar localmente quando iFood já estiver concluído', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-5',
      merchantId: 'merchant-5',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(true);
    ifoodOrdersService.verifyDeliveryCode.mockRejectedValue(
      new Error('already delivered'),
    );
    ifoodOrdersService.getOrderDetails.mockResolvedValue({
      orderStatus: 'CONCLUDED',
    });

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-5',
          status: StatusDelivery.AWAITING_CODE,
          ifoodArrivedAtDestinationSynced: true,
          establishment: { usesExternalIfoodPdv: true, name: 'Loja Teste' },
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '6013' },
      ),
    ).resolves.toEqual({});
  });

  it('deve finalizar localmente sem DELIVERY_DROP_CODE_REQUESTED quando iFood já estiver concluído', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-7',
      merchantId: 'merchant-7',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(false);
    ifoodOrdersService.getOrderDetails.mockResolvedValue({
      orderStatus: 'CONCLUDED',
    });

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-7',
          status: StatusDelivery.AWAITING_CODE,
          ifoodArrivedAtDestinationSynced: true,
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '6013' },
      ),
    ).resolves.toEqual({});

    expect(ifoodOrdersService.verifyDeliveryCode).not.toHaveBeenCalledWith(
      'ifood-7',
      '6013',
      'merchant-7',
    );
  });

  it('deve ser idempotente ao receber finalização de delivery já finalizado', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-6',
      merchantId: 'merchant-6',
    });

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-6',
          status: StatusDelivery.FINISHED,
          ifoodArrivedAtDestinationSynced: true,
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '6013' },
      ),
    ).resolves.toEqual({});

    expect(ifoodOrdersService.verifyDeliveryCode).not.toHaveBeenCalledWith(
      'ifood-6',
      '6013',
      'merchant-6',
    );
  });

  it('não aplica filtro de data diretamente no where do MongoDB', () => {
    const where = (service as any).buildDeliveriesWhere(
      { type: 'superadmin' },
      {
        status: StatusDelivery.FINISHED,
        createdIn: '2026-06-23',
        createdUntil: '2026-06-23',
      },
    );

    expect(where.$or).toBeUndefined();
    expect(where.finishedAt).toBeUndefined();
    expect(where.createdAt).toBeUndefined();
    expect(where.status).toEqual({ $in: [StatusDelivery.FINISHED] });
  });

  it('filtra entregas finalizadas em memória pelo dia de finishedAt', () => {
    const queryParams = {
      status: StatusDelivery.FINISHED,
      createdIn: '2026-06-23',
      createdUntil: '2026-06-23',
    };

    expect(
      (service as any).isDeliveryInsideReportDateFilter(
        {
          status: StatusDelivery.FINISHED,
          createdAt: new Date('2026-06-22T23:30:00.000Z'),
          finishedAt: new Date('2026-06-23T00:39:00.000Z'),
        },
        queryParams,
      ),
    ).toBe(true);

    expect(
      (service as any).isDeliveryInsideReportDateFilter(
        {
          status: StatusDelivery.FINISHED,
          createdAt: new Date('2026-06-23T10:00:00.000Z'),
          finishedAt: new Date('2026-06-24T00:39:00.000Z'),
        },
        queryParams,
      ),
    ).toBe(false);
  });

  it('permite lojista atualizar status quando o pedido ainda não tem motoboy atribuído', () => {
    expect(() =>
      (service as any).validateStoreCanUpdateDeliveryStatus(
        { type: UserType.SHOPKEEPER },
        { status: StatusDelivery.PENDING, motoboy: null },
      ),
    ).not.toThrow();
  });

  it('bloqueia lojista ao atualizar status de pedido já atribuído a motoboy', () => {
    expect(() =>
      (service as any).validateStoreCanUpdateDeliveryStatus(
        { type: UserType.SHOPKEEPER },
        { status: StatusDelivery.ONCOURSE, motoboy: { id: 'motoboy-1' } },
      ),
    ).toThrow(
      'Este pedido já foi atribuído a um motoboy. Apenas administradores podem alterar o status.',
    );
  });

  it('bloqueia lojista ao cancelar pedido já atribuído a motoboy', () => {
    expect(() =>
      (service as any).ensureShopkeeperCanCancelDelivery(
        { type: UserType.SHOPKEEPERADMIN },
        { status: StatusDelivery.PENDING, motoboyId: 'motoboy-1' },
      ),
    ).toThrow(
      'Este pedido já foi atribuído a um motoboy. Apenas administradores podem alterar o status.',
    );
  });

  it('permite admin, super admin e master alterar status de pedido atribuído', () => {
    const delivery = {
      status: StatusDelivery.COLLECTED,
      motoboy: { id: 'motoboy-1' },
    };

    expect(() =>
      (service as any).validateStoreCanUpdateDeliveryStatus(
        { type: UserType.ADMIN },
        delivery,
      ),
    ).not.toThrow();
    expect(() =>
      (service as any).validateStoreCanUpdateDeliveryStatus(
        { type: UserType.SUPERADMIN },
        delivery,
      ),
    ).not.toThrow();
    expect(() =>
      (service as any).validateStoreCanUpdateDeliveryStatus(
        { type: UserType.SHOPKEEPER, permission: Permissions.MASTER },
        delivery,
      ),
    ).not.toThrow();
  });

  it('permite motoboy atualizar status no fluxo normal dele', async () => {
    const motoboy = {
      id: 'motoboy-1',
      type: UserType.MOTOBOY,
      cityId: 'city-1',
    };
    const delivery = {
      id: 'delivery-1',
      status: StatusDelivery.ONCOURSE,
      motoboy,
      establishment: { id: 'shop-1', cityId: 'city-1' },
      isActive: true,
    };

    userRepository.findOneBy.mockResolvedValue(motoboy);
    deliveryRepository.findOneOrFail.mockResolvedValue(delivery);
    deliveryRepository.save.mockImplementation(async (data) => data);
    deliveryRepository.updateOne.mockResolvedValue({ matchedCount: 1 });
    deliveryRepository.findOneByOrFail
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce({ ...delivery, status: StatusDelivery.COLLECTED });
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue(null);

    await expect(
      service.updateDelivery(
        'delivery-1',
        { status: StatusDelivery.COLLECTED } as any,
        { id: 'motoboy-1', type: UserType.MOTOBOY } as any,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ status: StatusDelivery.COLLECTED }),
    );
  });
});

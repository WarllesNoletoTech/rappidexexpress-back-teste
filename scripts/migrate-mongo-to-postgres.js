/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId, Decimal128 } = require('mongodb');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = Math.max(25, Number(process.env.MIGRATION_BATCH_SIZE || 200));

const collectionCandidates = {
  cities: ['city_entity', 'city'],
  users: ['user_entity', 'user'],
  deliveries: ['delivery_entity', 'delivery'],
  logs: ['log_entity', 'log'],
  ifoodEvents: ['ifood_event_entity', 'ifood_event'],
  ifoodLinks: ['ifood_order_link_entity', 'ifood_order_link'],
  ifoodCredits: ['ifood_credit_history_entity', 'ifood_credit_history'],
  settlements: [
    'financial_settlement_history_entity',
    'financial_settlement_history',
  ],
};

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function mongoId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value.toHexString();
  return String(value);
}

function toDate(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function toNumber(value, fallback = 0) {
  if (value instanceof Decimal128) value = value.toString();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function cleanJson(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Decimal128) return value.toString();
  if (Array.isArray(value)) return value.map(cleanJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '_id' && key !== 'internalId')
        .map(([key, item]) => [key, cleanJson(item)]),
    );
  }
  return value;
}

function compactEstablishment(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    name: user.name || '',
    phone: user.phone || '',
    profileImage: user.profileImage ?? null,
    location: user.location ?? null,
    pix: user.pix ?? null,
    cityId: user.cityId ? String(user.cityId) : null,
    cityName: user.cityName ?? null,
    notification: user.notification?.subscriptionId
      ? { subscriptionId: user.notification.subscriptionId }
      : null,
    usesExternalIfoodPdv: Boolean(user.usesExternalIfoodPdv),
    ifoodMerchants: Array.isArray(user.ifoodMerchants)
      ? user.ifoodMerchants
          .map((merchant) => ({
            merchantId: String(merchant?.merchantId || '').trim(),
            name: String(merchant?.name || '').trim(),
            enabled: merchant?.enabled !== false,
            pickupAddress:
              String(merchant?.pickupAddress || '').trim() || undefined,
          }))
          .filter((merchant) => merchant.merchantId)
      : [],
  };
}

function compactMotoboy(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    name: user.name || '',
    phone: user.phone || '',
    cityId: user.cityId ? String(user.cityId) : null,
    type: user.type || 'motoboy',
    profileImage: user.profileImage ?? null,
    notification: user.notification?.subscriptionId
      ? { subscriptionId: user.notification.subscriptionId }
      : null,
  };
}

function compactLogUser(user) {
  if (!user) return {};
  return {
    id: user.id ?? null,
    name: user.name ?? '',
    user: user.user ?? '',
    phone: user.phone ?? '',
    type: user.type ?? null,
    permission: user.permission ?? null,
    cityId: user.cityId ? String(user.cityId) : null,
    isActive: user.isActive !== false,
  };
}

async function resolveCollections(db) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (item) => item.name,
    ),
  );
  const resolved = {};
  for (const [key, candidates] of Object.entries(collectionCandidates)) {
    resolved[key] = candidates.find((name) => existing.has(name)) || null;
  }
  return resolved;
}

async function countDuplicateGroups(collection, groupId, match = {}) {
  if (!collection) return 0;
  const pipeline = [
    { $match: match },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'groups' },
  ];
  const [result] = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
  return Number(result?.groups || 0);
}

async function runPreflight(db, collections) {
  const users = collections.users ? db.collection(collections.users) : null;
  const deliveries = collections.deliveries
    ? db.collection(collections.deliveries)
    : null;
  const ifoodLinks = collections.ifoodLinks
    ? db.collection(collections.ifoodLinks)
    : null;

  const report = {
    usersMissingId: users
      ? await users.countDocuments({ $or: [{ id: { $exists: false } }, { id: null }, { id: '' }] })
      : 0,
    usersMissingLogin: users
      ? await users.countDocuments({ $or: [{ user: { $exists: false } }, { user: null }, { user: '' }] })
      : 0,
    usersMissingPassword: users
      ? await users.countDocuments({ $or: [{ password: { $exists: false } }, { password: null }, { password: '' }] })
      : 0,
    duplicateUsernames: users
      ? await countDuplicateGroups(users, '$user', { user: { $nin: [null, ''] } })
      : 0,
    deliveriesMissingRequiredIdentity: deliveries
      ? await deliveries.countDocuments({
          $or: [
            { id: { $exists: false } },
            { id: null },
            { id: '' },
            { 'establishment.id': { $exists: false } },
            { 'establishment.id': null },
            { 'establishment.id': '' },
          ],
        })
      : 0,
    duplicateDeliveryIds: deliveries
      ? await countDuplicateGroups(deliveries, '$id', { id: { $nin: [null, ''] } })
      : 0,
    duplicateDeliveryIfoodPairs: deliveries
      ? await countDuplicateGroups(
          deliveries,
          { orderId: '$ifoodOrderId', merchantId: '$ifoodMerchantId' },
          {
            ifoodOrderId: { $nin: [null, ''] },
            ifoodMerchantId: { $nin: [null, ''] },
          },
        )
      : 0,
    duplicateIfoodLinkPairs: ifoodLinks
      ? await countDuplicateGroups(
          ifoodLinks,
          { orderId: '$ifoodOrderId', merchantId: '$merchantId' },
          {
            ifoodOrderId: { $nin: [null, ''] },
            merchantId: { $nin: [null, ''] },
          },
        )
      : 0,
  };

  const blockingKeys = [
    'usersMissingId',
    'usersMissingLogin',
    'usersMissingPassword',
    'deliveriesMissingRequiredIdentity',
    'duplicateUsernames',
    'duplicateDeliveryIds',
    'duplicateDeliveryIfoodPairs',
    'duplicateIfoodLinkPairs',
  ];
  const blockers = blockingKeys.filter((key) => Number(report[key] || 0) > 0);

  console.log('\nPré-validação da migração:');
  console.table(report);

  if (blockers.length) {
    throw new Error(
      `Migração bloqueada por duplicidades incompatíveis com os índices PostgreSQL: ${blockers.join(', ')}. Corrija antes de usar --apply.`,
    );
  }

  return report;
}

function quote(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function bulkUpsert(pg, table, columns, rows, conflictColumns) {
  if (!rows.length) return;

  const updateColumns = columns.filter(
    (column) => !conflictColumns.includes(column) && column !== 'legacyMongoId',
  );

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const params = [];
    const valuesSql = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        const raw = row[column] === undefined ? null : row[column];
        const value =
          raw && typeof raw === 'object' && !(raw instanceof Date)
            ? JSON.stringify(raw)
            : raw;
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const conflictSql = conflictColumns.length
      ? `ON CONFLICT (${conflictColumns.map(quote).join(', ')}) DO UPDATE SET ${updateColumns
          .map((column) => `${quote(column)} = EXCLUDED.${quote(column)}`)
          .join(', ')}`
      : '';

    const sql = `INSERT INTO ${quote(table)} (${columns
      .map(quote)
      .join(', ')}) VALUES ${valuesSql.join(', ')} ${conflictSql}`;
    await pg.query(sql, params);
  }
}

async function migrateCollection({ db, pg, collectionName, mapper, table, columns, conflict }) {
  if (!collectionName) {
    console.log(`- ${table}: coleção Mongo não encontrada; ignorada.`);
    return { source: 0, migrated: 0 };
  }

  const collection = db.collection(collectionName);
  const source = await collection.countDocuments({});
  let migrated = 0;
  let buffer = [];

  const cursor = collection.find({}).batchSize(BATCH_SIZE);
  for await (const doc of cursor) {
    const row = mapper(doc);
    if (!row) continue;
    buffer.push(row);
    if (buffer.length >= BATCH_SIZE) {
      await bulkUpsert(pg, table, columns, buffer, conflict);
      migrated += buffer.length;
      buffer = [];
      process.stdout.write(`\r  ${table}: ${migrated}/${source}`);
    }
  }

  if (buffer.length) {
    await bulkUpsert(pg, table, columns, buffer, conflict);
    migrated += buffer.length;
  }
  if (source) process.stdout.write('\n');
  return { source, migrated };
}

async function main() {
  const mongoUri = requiredEnv('MONGODB_URI');
  const databaseUrl = requiredEnv('DATABASE_URL');
  const mongoClient = new MongoClient(mongoUri);
  const pg = new Client({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  await mongoClient.connect();
  const db = process.env.MONGODB_DB_NAME
    ? mongoClient.db(process.env.MONGODB_DB_NAME)
    : mongoClient.db();
  await pg.connect();

  try {
    const collections = await resolveCollections(db);
    console.log(`MongoDB origem: ${db.databaseName}`);
    console.log('Coleções detectadas:', collections);

    const counts = {};
    for (const [key, name] of Object.entries(collections)) {
      counts[key] = name ? await db.collection(name).countDocuments({}) : 0;
    }

    console.log('\nResumo de origem:');
    console.table(counts);

    await runPreflight(db, collections);

    if (!APPLY) {
      console.log('\nDRY-RUN concluído. Nenhum dado foi alterado.');
      console.log('Para migrar de verdade: npm run migrate:mongo-to-postgres:apply');
      return;
    }

    const schema = fs.readFileSync(path.join(__dirname, 'postgres-schema.sql'), 'utf8');
    await pg.query(schema);
    console.log('\nSchema Supabase/PostgreSQL garantido. Iniciando cópia...');

    const results = {};

    results.cities = await migrateCollection({
      db,
      pg,
      collectionName: collections.cities,
      table: 'city_entity',
      columns: [
        'id','name','state','clientWhatsappMessage','deliveryValue','deliveryFeeValue',
        'monthlyFeeValue','pixKey','adminWhatsapp','whatsappPhoneNumberId','whatsappCloudToken',
      ],
      conflict: ['id'],
      mapper: (d) => ({
        id: mongoId(d._id || d.id),
        name: String(d.name || 'Cidade'),
        state: String(d.state || 'PA'),
        clientWhatsappMessage: d.clientWhatsappMessage ?? '',
        deliveryValue: d.deliveryValue ?? '',
        deliveryFeeValue: d.deliveryFeeValue == null ? null : toNumber(d.deliveryFeeValue),
        monthlyFeeValue: d.monthlyFeeValue == null ? null : toNumber(d.monthlyFeeValue),
        pixKey: d.pixKey ?? '',
        adminWhatsapp: d.adminWhatsapp ?? '',
        whatsappPhoneNumberId: d.whatsappPhoneNumberId ?? '',
        whatsappCloudToken: d.whatsappCloudToken ?? '',
      }),
    });

    results.users = await migrateCollection({
      db,
      pg,
      collectionName: collections.users,
      table: 'user_entity',
      columns: [
        'id','name','phone','user','password','profileImage','location','type','permission','pix','cityId',
        'isActive','blocked','blockedReason','blockedAt','blockedBySystem','unblockedAt','unblockedBy',
        'notification','token','useIfoodIntegration','usesExternalIfoodPdv','ifoodWithoutPreparationTime',
        'ifoodMerchantId','ifoodMerchants','ifoodClientId','ifoodClientSecret','ifoodOrdersReleased',
        'ifoodOrdersUsed','ifoodOrdersAvailable','createdAt','createdBy','updatedAt',
      ],
      conflict: ['id'],
      mapper: (d) => d.id ? ({
        id: String(d.id),
        name: String(d.name || ''),
        phone: String(d.phone || ''),
        user: String(d.user || ''),
        password: String(d.password || ''),
        profileImage: d.profileImage ?? null,
        location: d.location ?? null,
        type: String(d.type || 'shopkeeper'),
        permission: String(d.permission || 'none'),
        pix: d.pix ?? null,
        cityId: d.cityId ? String(d.cityId) : null,
        isActive: toBool(d.isActive, true),
        blocked: toBool(d.blocked, false),
        blockedReason: d.blockedReason ?? null,
        blockedAt: toDate(d.blockedAt),
        blockedBySystem: toBool(d.blockedBySystem, false),
        unblockedAt: toDate(d.unblockedAt),
        unblockedBy: d.unblockedBy ?? null,
        notification: cleanJson(d.notification),
        token: d.token ?? null,
        useIfoodIntegration: toBool(d.useIfoodIntegration, false),
        usesExternalIfoodPdv: toBool(d.usesExternalIfoodPdv, false),
        ifoodWithoutPreparationTime: toBool(d.ifoodWithoutPreparationTime, false),
        ifoodMerchantId: d.ifoodMerchantId ?? null,
        ifoodMerchants: cleanJson(Array.isArray(d.ifoodMerchants) ? d.ifoodMerchants : []),
        ifoodClientId: d.ifoodClientId ?? null,
        ifoodClientSecret: d.ifoodClientSecret ?? null,
        ifoodOrdersReleased: toNumber(d.ifoodOrdersReleased, 0),
        ifoodOrdersUsed: toNumber(d.ifoodOrdersUsed, 0),
        ifoodOrdersAvailable: toNumber(d.ifoodOrdersAvailable, 0),
        createdAt: toDate(d.createdAt, new Date()),
        createdBy: d.createdBy ?? null,
        updatedAt: toDate(d.updatedAt, toDate(d.createdAt, new Date())),
      }) : null,
    });

    results.deliveries = await migrateCollection({
      db,
      pg,
      collectionName: collections.deliveries,
      table: 'delivery_entity',
      columns: [
        'id','clientName','clientPhone','clientLocation','clientAddress','addressComplement','addressReference',
        'addressNeighborhood','addressCity','addressState','addressZipCode','addressLatitude','addressLongitude',
        'addressMapsUrl','status','establishment','motoboy','establishmentId','establishmentCityId','motoboyId',
        'value','observation','destinationObservation','destinationObservationConfirmed','soda','payment','isActive',
        'createdAt','createdBy','updatedAt','onCoursedAt','collectedAt','arrivedAtStoreAt','ifoodStatus','externalStatus',
        'logisticsStatus','ifoodOrderId','ifoodDisplayId','orderLocator','ifoodMerchantId','ifoodMerchantName','ifoodImportedAt',
        'ifoodLastEventCode','ifoodLastEventFullCode','ifoodConfirmedAt','releasedAt','releasedBy','arrivedAtDestinationAt',
        'finishedAt','ifoodAssignDriverSynced','ifoodGoingToOriginSynced','ifoodArrivedAtOriginSynced','ifoodDispatchSynced',
        'ifoodArrivedAtDestinationSynced',
      ],
      conflict: ['id'],
      mapper: (d) => {
        if (!d.id || !d.establishment?.id) return null;
        const establishment = compactEstablishment(d.establishment);
        const motoboy = compactMotoboy(d.motoboy);
        return {
          id: String(d.id),
          clientName: String(d.clientName || ''),
          clientPhone: String(d.clientPhone || ''),
          clientLocation: d.clientLocation ?? null,
          clientAddress: d.clientAddress ?? null,
          addressComplement: d.addressComplement ?? null,
          addressReference: d.addressReference ?? null,
          addressNeighborhood: d.addressNeighborhood ?? null,
          addressCity: d.addressCity ?? null,
          addressState: d.addressState ?? null,
          addressZipCode: d.addressZipCode ?? null,
          addressLatitude: d.addressLatitude == null ? null : toNumber(d.addressLatitude),
          addressLongitude: d.addressLongitude == null ? null : toNumber(d.addressLongitude),
          addressMapsUrl: d.addressMapsUrl ?? null,
          status: String(d.status || 'PENDENTE'),
          establishment,
          motoboy,
          establishmentId: String(d.establishment.id),
          establishmentCityId: d.establishment.cityId ? String(d.establishment.cityId) : null,
          motoboyId: d.motoboy?.id ? String(d.motoboy.id) : null,
          value: String(d.value ?? '0'),
          observation: d.observation ?? '',
          destinationObservation: d.destinationObservation ?? null,
          destinationObservationConfirmed: toBool(d.destinationObservationConfirmed, false),
          soda: d.soda ?? '',
          payment: String(d.payment || 'PAGO'),
          isActive: toBool(d.isActive, true),
          createdAt: toDate(d.createdAt, new Date()),
          createdBy: d.createdBy ?? null,
          updatedAt: toDate(d.updatedAt, toDate(d.createdAt, new Date())),
          onCoursedAt: toDate(d.onCoursedAt),
          collectedAt: toDate(d.collectedAt),
          arrivedAtStoreAt: toDate(d.arrivedAtStoreAt),
          ifoodStatus: d.ifoodStatus ?? null,
          externalStatus: d.externalStatus ?? null,
          logisticsStatus: d.logisticsStatus ?? null,
          ifoodOrderId: d.ifoodOrderId ?? null,
          ifoodDisplayId: d.ifoodDisplayId ?? null,
          orderLocator: d.orderLocator ?? null,
          ifoodMerchantId: d.ifoodMerchantId ?? null,
          ifoodMerchantName: d.ifoodMerchantName ?? null,
          ifoodImportedAt: toDate(d.ifoodImportedAt),
          ifoodLastEventCode: d.ifoodLastEventCode ?? null,
          ifoodLastEventFullCode: d.ifoodLastEventFullCode ?? null,
          ifoodConfirmedAt: toDate(d.ifoodConfirmedAt),
          releasedAt: toDate(d.releasedAt),
          releasedBy: d.releasedBy ?? null,
          arrivedAtDestinationAt: toDate(d.arrivedAtDestinationAt),
          finishedAt: toDate(d.finishedAt),
          ifoodAssignDriverSynced: toBool(d.ifoodAssignDriverSynced, false),
          ifoodGoingToOriginSynced: toBool(d.ifoodGoingToOriginSynced, false),
          ifoodArrivedAtOriginSynced: toBool(d.ifoodArrivedAtOriginSynced, false),
          ifoodDispatchSynced: toBool(d.ifoodDispatchSynced, false),
          ifoodArrivedAtDestinationSynced: toBool(d.ifoodArrivedAtDestinationSynced, false),
        };
      },
    });

    results.logs = await migrateCollection({
      db, pg, collectionName: collections.logs, table: 'log_entity',
      columns: ['id','where','type','error','user','status','createdAt','updatedAt'],
      conflict: ['id'],
      mapper: (d) => (d.id || d._id) ? ({
        id: String(d.id || mongoId(d._id)), where: String(d.where || ''), type: String(d.type || ''),
        error: String(d.error || ''), user: compactLogUser(d.user || {}), status: String(d.status || ''),
        createdAt: toDate(d.createdAt, new Date()), updatedAt: toDate(d.updatedAt, toDate(d.createdAt, new Date())),
      }) : null,
    });

    results.ifoodEvents = await migrateCollection({
      db, pg, collectionName: collections.ifoodEvents, table: 'ifood_event_entity',
      columns: ['eventId','orderId','merchantId','code','fullCode','salesChannel','createdAt','processedAt','acknowledged'],
      conflict: ['eventId'],
      mapper: (d) => d.eventId ? ({
        eventId: String(d.eventId), orderId: d.orderId ?? null, merchantId: d.merchantId ?? null,
        code: d.code ?? null, fullCode: d.fullCode ?? null, salesChannel: d.salesChannel ?? null,
        createdAt: d.createdAt == null ? null : String(d.createdAt), processedAt: toDate(d.processedAt, new Date()),
        acknowledged: toBool(d.acknowledged, false),
      }) : null,
    });

    results.ifoodLinks = await migrateCollection({
      db, pg, collectionName: collections.ifoodLinks, table: 'ifood_order_link_entity',
      columns: ['ifoodOrderId','ifoodDisplayId','merchantId','merchantName','deliveryId','shopkeeperId','createdAt'],
      conflict: ['ifoodOrderId','merchantId'],
      mapper: (d) => d.ifoodOrderId && d.merchantId && d.deliveryId && d.shopkeeperId ? ({
        ifoodOrderId: String(d.ifoodOrderId), ifoodDisplayId: d.ifoodDisplayId ?? null,
        merchantId: String(d.merchantId), merchantName: d.merchantName ?? null,
        deliveryId: String(d.deliveryId), shopkeeperId: String(d.shopkeeperId), createdAt: toDate(d.createdAt, new Date()),
      }) : null,
    });

    results.ifoodCredits = await migrateCollection({
      db, pg, collectionName: collections.ifoodCredits, table: 'ifood_credit_history_entity',
      columns: ['id','companyId','operationType','amount','releasedAfterOperation','usedAfterOperation','availableAfterOperation','performedBy','orderId','reason','createdAt'],
      conflict: ['id'],
      mapper: (d) => (d.id || d._id) && d.companyId ? ({
        id: String(d.id || mongoId(d._id)), companyId: String(d.companyId), operationType: String(d.operationType || 'ADD'),
        amount: toNumber(d.amount, 0), releasedAfterOperation: toNumber(d.releasedAfterOperation, 0),
        usedAfterOperation: toNumber(d.usedAfterOperation, 0), availableAfterOperation: toNumber(d.availableAfterOperation, 0),
        performedBy: d.performedBy ?? null, orderId: d.orderId ?? null, reason: d.reason ?? null,
        createdAt: toDate(d.createdAt, new Date()),
      }) : null,
    });

    results.settlements = await migrateCollection({
      db, pg, collectionName: collections.settlements, table: 'financial_settlement_history_entity',
      columns: ['legacyMongoId','establishmentId','establishmentName','cityId','cityName','periodStart','periodEnd','deliveriesCount','deliveryFeeValue','total','includeMonthlyFee','monthlyFeeValue','pixKey','whatsappPhone','whatsappAdminPhone','whatsappPhoneNumberId','filename','sentAt','status','errorMessage'],
      conflict: ['legacyMongoId'],
      mapper: (d) => d.establishmentId ? ({
        legacyMongoId: mongoId(d._id), establishmentId: String(d.establishmentId),
        establishmentName: String(d.establishmentName || ''), cityId: d.cityId ? String(d.cityId) : null,
        cityName: d.cityName ?? null, periodStart: toDate(d.periodStart, new Date()), periodEnd: toDate(d.periodEnd, new Date()),
        deliveriesCount: toNumber(d.deliveriesCount, 0), deliveryFeeValue: toNumber(d.deliveryFeeValue, 0),
        total: toNumber(d.total, 0), includeMonthlyFee: d.includeMonthlyFee == null ? null : Boolean(d.includeMonthlyFee),
        monthlyFeeValue: d.monthlyFeeValue == null ? null : toNumber(d.monthlyFeeValue, 0), pixKey: d.pixKey ?? null,
        whatsappPhone: d.whatsappPhone ?? null, whatsappAdminPhone: d.whatsappAdminPhone ?? null,
        whatsappPhoneNumberId: d.whatsappPhoneNumberId ?? null, filename: String(d.filename || 'relatorio.pdf'),
        sentAt: toDate(d.sentAt, new Date()), status: String(d.status || 'pendente'), errorMessage: d.errorMessage ?? null,
      }) : null,
    });

    console.log('\nMigração concluída:');
    console.table(results);
    console.log('Execute npm run db:verify antes de trocar o backend para PostgreSQL.');
  } finally {
    await Promise.allSettled([mongoClient.close(), pg.end()]);
  }
}

main().catch((error) => {
  console.error('\nMigração falhou:', error);
  process.exitCode = 1;
});

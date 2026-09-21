/* eslint-disable no-console */
const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId, Decimal128 } = require('mongodb');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const FINAL_SYNC = process.argv.includes('--sync-existing') || String(process.env.FINAL_SYNC_EXISTING || '').toLowerCase() === 'true';
const FULL = process.argv.includes('--full') || String(process.env.IMPORT_HEAVY_HISTORY || '').toLowerCase() === 'true';
const BATCH_SIZE = Math.max(25, Number(process.env.MIGRATION_BATCH_SIZE || 200));
const IMPORT_NOTIFICATION_SUBSCRIPTIONS = String(process.env.IMPORT_NOTIFICATION_SUBSCRIPTIONS || '').toLowerCase() === 'true';

const collectionCandidates = {
  cities: ['city_entity', 'city'],
  users: ['user_entity', 'user'],
  deliveries: ['delivery_entity', 'delivery'],
  logs: ['log_entity', 'log'],
  ifoodEvents: ['ifood_event_entity', 'ifood_event'],
  ifoodLinks: ['ifood_order_link_entity', 'ifood_order_link'],
  ifoodCredits: ['ifood_credit_history_entity', 'ifood_credit_history'],
  settlements: ['financial_settlement_history_entity', 'financial_settlement_history'],
};

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

function normalizeKey(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function cityKey(name, state) {
  return `${normalizeKey(name)}|${normalizeKey(state)}`;
}

function mongoId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value.toHexString();
  return String(value);
}

function mongoObjectIdDate(value) {
  if (!value) return null;
  try {
    if (value instanceof ObjectId) return value.getTimestamp();
    const text = String(value);
    if (/^[0-9a-fA-F]{24}$/.test(text)) return new ObjectId(text).getTimestamp();
  } catch (_) {}
  return null;
}

function nonBlank(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function sourceDocumentIds(document) {
  return Array.from(
    new Set(
      [nonBlank(document?.id), mongoId(document?._id)]
        .filter(Boolean)
        .map(String),
    ),
  );
}

function mapAliases(idMap, aliases, mappedId) {
  if (!mappedId) return;
  for (const alias of aliases || []) {
    if (alias) idMap.set(String(alias), String(mappedId));
  }
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

function toBigIntString(value, fallback = '0') {
  if (value === undefined || value === null || value === '') return fallback;
  if (value instanceof Decimal128) value = value.toString();
  if (typeof value === 'bigint') return value.toString();

  const text = String(value).trim();
  if (/^[+-]?\d+$/.test(text)) return text.replace(/^\+/, '');

  // Converte números decimais / notação científica para inteiro decimal puro.
  // Ex.: 1e+24 -> 1000000000000000000000000.
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return fallback;

  const sign = match[1] === '-' ? '-' : '';
  const integerPart = match[2] || '0';
  const fractionalPart = match[3] || '';
  const exponent = Number(match[4] || 0);
  if (!Number.isFinite(exponent)) return fallback;

  let digits = `${integerPart}${fractionalPart}`;
  let decimalPosition = integerPart.length + exponent;

  if (decimalPosition <= 0) {
    return '0';
  }

  if (decimalPosition < digits.length) {
    // Contadores são inteiros; truncamos apenas a parte fracionária.
    digits = digits.slice(0, decimalPosition);
  } else if (decimalPosition > digits.length) {
    digits += '0'.repeat(decimalPosition - digits.length);
  }

  digits = digits.replace(/^0+(?=\d)/, '') || '0';
  return digits === '0' ? '0' : `${sign}${digits}`;
}

function toBool(value, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function cleanJson(value) {
  if (value === undefined || value === null) return null;
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

function compactEstablishment(user, mappedUserId, mappedCityId) {
  if (!user) return null;
  return {
    id: mappedUserId || user.id || null,
    name: user.name || '',
    phone: user.phone || '',
    profileImage: user.profileImage ?? null,
    location: user.location ?? null,
    pix: user.pix ?? null,
    cityId: mappedCityId || (user.cityId ? String(user.cityId) : null),
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
            pickupAddress: String(merchant?.pickupAddress || '').trim() || undefined,
          }))
          .filter((merchant) => merchant.merchantId)
      : [],
  };
}

function compactMotoboy(user, mappedUserId, mappedCityId) {
  if (!user) return null;
  return {
    id: mappedUserId || user.id || null,
    name: user.name || '',
    phone: user.phone || '',
    cityId: mappedCityId || (user.cityId ? String(user.cityId) : null),
    type: user.type || 'motoboy',
    profileImage: user.profileImage ?? null,
    notification: user.notification?.subscriptionId
      ? { subscriptionId: user.notification.subscriptionId }
      : null,
  };
}

function compactLogUser(user, userIdMap, cityIdMap) {
  if (!user) return {};
  const sourceUserId = user.id ? String(user.id) : null;
  const sourceCityId = user.cityId ? String(user.cityId) : null;
  return {
    id: sourceUserId ? (userIdMap.get(sourceUserId) || sourceUserId) : null,
    name: user.name ?? '',
    user: user.user ?? '',
    phone: user.phone ?? '',
    type: user.type ?? null,
    permission: user.permission ?? null,
    cityId: sourceCityId ? (cityIdMap.get(sourceCityId) || sourceCityId) : null,
    isActive: user.isActive !== false,
  };
}

async function resolveCollections(db) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name),
  );
  const resolved = {};
  for (const [key, candidates] of Object.entries(collectionCandidates)) {
    resolved[key] = candidates.find((name) => existing.has(name)) || null;
  }
  return resolved;
}

function quote(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function insertDoNothing(pg, table, columns, rows) {
  if (!rows.length) return 0;
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const params = [];
    const valuesSql = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        const raw = row[column] === undefined ? null : row[column];
        const value = raw && typeof raw === 'object' && !(raw instanceof Date)
          ? JSON.stringify(raw)
          : raw;
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${valuesSql.join(', ')} ON CONFLICT DO NOTHING RETURNING 1`;
    const result = await pg.query(sql, params);
    inserted += result.rowCount || 0;
  }

  return inserted;
}


async function upsertRows(pg, table, columns, rows, conflictColumns) {
  if (!rows.length) return 0;
  let affected = 0;
  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const params = [];
    const valuesSql = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        const raw = row[column] === undefined ? null : row[column];
        const value = raw && typeof raw === 'object' && !(raw instanceof Date)
          ? JSON.stringify(raw)
          : raw;
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${valuesSql.join(', ')} ON CONFLICT (${conflictColumns.map(quote).join(', ')}) DO UPDATE SET ${updateColumns.map((column) => `${quote(column)} = EXCLUDED.${quote(column)}`).join(', ')} RETURNING 1`;
    const result = await pg.query(sql, params);
    affected += result.rowCount || 0;
  }

  return affected;
}

async function loadTargetState(pg) {
  const [cities, users, deliveries, links, credits, settlements, logs, events] = await Promise.all([
    pg.query('SELECT "id", "name", "state" FROM "city_entity"'),
    pg.query('SELECT "id", "user", "cityId" FROM "user_entity"'),
    pg.query('SELECT "id" FROM "delivery_entity"'),
    pg.query('SELECT "ifoodOrderId", "merchantId" FROM "ifood_order_link_entity"'),
    pg.query('SELECT "id" FROM "ifood_credit_history_entity"'),
    pg.query('SELECT "legacyMongoId" FROM "financial_settlement_history_entity" WHERE "legacyMongoId" IS NOT NULL'),
    FULL ? pg.query('SELECT "id" FROM "log_entity"') : Promise.resolve({ rows: [] }),
    FULL ? pg.query('SELECT "eventId" FROM "ifood_event_entity"') : Promise.resolve({ rows: [] }),
  ]);

  return {
    cities: cities.rows,
    users: users.rows,
    deliveryIds: new Set(deliveries.rows.map((r) => String(r.id))),
    linkKeys: new Set(links.rows.map((r) => `${r.ifoodOrderId}|${r.merchantId}`)),
    creditIds: new Set(credits.rows.map((r) => String(r.id))),
    settlementIds: new Set(settlements.rows.map((r) => String(r.legacyMongoId))),
    logIds: new Set(logs.rows.map((r) => String(r.id))),
    eventIds: new Set(events.rows.map((r) => String(r.eventId))),
  };
}

async function prepareCityMerge(db, pg, collectionName) {
  const target = await pg.query('SELECT "id", "name", "state" FROM "city_entity"');
  const byId = new Map(target.rows.map((r) => [String(r.id), r]));
  const byKey = new Map(target.rows.map((r) => [cityKey(r.name, r.state), r]));
  const idMap = new Map();
  const rowsToInsert = [];
  let matchedById = 0;
  let matchedByNameState = 0;

  const buildRow = (d, id) => ({
    id: String(id),
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
  });

  if (!collectionName) {
    return { idMap, rowsToInsert, stats: { source: 0, matchedById, matchedByNameState, candidates: 0 } };
  }

  const source = await db.collection(collectionName).find({}).toArray();
  for (const d of source) {
    const aliases = sourceDocumentIds(d);
    const sourceId = nonBlank(d.id) || mongoId(d._id);
    if (!sourceId) continue;

    const sameId = aliases.map((alias) => byId.get(alias)).find(Boolean);
    if (sameId) {
      const mappedId = String(sameId.id);
      mapAliases(idMap, aliases, mappedId);
      matchedById += 1;
      if (FINAL_SYNC) rowsToInsert.push(buildRow(d, mappedId));
      continue;
    }

    const key = cityKey(d.name, d.state);
    const sameCity = byKey.get(key);
    if (sameCity) {
      const mappedId = String(sameCity.id);
      mapAliases(idMap, aliases, mappedId);
      matchedByNameState += 1;
      if (FINAL_SYNC) rowsToInsert.push(buildRow(d, mappedId));
      continue;
    }

    mapAliases(idMap, aliases, sourceId);
    const row = buildRow(d, sourceId);
    rowsToInsert.push(row);
    byId.set(sourceId, row);
    byKey.set(key, row);
  }

  return {
    idMap,
    rowsToInsert,
    stats: { source: source.length, matchedById, matchedByNameState, candidates: rowsToInsert.length },
  };
}

async function prepareUserMerge(db, pg, collectionName, cityIdMap) {
  const target = await pg.query('SELECT "id", "user", "cityId" FROM "user_entity"');
  const byId = new Map(target.rows.map((r) => [String(r.id), r]));
  const byUsername = new Map(
    target.rows
      .filter((r) => String(r.user || '').trim())
      .map((r) => [normalizeKey(r.user), r]),
  );
  const idMap = new Map();
  const rowsToInsert = [];
  let matchedById = 0;
  let matchedByUsername = 0;
  let invalid = 0;

  const buildRow = (d, id) => {
    const sourceCityId = d.cityId ? String(d.cityId) : null;
    const mappedCityId = sourceCityId ? (cityIdMap.get(sourceCityId) || sourceCityId) : null;
    return {
      id: String(id),
      name: String(d.name || ''),
      phone: String(d.phone || ''),
      user: String(d.user || '').trim(),
      password: String(d.password || ''),
      profileImage: d.profileImage ?? null,
      location: d.location ?? null,
      type: String(d.type || 'shopkeeper'),
      permission: String(d.permission || 'none'),
      pix: d.pix ?? null,
      cityId: mappedCityId,
      isActive: toBool(d.isActive, true),
      blocked: toBool(d.blocked, false),
      blockedReason: d.blockedReason ?? null,
      blockedAt: toDate(d.blockedAt),
      blockedBySystem: toBool(d.blockedBySystem, false),
      unblockedAt: toDate(d.unblockedAt),
      unblockedBy: d.unblockedBy ?? null,
      notification: IMPORT_NOTIFICATION_SUBSCRIPTIONS ? cleanJson(d.notification) : null,
      token: null,
      useIfoodIntegration: toBool(d.useIfoodIntegration, false),
      usesExternalIfoodPdv: toBool(d.usesExternalIfoodPdv, false),
      ifoodWithoutPreparationTime: toBool(d.ifoodWithoutPreparationTime, false),
      ifoodMerchantId: d.ifoodMerchantId ?? null,
      ifoodMerchants: cleanJson(Array.isArray(d.ifoodMerchants) ? d.ifoodMerchants : []),
      ifoodClientId: d.ifoodClientId ?? null,
      ifoodClientSecret: d.ifoodClientSecret ?? null,
      ifoodOrdersReleased: toBigIntString(d.ifoodOrdersReleased, '0'),
      ifoodOrdersUsed: toBigIntString(d.ifoodOrdersUsed, '0'),
      ifoodOrdersAvailable: toBigIntString(d.ifoodOrdersAvailable, '0'),
      createdAt: toDate(d.createdAt, new Date()),
      createdBy: d.createdBy ?? null,
      updatedAt: toDate(d.updatedAt, toDate(d.createdAt, new Date())),
    };
  };

  if (!collectionName) {
    return { idMap, rowsToInsert, stats: { source: 0, matchedById, matchedByUsername, invalid, candidates: 0 } };
  }

  const source = await db.collection(collectionName).find({}).toArray();
  for (const d of source) {
    const aliases = sourceDocumentIds(d);
    const sourceId = nonBlank(d.id) || mongoId(d._id);
    const username = String(d.user || '').trim();
    if (!sourceId || !username || !d.password) {
      invalid += 1;
      continue;
    }

    const sameId = aliases.map((alias) => byId.get(alias)).find(Boolean);
    if (sameId) {
      const mappedId = String(sameId.id);
      mapAliases(idMap, aliases, mappedId);
      matchedById += 1;
      if (FINAL_SYNC) rowsToInsert.push(buildRow(d, mappedId));
      continue;
    }

    const sameUser = byUsername.get(normalizeKey(username));
    if (sameUser) {
      const mappedId = String(sameUser.id);
      mapAliases(idMap, aliases, mappedId);
      matchedByUsername += 1;
      if (FINAL_SYNC) rowsToInsert.push(buildRow(d, mappedId));
      continue;
    }

    mapAliases(idMap, aliases, sourceId);
    const row = buildRow(d, sourceId);
    rowsToInsert.push(row);
    byId.set(sourceId, row);
    byUsername.set(normalizeKey(username), row);
  }

  return {
    idMap,
    rowsToInsert,
    stats: { source: source.length, matchedById, matchedByUsername, invalid, candidates: rowsToInsert.length },
  };
}

async function importCursor({ db, pg, collectionName, table, columns, mapper, targetKnownKeys, keyOfRow, conflictColumns }) {
  if (!collectionName) return { source: 0, candidates: 0, inserted: 0, skippedExisting: 0, skippedInvalid: 0 };

  const collection = db.collection(collectionName);
  const source = await collection.countDocuments({});
  let candidates = 0;
  let inserted = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  let buffer = [];

  const flush = async () => {
    if (!buffer.length) return;
    if (APPLY) inserted += FINAL_SYNC
      ? await upsertRows(pg, table, columns, buffer, conflictColumns)
      : await insertDoNothing(pg, table, columns, buffer);
    buffer = [];
  };

  const cursor = collection.find({}).batchSize(BATCH_SIZE);
  for await (const doc of cursor) {
    const row = mapper(doc);
    if (!row) {
      skippedInvalid += 1;
      continue;
    }
    const key = keyOfRow ? keyOfRow(row) : null;
    if (!FINAL_SYNC && key && targetKnownKeys?.has(key)) {
      skippedExisting += 1;
      continue;
    }
    candidates += 1;
    buffer.push(row);
    if (buffer.length >= BATCH_SIZE) {
      await flush();
      if (APPLY) process.stdout.write(`\r  ${table}: analisados ${candidates + skippedExisting + skippedInvalid}/${source}, inseridos ${inserted}`);
    }
  }
  await flush();
  if (APPLY && source) process.stdout.write('\n');

  return { source, candidates, inserted: APPLY ? inserted : null, skippedExisting, skippedInvalid };
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
  const db = process.env.MONGODB_DB_NAME ? mongoClient.db(process.env.MONGODB_DB_NAME) : mongoClient.db();
  await pg.connect();

  try {
    const schema = fs.readFileSync(path.join(__dirname, 'postgres-schema.sql'), 'utf8');
    if (APPLY) await pg.query(schema);

    const collections = await resolveCollections(db);
    const targetState = await loadTargetState(pg);

    console.log(`MongoDB origem: ${db.databaseName}`);
    console.log(`Modo: ${APPLY ? (FINAL_SYNC ? 'APPLY FINAL (sincroniza e atualiza registros existentes)' : 'APPLY (merge sem sobrescrever dados atuais)') : (FINAL_SYNC ? 'DRY-RUN FINAL' : 'DRY-RUN')}`);
    console.log(`Histórico pesado (logs + eventos iFood): ${FULL ? 'SIM' : 'NÃO'}`);
    console.log('Coleções detectadas:', collections);

    const cityMerge = await prepareCityMerge(db, pg, collections.cities);
    const userMerge = await prepareUserMerge(db, pg, collections.users, cityMerge.idMap);

    console.log('\nPlanejamento de merge:');
    console.table({
      cities: cityMerge.stats,
      users: userMerge.stats,
    });

    const cityColumns = [
      'id','name','state','clientWhatsappMessage','deliveryValue','deliveryFeeValue','monthlyFeeValue',
      'pixKey','adminWhatsapp','whatsappPhoneNumberId','whatsappCloudToken',
    ];
    const userColumns = [
      'id','name','phone','user','password','profileImage','location','type','permission','pix','cityId',
      'isActive','blocked','blockedReason','blockedAt','blockedBySystem','unblockedAt','unblockedBy',
      'notification','token','useIfoodIntegration','usesExternalIfoodPdv','ifoodWithoutPreparationTime',
      'ifoodMerchantId','ifoodMerchants','ifoodClientId','ifoodClientSecret','ifoodOrdersReleased',
      'ifoodOrdersUsed','ifoodOrdersAvailable','createdAt','createdBy','updatedAt',
    ];

    const results = {};
    results.cities = {
      ...cityMerge.stats,
      inserted: APPLY ? (FINAL_SYNC ? await upsertRows(pg, 'city_entity', cityColumns, cityMerge.rowsToInsert, ['id']) : await insertDoNothing(pg, 'city_entity', cityColumns, cityMerge.rowsToInsert)) : null,
    };
    results.users = {
      ...userMerge.stats,
      inserted: APPLY ? (FINAL_SYNC ? await upsertRows(pg, 'user_entity', userColumns, userMerge.rowsToInsert, ['id']) : await insertDoNothing(pg, 'user_entity', userColumns, userMerge.rowsToInsert)) : null,
    };

    const sourceDeliveryIds = new Set();
    const deliveryDiagnostics = {
      idRecoveredFromMongoObjectId: 0,
      establishmentRecoveredFromScalarId: 0,
      establishmentKeptAsLegacyReference: 0,
      motoboyKeptAsLegacyReference: 0,
      missingDeliveryId: 0,
      missingEstablishmentId: 0,
      missingIsActiveForcedInactive: 0,
      missingStatusForcedInactive: 0,
      createdAtRecoveredFromMongoObjectId: 0,
    };
    results.deliveries = await importCursor({
      db,
      pg,
      collectionName: collections.deliveries,
      table: 'delivery_entity',
      conflictColumns: ['id'],
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
      targetKnownKeys: targetState.deliveryIds,
      keyOfRow: (r) => String(r.id),
      mapper: (d) => {
        const deliveryId = nonBlank(d.id) || mongoId(d._id);
        if (!deliveryId) {
          deliveryDiagnostics.missingDeliveryId += 1;
          return null;
        }
        if (!nonBlank(d.id) && mongoId(d._id)) {
          deliveryDiagnostics.idRecoveredFromMongoObjectId += 1;
        }

        // O snapshot da entrega é a fonte histórica. Não exigimos que a empresa
        // ainda exista em user_entity: não há FK e isso evita perder entregas de
        // lojas antigas/excluídas. Também aceitamos o establishmentId escalar de
        // versões intermediárias do backend.
        let sourceEstablishmentId = nonBlank(d.establishment?.id);
        if (!sourceEstablishmentId && nonBlank(d.establishmentId)) {
          sourceEstablishmentId = nonBlank(d.establishmentId);
          deliveryDiagnostics.establishmentRecoveredFromScalarId += 1;
        }
        if (!sourceEstablishmentId) {
          deliveryDiagnostics.missingEstablishmentId += 1;
          return null;
        }

        const mappedEstablishmentId =
          userMerge.idMap.get(sourceEstablishmentId) || sourceEstablishmentId;
        if (!userMerge.idMap.has(sourceEstablishmentId)) {
          deliveryDiagnostics.establishmentKeptAsLegacyReference += 1;
        }

        const sourceCityId = d.establishment?.cityId
          ? String(d.establishment.cityId)
          : (d.establishmentCityId ? String(d.establishmentCityId) : null);
        const mappedCityId = sourceCityId ? (cityMerge.idMap.get(sourceCityId) || sourceCityId) : null;
        const sourceMotoboyId = d.motoboy?.id
          ? String(d.motoboy.id)
          : (d.motoboyId ? String(d.motoboyId) : null);
        const mappedMotoboyId = sourceMotoboyId
          ? (userMerge.idMap.get(sourceMotoboyId) || sourceMotoboyId)
          : null;
        if (sourceMotoboyId && !userMerge.idMap.has(sourceMotoboyId)) {
          deliveryDiagnostics.motoboyKeptAsLegacyReference += 1;
        }
        const motoboyCityId = d.motoboy?.cityId ? String(d.motoboy.cityId) : null;
        const mappedMotoboyCityId = motoboyCityId ? (cityMerge.idMap.get(motoboyCityId) || motoboyCityId) : null;

        const establishmentSnapshot = d.establishment
          ? compactEstablishment(d.establishment, mappedEstablishmentId, mappedCityId)
          : {
              id: mappedEstablishmentId,
              name: String(d.establishmentName || d.ifoodMerchantName || 'Estabelecimento legado'),
              phone: String(d.establishmentPhone || ''),
              profileImage: null,
              location: null,
              pix: null,
              cityId: mappedCityId,
              cityName: d.cityName ?? null,
              notification: null,
              usesExternalIfoodPdv: false,
              ifoodMerchants: [],
            };
        const motoboySnapshot = d.motoboy
          ? compactMotoboy(d.motoboy, mappedMotoboyId, mappedMotoboyCityId)
          : (mappedMotoboyId
              ? {
                  id: mappedMotoboyId,
                  name: String(d.motoboyName || ''),
                  phone: String(d.motoboyPhone || ''),
                  cityId: mappedMotoboyCityId,
                  type: 'motoboy',
                  profileImage: null,
                  notification: null,
                }
              : null);

        const objectIdCreatedAt = mongoObjectIdDate(d._id);
        const sourceCreatedAt = toDate(d.createdAt, objectIdCreatedAt || new Date(0));
        const sourceStatus = nonBlank(d.status);
        const sourceHasIsActive = d.isActive !== undefined && d.isActive !== null;
        const sourceIsActive = d.isActive === true;

        // Replicar a semântica do Mongo em produção: filtros com isActive=true
        // não incluem documentos legados onde o campo não existe.
        if (!sourceHasIsActive) deliveryDiagnostics.missingIsActiveForcedInactive += 1;
        // Um status ausente não pode virar uma entrega PENDENTE visível após a migração.
        if (!sourceStatus) deliveryDiagnostics.missingStatusForcedInactive += 1;
        if (!d.createdAt && objectIdCreatedAt) {
          deliveryDiagnostics.createdAtRecoveredFromMongoObjectId += 1;
        }

        sourceDeliveryIds.add(String(deliveryId));
        return {
          id: String(deliveryId),
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
          status: String(sourceStatus || 'PENDENTE'),
          establishment: establishmentSnapshot,
          motoboy: motoboySnapshot,
          establishmentId: mappedEstablishmentId,
          establishmentCityId: mappedCityId,
          motoboyId: mappedMotoboyId,
          value: String(d.value ?? '0'),
          observation: d.observation ?? '',
          destinationObservation: d.destinationObservation ?? null,
          destinationObservationConfirmed: toBool(d.destinationObservationConfirmed, false),
          soda: d.soda ?? '',
          payment: String(d.payment || 'PAGO'),
          // Campo ausente no Mongo permanece fora das filas ativas no PostgreSQL.
          // Se o status também estiver ausente, o registro fica histórico/inativo.
          isActive: sourceHasIsActive && sourceStatus ? sourceIsActive : false,
          createdAt: sourceCreatedAt,
          createdBy: d.createdBy ?? null,
          updatedAt: toDate(d.updatedAt, sourceCreatedAt),
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
    results.deliveries.diagnostics = deliveryDiagnostics;

    const ifoodLinkDiagnostics = { legacyShopkeeperReference: 0, missingRequiredFields: 0 };
    results.ifoodLinks = await importCursor({
      db,
      pg,
      collectionName: collections.ifoodLinks,
      table: 'ifood_order_link_entity',
      conflictColumns: ['ifoodOrderId', 'merchantId'],
      columns: ['ifoodOrderId','ifoodDisplayId','merchantId','merchantName','deliveryId','shopkeeperId','createdAt'],
      targetKnownKeys: targetState.linkKeys,
      keyOfRow: (r) => `${r.ifoodOrderId}|${r.merchantId}`,
      mapper: (d) => {
        if (!d.ifoodOrderId || !d.merchantId || !d.deliveryId || !d.shopkeeperId) {
          ifoodLinkDiagnostics.missingRequiredFields += 1;
          return null;
        }
        const sourceShopkeeperId = String(d.shopkeeperId);
        const mappedShopkeeperId = userMerge.idMap.get(sourceShopkeeperId) || sourceShopkeeperId;
        if (!userMerge.idMap.has(sourceShopkeeperId)) {
          ifoodLinkDiagnostics.legacyShopkeeperReference += 1;
        }
        return {
          ifoodOrderId: String(d.ifoodOrderId),
          ifoodDisplayId: d.ifoodDisplayId ?? null,
          merchantId: String(d.merchantId),
          merchantName: d.merchantName ?? null,
          deliveryId: String(d.deliveryId),
          shopkeeperId: mappedShopkeeperId,
          createdAt: toDate(d.createdAt, new Date()),
        };
      },
    });
    results.ifoodLinks.diagnostics = ifoodLinkDiagnostics;

    const ifoodCreditDiagnostics = { legacyCompanyReference: 0, missingRequiredFields: 0 };
    results.ifoodCredits = await importCursor({
      db,
      pg,
      collectionName: collections.ifoodCredits,
      table: 'ifood_credit_history_entity',
      conflictColumns: ['id'],
      columns: ['id','companyId','operationType','amount','releasedAfterOperation','usedAfterOperation','availableAfterOperation','performedBy','orderId','reason','createdAt'],
      targetKnownKeys: targetState.creditIds,
      keyOfRow: (r) => String(r.id),
      mapper: (d) => {
        const id = d.id || mongoId(d._id);
        if (!id || !d.companyId) {
          ifoodCreditDiagnostics.missingRequiredFields += 1;
          return null;
        }
        const sourceCompanyId = String(d.companyId);
        const mappedCompanyId = userMerge.idMap.get(sourceCompanyId) || sourceCompanyId;
        if (!userMerge.idMap.has(sourceCompanyId)) {
          ifoodCreditDiagnostics.legacyCompanyReference += 1;
        }
        const sourcePerformedBy = d.performedBy ? String(d.performedBy) : null;
        return {
          id: String(id),
          companyId: mappedCompanyId,
          operationType: String(d.operationType || 'ADD'),
          amount: toBigIntString(d.amount, '0'),
          releasedAfterOperation: toBigIntString(d.releasedAfterOperation, '0'),
          usedAfterOperation: toBigIntString(d.usedAfterOperation, '0'),
          availableAfterOperation: toBigIntString(d.availableAfterOperation, '0'),
          performedBy: sourcePerformedBy ? (userMerge.idMap.get(sourcePerformedBy) || sourcePerformedBy) : null,
          orderId: d.orderId ?? null,
          reason: d.reason ?? null,
          createdAt: toDate(d.createdAt, new Date()),
        };
      },
    });
    results.ifoodCredits.diagnostics = ifoodCreditDiagnostics;

    const settlementDiagnostics = { legacyEstablishmentReference: 0, missingEstablishmentId: 0 };
    results.settlements = await importCursor({
      db,
      pg,
      collectionName: collections.settlements,
      table: 'financial_settlement_history_entity',
      conflictColumns: ['legacyMongoId'],
      columns: ['legacyMongoId','establishmentId','establishmentName','cityId','cityName','periodStart','periodEnd','deliveriesCount','deliveryFeeValue','total','includeMonthlyFee','monthlyFeeValue','pixKey','whatsappPhone','whatsappAdminPhone','whatsappPhoneNumberId','filename','sentAt','status','errorMessage'],
      targetKnownKeys: targetState.settlementIds,
      keyOfRow: (r) => String(r.legacyMongoId),
      mapper: (d) => {
        if (!d.establishmentId) {
          settlementDiagnostics.missingEstablishmentId += 1;
          return null;
        }
        const sourceEstablishmentId = String(d.establishmentId);
        const mappedEstablishmentId = userMerge.idMap.get(sourceEstablishmentId) || sourceEstablishmentId;
        if (!userMerge.idMap.has(sourceEstablishmentId)) {
          settlementDiagnostics.legacyEstablishmentReference += 1;
        }
        const sourceCityId = d.cityId ? String(d.cityId) : null;
        return {
          legacyMongoId: mongoId(d._id),
          establishmentId: mappedEstablishmentId,
          establishmentName: String(d.establishmentName || ''),
          cityId: sourceCityId ? (cityMerge.idMap.get(sourceCityId) || sourceCityId) : null,
          cityName: d.cityName ?? null,
          periodStart: toDate(d.periodStart, new Date()),
          periodEnd: toDate(d.periodEnd, new Date()),
          deliveriesCount: toNumber(d.deliveriesCount, 0),
          deliveryFeeValue: toNumber(d.deliveryFeeValue, 0),
          total: toNumber(d.total, 0),
          includeMonthlyFee: d.includeMonthlyFee == null ? null : Boolean(d.includeMonthlyFee),
          monthlyFeeValue: d.monthlyFeeValue == null ? null : toNumber(d.monthlyFeeValue, 0),
          pixKey: d.pixKey ?? null,
          whatsappPhone: d.whatsappPhone ?? null,
          whatsappAdminPhone: d.whatsappAdminPhone ?? null,
          whatsappPhoneNumberId: d.whatsappPhoneNumberId ?? null,
          filename: String(d.filename || 'relatorio.pdf'),
          sentAt: toDate(d.sentAt, new Date()),
          status: String(d.status || 'pendente'),
          errorMessage: d.errorMessage ?? null,
        };
      },
    });
    results.settlements.diagnostics = settlementDiagnostics;

    if (FULL) {
      results.logs = await importCursor({
        db,
        pg,
        collectionName: collections.logs,
        table: 'log_entity',
        conflictColumns: ['id'],
        columns: ['id','where','type','error','user','status','createdAt','updatedAt'],
        targetKnownKeys: targetState.logIds,
        keyOfRow: (r) => String(r.id),
        mapper: (d) => {
          const id = d.id || mongoId(d._id);
          if (!id) return null;
          return {
            id: String(id),
            where: String(d.where || ''),
            type: String(d.type || ''),
            error: String(d.error || ''),
            user: compactLogUser(d.user || {}, userMerge.idMap, cityMerge.idMap),
            status: String(d.status || ''),
            createdAt: toDate(d.createdAt, new Date()),
            updatedAt: toDate(d.updatedAt, toDate(d.createdAt, new Date())),
          };
        },
      });

      results.ifoodEvents = await importCursor({
        db,
        pg,
        collectionName: collections.ifoodEvents,
        table: 'ifood_event_entity',
        conflictColumns: ['eventId'],
        columns: ['eventId','orderId','merchantId','code','fullCode','salesChannel','createdAt','processedAt','acknowledged'],
        targetKnownKeys: targetState.eventIds,
        keyOfRow: (r) => String(r.eventId),
        mapper: (d) => d.eventId ? ({
          eventId: String(d.eventId),
          orderId: d.orderId ?? null,
          merchantId: d.merchantId ?? null,
          code: d.code ?? null,
          fullCode: d.fullCode ?? null,
          salesChannel: d.salesChannel ?? null,
          createdAt: d.createdAt == null ? null : String(d.createdAt),
          processedAt: toDate(d.processedAt, new Date()),
          acknowledged: toBool(d.acknowledged, false),
        }) : null,
      });
    } else {
      results.logs = { skippedByMode: true };
      results.ifoodEvents = { skippedByMode: true };
    }

    console.log('\nResumo da importação/planejamento:');
    console.dir(results, { depth: null });

    if (!APPLY) {
      console.log('\nDRY-RUN concluído. Nenhum dado do Supabase foi alterado.');
      console.log('Para importar o histórico principal: npm run import:mongo-history:apply');
      console.log('Para incluir também logs + eventos brutos iFood: npm run import:mongo-history:apply:full');
    } else {
      console.log('\nImportação concluída em modo MERGE. Dados que já existiam no Supabase foram preservados.');
      console.log('Execute npm run db:verify para validar o banco PostgreSQL.');
    }
  } finally {
    await Promise.allSettled([mongoClient.close(), pg.end()]);
  }
}

main().catch((error) => {
  console.error('\nImportação falhou:', error);
  process.exitCode = 1;
});

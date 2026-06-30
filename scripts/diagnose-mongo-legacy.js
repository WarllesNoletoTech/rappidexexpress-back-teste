/* eslint-disable no-console */
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const limit = Number(process.env.DIAG_LIMIT || 50);

const validStatuses = [
  'AGUARDANDO_LIBERACAO',
  'PENDENTE',
  'ACAMINHO',
  'CHEGOU_ESTABELECIMENTO',
  'COLETADO',
  'CHEGOU_DESTINO',
  'AGUARDANDO_CODIGO',
  'FINALIZADO',
  'CANCELADO',
];

function printSection(title, docs) {
  console.log(`\n=== ${title} (mostrando até ${limit}) ===`);
  if (!docs.length) {
    console.log('Nenhum problema encontrado.');
    return;
  }
  console.dir(docs, { depth: 8, colors: false });
}

async function listDuplicateGroups(collection, fields) {
  const [first, second] = fields;
  return collection
    .aggregate([
      {
        $match: {
          [first]: { $type: 'string', $ne: '' },
          [second]: { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: { [first]: `$${first}`, [second]: `$${second}` },
          count: { $sum: 1 },
          docs: {
            $push: {
              _id: '$_id',
              id: '$id',
              deliveryId: '$deliveryId',
              shopkeeperId: '$shopkeeperId',
              status: '$status',
              createdAt: '$createdAt',
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ])
    .toArray();
}

async function main() {
  if (!uri) {
    throw new Error('Defina MONGODB_URI antes de executar o diagnóstico.');
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  console.log(
    `Diagnóstico MongoDB legado iniciado. db=${db.databaseName} limit=${limit}`,
  );
  console.log('Somente leitura: este script NÃO altera nem apaga documentos.');

  try {
    const delivery = db.collection('delivery');
    const ifoodOrderLink = db.collection('ifood_order_link');

    printSection(
      'Duplicados em delivery por ifoodOrderId + ifoodMerchantId',
      await listDuplicateGroups(delivery, ['ifoodOrderId', 'ifoodMerchantId']),
    );

    printSection(
      'Duplicados em ifood_order_link por ifoodOrderId + merchantId',
      await listDuplicateGroups(ifoodOrderLink, ['ifoodOrderId', 'merchantId']),
    );

    printSection(
      'Delivery com ifoodOrderId preenchido e ifoodMerchantId vazio/null/ausente',
      await delivery
        .find({
          ifoodOrderId: { $type: 'string', $ne: '' },
          $or: [
            { ifoodMerchantId: { $exists: false } },
            { ifoodMerchantId: null },
            { ifoodMerchantId: '' },
          ],
        })
        .project({
          _id: 1,
          id: 1,
          ifoodOrderId: 1,
          ifoodMerchantId: 1,
          status: 1,
          createdAt: 1,
        })
        .limit(limit)
        .toArray(),
    );

    printSection(
      'Delivery com campos legados/incompatíveis para a versão nova',
      await delivery
        .find({
          $or: [
            { establishment: { $exists: false } },
            { establishment: null },
            { 'establishment.cityId': { $exists: false } },
            { 'establishment.cityId': null },
            { motoboy: { $not: { $type: 'object' }, $ne: null } },
            { createdAt: { $not: { $type: 'date' } } },
            { status: { $nin: validStatuses } },
          ],
        })
        .project({
          _id: 1,
          id: 1,
          status: 1,
          createdAt: 1,
          establishment: 1,
          motoboy: 1,
          ifoodOrderId: 1,
          ifoodMerchantId: 1,
        })
        .limit(limit)
        .toArray(),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Diagnóstico MongoDB legado falhou:', error);
  process.exitCode = 1;
});

const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  const db = client.db(process.env.MONGODB_DB_NAME || 'deliveryDB');

  const filtro = {
    $or: [
      { id: { $exists: false } },
      { id: null },
      { id: '' },
      { 'establishment.id': { $exists: false } },
      { 'establishment.id': null },
      { 'establishment.id': '' }
    ]
  };

  const docs = await db.collection('delivery_entity')
    .find(filtro, {
      projection: {
        _id: 1,
        id: 1,
        'establishment.id': 1,
        'establishment.name': 1,
        createdAt: 1,
        status: 1,
        ifoodOrderId: 1,
        ifoodDisplayId: 1
      }
    })
    .toArray();

  console.log(`Encontradas: ${docs.length}`);

  console.table(docs.map(d => ({
    mongoId: String(d._id),
    id: d.id || 'SEM ID',
    estabelecimentoId: d.establishment?.id || 'SEM ESTABELECIMENTO ID',
    estabelecimento: d.establishment?.name || '',
    status: d.status || '',
    data: d.createdAt || '',
    ifoodDisplayId: d.ifoodDisplayId || ''
  })));

  await client.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});

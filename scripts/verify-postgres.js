/* eslint-disable no-console */
const { Client } = require('pg');

async function main() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('DATABASE_URL não configurada.');

  const pg = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  await pg.connect();
  try {
    const tables = [
      'city_entity','user_entity','delivery_entity','log_entity','ifood_event_entity',
      'ifood_order_link_entity','ifood_credit_history_entity','financial_settlement_history_entity',
    ];
    const result = {};
    for (const table of tables) {
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      result[table] = rows[0].count;
    }
    console.table(result);

    const duplicateUsers = await pg.query(
      'SELECT "user", COUNT(*)::int AS count FROM "user_entity" GROUP BY "user" HAVING COUNT(*) > 1 LIMIT 20',
    );
    const orphanDeliveries = await pg.query(
      'SELECT COUNT(*)::int AS count FROM "delivery_entity" d LEFT JOIN "user_entity" u ON u."id" = d."establishmentId" WHERE u."id" IS NULL',
    );
    const activeOrphanDeliveries = await pg.query(
      `SELECT COUNT(*)::int AS count
       FROM "delivery_entity" d
       LEFT JOIN "user_entity" u ON u."id" = d."establishmentId"
       WHERE u."id" IS NULL
         AND d."isActive" = true
         AND d."status" NOT IN ('FINALIZADO', 'CANCELADO')`,
    );
    const orphanMotoboys = await pg.query(
      `SELECT COUNT(*)::int AS count
       FROM "delivery_entity" d
       LEFT JOIN "user_entity" u ON u."id" = d."motoboyId"
       WHERE d."motoboyId" IS NOT NULL AND u."id" IS NULL`,
    );
    const establishmentSnapshotMismatch = await pg.query(
      `SELECT COUNT(*)::int AS count
       FROM "delivery_entity"
       WHERE COALESCE("establishment"->>'id', '') <> COALESCE("establishmentId", '')`,
    );
    const motoboySnapshotMismatch = await pg.query(
      `SELECT COUNT(*)::int AS count
       FROM "delivery_entity"
       WHERE COALESCE("motoboy"->>'id', '') <> COALESCE("motoboyId", '')`,
    );
    const orphanIfoodLinks = await pg.query(
      `SELECT COUNT(*)::int AS count
       FROM "ifood_order_link_entity" l
       LEFT JOIN "delivery_entity" d ON d."id" = l."deliveryId"
       WHERE d."id" IS NULL`,
    );

    console.log(`Usuários duplicados: ${duplicateUsers.rowCount}`);
    console.log(`Entregas históricas cujo estabelecimento não existe mais em user_entity: ${orphanDeliveries.rows[0].count}`);
    console.log(`ATENÇÃO - entregas órfãs ainda ativas/não finalizadas: ${activeOrphanDeliveries.rows[0].count}`);
    console.log(`Entregas com motoboy histórico que não existe mais em user_entity: ${orphanMotoboys.rows[0].count}`);
    console.log(`Entregas com establishmentId divergente do snapshot: ${establishmentSnapshotMismatch.rows[0].count}`);
    console.log(`Entregas com motoboyId divergente do snapshot: ${motoboySnapshotMismatch.rows[0].count}`);
    console.log(`Vínculos iFood apontando para entrega inexistente: ${orphanIfoodLinks.rows[0].count}`);

    if (activeOrphanDeliveries.rows[0].count > 0) {
      console.log('\nHá entregas órfãs ativas/não finalizadas. Revise-as antes do corte definitivo.');
    }
    if (establishmentSnapshotMismatch.rows[0].count > 0 || motoboySnapshotMismatch.rows[0].count > 0) {
      console.log('\nHá divergência entre colunas indexadas e snapshots JSONB. Não faça o corte definitivo até corrigir.');
    }
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Verificação PostgreSQL falhou:', error.message || error);
  process.exitCode = 1;
});

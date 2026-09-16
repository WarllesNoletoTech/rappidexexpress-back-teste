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
    const { rows } = await pg.query(
      `SELECT "id", "name", "type", "cityId", "user"
       FROM "user_entity"
       WHERE "type" IN ('shopkeeper', 'shopkeeperadmin')
       ORDER BY "name" ASC`,
    );
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Erro ao consultar lojistas:', error.message || error);
  process.exitCode = 1;
});

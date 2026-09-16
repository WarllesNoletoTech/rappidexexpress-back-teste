const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function getDatabaseUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    throw new Error('DATABASE_URL não configurada.');
  }
  return url;
}

async function main() {
  const client = new Client({
    connectionString: getDatabaseUrl(),
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  const sql = fs.readFileSync(path.join(__dirname, 'postgres-schema.sql'), 'utf8');
  await client.connect();
  try {
    await client.query(sql);
    console.log('Schema PostgreSQL/Supabase criado ou atualizado com sucesso.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Falha ao aplicar schema PostgreSQL:', error.message || error);
  process.exitCode = 1;
});

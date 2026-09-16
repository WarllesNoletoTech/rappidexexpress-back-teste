/* eslint-disable no-console */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} não configurada.`);
  return value;
}

async function main() {
  const connectionString = required('DATABASE_URL');
  const adminUser = String(process.env.ADMIN_USER || 'admin').trim();
  const adminPassword = required('ADMIN_PASSWORD');
  const adminName = String(process.env.ADMIN_NAME || 'Administrador').trim();
  const adminPhone = String(process.env.ADMIN_PHONE || '00000000000').trim();
  const cityName = String(process.env.ADMIN_CITY_NAME || 'Redenção').trim();
  const cityState = String(process.env.ADMIN_CITY_STATE || 'PA').trim();

  const pg = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  await pg.connect();
  try {
    await pg.query('BEGIN');

    let city = await pg.query(
      'SELECT "id" FROM "city_entity" WHERE "name" = $1 AND "state" = $2 LIMIT 1',
      [cityName, cityState],
    );

    let cityId;
    if (city.rowCount) {
      cityId = city.rows[0].id;
    } else {
      cityId = randomUUID();
      await pg.query(
        'INSERT INTO "city_entity" ("id", "name", "state") VALUES ($1, $2, $3)',
        [cityId, cityName, cityState],
      );
    }

    const existing = await pg.query(
      'SELECT "id" FROM "user_entity" WHERE "user" = $1 LIMIT 1',
      [adminUser],
    );

    if (existing.rowCount) {
      await pg.query('ROLLBACK');
      console.log(`O usuário ${adminUser} já existe. Nenhuma senha foi alterada.`);
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const now = new Date();

    await pg.query(
      `INSERT INTO "user_entity" (
        "id", "name", "phone", "user", "password", "profileImage", "location",
        "type", "permission", "pix", "cityId", "isActive", "blocked",
        "blockedBySystem", "notification", "token", "useIfoodIntegration",
        "usesExternalIfoodPdv", "ifoodWithoutPreparationTime", "ifoodOrdersReleased",
        "ifoodOrdersUsed", "ifoodOrdersAvailable", "createdAt", "createdBy", "updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,'','',
        'superadmin','superadmin','',$6,true,false,
        false,$7::jsonb,'',false,
        false,false,0,
        0,0,$8,'create-admin-script',$8
      )`,
      [
        randomUUID(),
        adminName,
        adminPhone,
        adminUser,
        passwordHash,
        cityId,
        JSON.stringify({ subscriptionId: '' }),
        now,
      ],
    );

    await pg.query('COMMIT');
    console.log(`Administrador criado com sucesso. Login: ${adminUser}`);
    console.log('A senha não é exibida por segurança.');
  } catch (error) {
    await pg.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error('Erro ao criar admin:', error.message || error);
  process.exitCode = 1;
});

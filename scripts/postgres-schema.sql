CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "city_entity" (
  "id" varchar(64) PRIMARY KEY,
  "name" varchar NOT NULL,
  "state" varchar NOT NULL,
  "clientWhatsappMessage" text,
  "deliveryValue" varchar,
  "deliveryFeeValue" double precision,
  "monthlyFeeValue" double precision,
  "pixKey" varchar,
  "adminWhatsapp" varchar,
  "whatsappPhoneNumberId" varchar,
  "whatsappCloudToken" text
);

CREATE TABLE IF NOT EXISTS "user_entity" (
  "internalId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" varchar(64) NOT NULL,
  "name" varchar NOT NULL,
  "phone" varchar NOT NULL,
  "user" varchar NOT NULL,
  "password" varchar NOT NULL,
  "profileImage" varchar,
  "location" text,
  "type" varchar NOT NULL,
  "permission" varchar NOT NULL DEFAULT 'none',
  "pix" varchar,
  "cityId" varchar(64),
  "isActive" boolean NOT NULL DEFAULT true,
  "blocked" boolean NOT NULL DEFAULT false,
  "blockedReason" text,
  "blockedAt" timestamptz,
  "blockedBySystem" boolean NOT NULL DEFAULT false,
  "unblockedAt" timestamptz,
  "unblockedBy" varchar,
  "notification" jsonb,
  "token" text,
  "useIfoodIntegration" boolean NOT NULL DEFAULT false,
  "usesExternalIfoodPdv" boolean NOT NULL DEFAULT false,
  "ifoodWithoutPreparationTime" boolean NOT NULL DEFAULT false,
  "ifoodMerchantId" varchar,
  "ifoodMerchants" jsonb,
  "ifoodClientId" text,
  "ifoodClientSecret" text,
  "ifoodOrdersReleased" integer NOT NULL DEFAULT 0,
  "ifoodOrdersUsed" integer NOT NULL DEFAULT 0,
  "ifoodOrdersAvailable" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" varchar,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "delivery_entity" (
  "internalId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" varchar(64) NOT NULL,
  "clientName" varchar NOT NULL,
  "clientPhone" varchar NOT NULL,
  "clientLocation" text,
  "clientAddress" text,
  "addressComplement" varchar,
  "addressReference" varchar,
  "addressNeighborhood" varchar,
  "addressCity" varchar,
  "addressState" varchar,
  "addressZipCode" varchar,
  "addressLatitude" double precision,
  "addressLongitude" double precision,
  "addressMapsUrl" text,
  "status" varchar NOT NULL,
  "establishment" jsonb NOT NULL,
  "motoboy" jsonb,
  "establishmentId" varchar(64) NOT NULL,
  "establishmentCityId" varchar(64),
  "motoboyId" varchar(64),
  "value" varchar NOT NULL,
  "observation" text,
  "destinationObservation" text,
  "destinationObservationConfirmed" boolean NOT NULL DEFAULT false,
  "soda" varchar,
  "payment" varchar NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" varchar,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "onCoursedAt" timestamptz,
  "collectedAt" timestamptz,
  "arrivedAtStoreAt" timestamptz,
  "ifoodStatus" varchar,
  "externalStatus" varchar,
  "logisticsStatus" varchar,
  "ifoodOrderId" varchar,
  "ifoodDisplayId" varchar,
  "orderLocator" varchar,
  "ifoodMerchantId" varchar,
  "ifoodMerchantName" varchar,
  "ifoodImportedAt" timestamptz,
  "ifoodLastEventCode" varchar,
  "ifoodLastEventFullCode" varchar,
  "ifoodConfirmedAt" timestamptz,
  "releasedAt" timestamptz,
  "releasedBy" varchar,
  "arrivedAtDestinationAt" timestamptz,
  "finishedAt" timestamptz,
  "ifoodAssignDriverSynced" boolean NOT NULL DEFAULT false,
  "ifoodGoingToOriginSynced" boolean NOT NULL DEFAULT false,
  "ifoodArrivedAtOriginSynced" boolean NOT NULL DEFAULT false,
  "ifoodDispatchSynced" boolean NOT NULL DEFAULT false,
  "ifoodArrivedAtDestinationSynced" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "log_entity" (
  "internalId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" varchar(64) NOT NULL,
  "where" varchar NOT NULL,
  "type" varchar NOT NULL,
  "error" text NOT NULL,
  "user" jsonb NOT NULL,
  "status" varchar NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ifood_event_entity" (
  "internalId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId" varchar NOT NULL,
  "orderId" varchar,
  "merchantId" varchar,
  "code" varchar,
  "fullCode" varchar,
  "salesChannel" varchar,
  "createdAt" varchar,
  "processedAt" timestamptz NOT NULL DEFAULT now(),
  "acknowledged" boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ifood_order_link_entity" (
  "internalId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ifoodOrderId" varchar NOT NULL,
  "ifoodDisplayId" varchar,
  "merchantId" varchar NOT NULL,
  "merchantName" varchar,
  "deliveryId" varchar(64) NOT NULL,
  "shopkeeperId" varchar(64) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ifood_credit_history_entity" (
  "internalId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" varchar(64) NOT NULL,
  "companyId" varchar(64) NOT NULL,
  "operationType" varchar NOT NULL,
  "amount" integer NOT NULL,
  "releasedAfterOperation" integer NOT NULL,
  "usedAfterOperation" integer NOT NULL,
  "availableAfterOperation" integer NOT NULL,
  "performedBy" varchar,
  "orderId" varchar,
  "reason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "financial_settlement_history_entity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "legacyMongoId" varchar UNIQUE,
  "establishmentId" varchar(64) NOT NULL,
  "establishmentName" varchar NOT NULL,
  "cityId" varchar(64),
  "cityName" varchar,
  "periodStart" timestamptz NOT NULL,
  "periodEnd" timestamptz NOT NULL,
  "deliveriesCount" integer NOT NULL,
  "deliveryFeeValue" double precision NOT NULL,
  "total" double precision NOT NULL,
  "includeMonthlyFee" boolean,
  "monthlyFeeValue" double precision,
  "pixKey" varchar,
  "whatsappPhone" varchar,
  "whatsappAdminPhone" varchar,
  "whatsappPhoneNumberId" varchar,
  "filename" varchar NOT NULL,
  "sentAt" timestamptz NOT NULL,
  "status" varchar NOT NULL,
  "errorMessage" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_USER_LOGICAL_ID" ON "user_entity" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_USER_USERNAME" ON "user_entity" ("user");
CREATE INDEX IF NOT EXISTS "IDX_USER_CITY_TYPE_ACTIVE" ON "user_entity" ("cityId", "type", "isActive");
CREATE INDEX IF NOT EXISTS "IDX_USER_IFOOD_ACTIVE" ON "user_entity" ("useIfoodIntegration", "isActive");
CREATE INDEX IF NOT EXISTS "IDX_USER_IFOOD_MERCHANTS_GIN" ON "user_entity" USING gin ("ifoodMerchants");

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_DELIVERY_LOGICAL_ID" ON "delivery_entity" ("id");
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_STATUS" ON "delivery_entity" ("status");
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ESTABLISHMENT_CITY" ON "delivery_entity" ("establishmentCityId");
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_MOTOBOY" ON "delivery_entity" ("motoboyId");
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ESTABLISHMENT" ON "delivery_entity" ("establishmentId");
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_CREATED_AT" ON "delivery_entity" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_UPDATED_AT" ON "delivery_entity" ("updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_FINISHED_AT" ON "delivery_entity" ("finishedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ACTIVE_CITY_CREATED" ON "delivery_entity" ("isActive", "establishmentCityId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ACTIVE_STATUS_CITY_FINISHED" ON "delivery_entity" ("isActive", "status", "establishmentCityId", "finishedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ACTIVE_STATUS_CITY_CREATED" ON "delivery_entity" ("isActive", "status", "establishmentCityId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ACTIVE_MOTOBOY_FINISHED" ON "delivery_entity" ("isActive", "motoboyId", "finishedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ACTIVE_ESTABLISHMENT_FINISHED" ON "delivery_entity" ("isActive", "establishmentId", "finishedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_DELIVERY_ACTIVE_MOTOBOY_STATUS_CREATED" ON "delivery_entity" ("isActive", "motoboyId", "status", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_DELIVERY_IFOOD_ORDER_MERCHANT_UNIQUE"
  ON "delivery_entity" ("ifoodOrderId", "ifoodMerchantId");

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_LOG_LOGICAL_ID" ON "log_entity" ("id");
CREATE INDEX IF NOT EXISTS "IDX_LOG_CREATED_AT" ON "log_entity" ("createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_IFOOD_EVENT_EVENT_ID" ON "ifood_event_entity" ("eventId");
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_EVENT_ORDER_PROCESSED" ON "ifood_event_entity" ("orderId", "processedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_EVENT_MERCHANT_PROCESSED" ON "ifood_event_entity" ("merchantId", "processedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_EVENT_ACK_PROCESSED" ON "ifood_event_entity" ("acknowledged", "processedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_EVENT_CODE_PROCESSED" ON "ifood_event_entity" ("code", "processedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_EVENT_FULLCODE_PROCESSED" ON "ifood_event_entity" ("fullCode", "processedAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_IFOOD_ORDER_LINK_ORDER_MERCHANT_UNIQUE" ON "ifood_order_link_entity" ("ifoodOrderId", "merchantId");
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_ORDER_LINK_DELIVERY" ON "ifood_order_link_entity" ("deliveryId");
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_ORDER_LINK_SHOPKEEPER_CREATED" ON "ifood_order_link_entity" ("shopkeeperId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_IFOOD_CREDIT_LOGICAL_ID" ON "ifood_credit_history_entity" ("id");
CREATE INDEX IF NOT EXISTS "IDX_IFOOD_CREDIT_COMPANY_CREATED" ON "ifood_credit_history_entity" ("companyId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_FIN_SETTLEMENT_ESTABLISHMENT_PERIOD" ON "financial_settlement_history_entity" ("establishmentId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "IDX_CITY_NAME_STATE" ON "city_entity" ("name", "state");

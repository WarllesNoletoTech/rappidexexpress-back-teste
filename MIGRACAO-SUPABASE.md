# Rappidex Express — Migração MongoDB Atlas → Supabase PostgreSQL

Este pacote já foi adaptado para usar PostgreSQL via TypeORM. O MongoDB fica apenas como **origem da migração** e deve permanecer intacto até a validação final.

## O que foi alterado

- `DatabaseModule` usa `DATABASE_URL` e driver `postgres`.
- Entidades Mongo (`ObjectIdColumn`) foram convertidas para PostgreSQL.
- `establishment` e `motoboy` continuam como snapshots JSONB para preservar o contrato atual do frontend/iFood.
- Foram adicionadas colunas indexáveis em `delivery_entity`: `establishmentId`, `establishmentCityId` e `motoboyId`.
- Uma camada de compatibilidade traduz os filtros Mongo usados pelo sistema (`$in`, `$nin`, `$or`, `$and`, `$gte`, `$lte`, `$exists`, `$elemMatch`, `$inc`, `$set`) para SQL parametrizado.
- Índices PostgreSQL foram criados para os filtros mais usados pelo Rappidex e pela integração iFood.
- Novas entregas não duplicam senha, token JWT ou credenciais iFood dentro do snapshot do usuário.
- Logs novos e migrados usam um snapshot seguro do usuário, sem senha/token/credenciais.
- Scripts de migração e verificação foram adicionados.

## 1. Criar o projeto Supabase

Crie um projeto Pro e escolha **South America (São Paulo) — `sa-east-1`** quando essa região estiver disponível para o novo projeto.

No projeto, abra **Connect** e copie a string de conexão **Session pooler**. Para um backend persistente no Heroku/IPv4, use Session pooler (porta 5432), e não Transaction pooler (porta 6543).

Nunca coloque `DATABASE_URL` no frontend/Vercel. Ela pertence somente ao backend.

## 2. Instalar as dependências do backend

No PowerShell, entre na pasta do backend:

```powershell
cd rappidexexpress-back-teste
npm install
```

O `npm install` também gera/atualiza `package-lock.json`. O pacote entregue não inclui o lock antigo porque foi adicionada a dependência PostgreSQL `pg`; um lock antigo incompatível faria o deploy com `npm ci` falhar.

## 3. Configurar variáveis localmente para a migração

Use suas strings reais apenas no seu computador. Não envie essas credenciais em chat ou commit.

```powershell
$env:DATABASE_URL="postgresql://...SESSION-POOLER.../postgres?sslmode=require"
$env:DATABASE_SSL="true"
$env:MONGODB_URI="mongodb+srv://.../deliveryDB"
$env:MONGODB_DB_NAME="deliveryDB"
```

Se a senha do banco tiver caracteres reservados de URL (`@`, `#`, `?`, `&`, espaço etc.), use a URI copiada do painel e faça URL-encode da senha.

## 4. Fazer o dry-run primeiro

```powershell
npm run migrate:mongo-to-postgres
```

Esse comando:

- conecta no Mongo e no Supabase;
- identifica as collections existentes;
- mostra as quantidades;
- procura duplicidades que impediriam os índices PostgreSQL;
- **não grava nenhum dado**.

Se aparecer uma mensagem de migração bloqueada, não use `--apply` até corrigir a duplicidade indicada.

## 5. Executar a cópia real

```powershell
npm run migrate:mongo-to-postgres:apply
```

O comando cria o schema/índices e copia:

- cidades;
- usuários;
- entregas;
- logs;
- eventos iFood;
- vínculos iFood ↔ entrega;
- histórico de créditos iFood;
- histórico de fechamento financeiro.

A migração usa UPSERT e pode ser executada novamente para atualizar o PostgreSQL com os dados mais recentes do Mongo.

## 6. Verificar o PostgreSQL

```powershell
npm run db:verify
```

Compare os números exibidos com o resumo da migração. O verificador também procura usernames duplicados, entregas órfãs e inconsistências entre os IDs indexados e os snapshots JSONB.

## 7. Corte final com poucos segundos/minutos sem escrita

Faça uma primeira migração com o sistema funcionando. Quando estiver tudo conferido:

1. Verifique os dynos:
   ```powershell
   heroku ps --app rappidex
   ```
2. Pare temporariamente o `web` para não nascer entrega nova no Mongo durante a última cópia:
   ```powershell
   heroku ps:scale web=0 --app rappidex
   ```
3. Rode de novo:
   ```powershell
   npm run migrate:mongo-to-postgres:apply
   npm run db:verify
   ```
4. Configure o Supabase no Heroku:
   ```powershell
   heroku config:set DATABASE_URL="SUA_URI_SESSION_POOLER" DATABASE_SSL=true DATABASE_POOL_MAX=5 TYPEORM_SYNCHRONIZE=false --app rappidex
   ```
5. Faça o deploy deste pacote.
6. Reative o backend:
   ```powershell
   heroku ps:scale web=1 --app rappidex
   ```
7. Acompanhe:
   ```powershell
   heroku logs --tail --app rappidex
   ```

## 8. Testes obrigatórios antes de desligar o MongoDB

Valide no Rappidex:

- login de superadmin/admin/lojista/motoboy;
- listagem e alteração de usuários;
- cidades e valores;
- criação de entrega;
- motoboy aceitar entrega;
- mudanças de status até finalização;
- cancelamento;
- relatórios/fechamento;
- Socket.IO e notificações;
- créditos iFood;
- polling/webhook/importação iFood;
- sincronização de status iFood.

Mantenha o MongoDB Atlas disponível como rollback por alguns dias. Só cancele o M10 depois de validar o Supabase em produção.

## Variáveis PostgreSQL

```env
DATABASE_URL=postgresql://...session-pooler.../postgres?sslmode=require
DATABASE_SSL=true
DATABASE_POOL_MAX=5
TYPEORM_SYNCHRONIZE=false
TYPEORM_LOGGING=false
```

`DATABASE_POOL_MAX=5` foi escolhido para não abrir conexões demais no Supabase. Ajuste somente depois de observar a carga.

## Comandos úteis

```powershell
# Apenas garantir schema/índices
npm run db:schema

# Dry-run da migração
npm run migrate:mongo-to-postgres

# Migração real
npm run migrate:mongo-to-postgres:apply

# Conferência do destino
npm run db:verify

# Criar um admin novo no PostgreSQL (senha via variável, nunca hardcoded)
$env:ADMIN_PASSWORD="SENHA_FORTE"
npm run create:admin

# Listar lojistas no PostgreSQL
npm run list:shopkeepers
```

## Rollback

O script de migração não apaga nem altera o MongoDB. Se houver um problema no corte, mantenha o Atlas ativo e volte temporariamente para a release anterior do backend. Não delete o banco Mongo durante a primeira fase de produção no Supabase.

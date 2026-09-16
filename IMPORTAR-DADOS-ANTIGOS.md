# Importar dados antigos do MongoDB para o Supabase sem apagar o banco atual

Este projeto inclui um importador em modo **MERGE**. Ele foi feito para o cenário em que o Rappidex já está funcionando no Supabase/PostgreSQL e você quer trazer o histórico do MongoDB antigo **sem apagar nem sobrescrever os dados novos**.

## O que o importador preserva

- Não apaga nenhuma linha do Supabase.
- Não sobrescreve usuários, cidades, entregas ou vínculos que já existem no Supabase.
- Se uma cidade antiga tiver o mesmo nome + UF de uma cidade já criada no Supabase, reutiliza a cidade atual e remapeia o histórico para ela.
- Se um usuário antigo tiver o mesmo login de um usuário que já existe, preserva o usuário atual e remapeia o histórico para o ID atual.
- Ignora entregas antigas inválidas sem `id` ou sem estabelecimento válido.
- Campos de créditos iFood usam `BIGINT`, inclusive valores antigos grandes como `1000000000000000000`.

## Por padrão: histórico principal

O comando normal importa:

- cidades
- usuários / empresas / motoboys
- entregas
- vínculos de pedidos iFood
- histórico de créditos iFood
- acertos/relatórios financeiros

Os **logs antigos** e os **eventos brutos do iFood** ficam de fora por padrão porque são centenas de milhares de registros e não são necessários para o funcionamento normal do histórico.

Se quiser importar absolutamente tudo, existe um comando separado `:full`.

## 1. Configure as conexões no PowerShell

Use a Session Pooler do Supabase em `DATABASE_URL` e a URI antiga do MongoDB em `MONGODB_URI`.

```powershell
$env:DATABASE_URL='SUA_URI_SESSION_POOLER_DO_SUPABASE'
$env:DATABASE_SSL='true'
$env:DATABASE_POOL_MAX='5'

$env:MONGODB_URI='SUA_URI_ANTIGA_DO_MONGODB'
$env:MONGODB_DB_NAME='deliveryDB'
```

Não compartilhe essas URLs porque elas contêm senha.

## 2. Dry-run obrigatório

```powershell
npm run import:mongo-history
```

Esse comando consulta os dois bancos e mostra o planejamento do merge, mas **não grava nada no Supabase**.

Ele informa quantas cidades e usuários serão reaproveitados, quantos registros são candidatos à importação e quantos registros inválidos serão ignorados.

## 3. Importar o histórico principal

Depois de conferir o dry-run:

```powershell
npm run import:mongo-history:apply
```

Pode rodar o comando novamente se ele for interrompido. A importação é idempotente: registros já existentes são preservados por `ON CONFLICT DO NOTHING`.

## 4. Verificar o PostgreSQL

```powershell
npm run db:verify
```

Confira especialmente:

- usuários duplicados = 0
- entregas sem estabelecimento correspondente = 0
- divergência de `establishmentId` = 0

## 5. Importar também logs e eventos brutos do iFood (opcional)

Primeiro faça o dry-run completo:

```powershell
npm run import:mongo-history:full
```

Depois, se realmente quiser esses dados:

```powershell
npm run import:mongo-history:apply:full
```

Esse modo pode adicionar centenas de milhares de linhas e consumir bastante armazenamento. No Supabase Free, prefira testar primeiro apenas o histórico principal.

## Importante

- Não rode mais `migrate:mongo-to-postgres:apply` para este cenário de banco já em uso. Use `import:mongo-history:apply`.
- Não precisa apagar o Supabase antes da importação.
- Mantenha o MongoDB antigo ativo até concluir `db:verify` e validar o Rappidex.
- Desative o polling iFood no ambiente de teste durante uma importação grande se quiser evitar concorrência desnecessária.


## Compatibilidade de créditos iFood muito altos
Os contadores e históricos de créditos iFood usam `numeric(30,0)` no PostgreSQL para preservar valores legados acima do limite de `bigint` (por exemplo, saldos sentinela muito altos).
## Valores históricos muito grandes

Esta versão aceita contadores históricos em formato decimal ou notação científica (por exemplo `1e+24`). Os campos de créditos/contadores iFood usam `numeric` no PostgreSQL, evitando o limite de `bigint`.


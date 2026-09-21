# Importar dados antigos do MongoDB para o Supabase sem apagar o banco atual

Este projeto inclui um importador em modo **MERGE**. Ele foi feito para o cenário em que o Rappidex já está funcionando no Supabase/PostgreSQL e você quer trazer o histórico do MongoDB antigo **sem apagar nem sobrescrever os dados novos**.


### Ajustes da v4

Esta versão foi reforçada para bases antigas do Rappidex: prefere os IDs lógicos usados pelo sistema, mantém `_id` do Mongo como alias de compatibilidade e evita descartar histórico apenas porque a empresa/motoboy antigo já foi removido do cadastro atual.

## O que o importador preserva

- Não apaga nenhuma linha do Supabase.
- Não sobrescreve usuários, cidades, entregas ou vínculos que já existem no Supabase.
- Se uma cidade antiga tiver o mesmo nome + UF de uma cidade já criada no Supabase, reutiliza a cidade atual e remapeia o histórico para ela.
- Se um usuário antigo tiver o mesmo login de um usuário que já existe, preserva o usuário atual e remapeia o histórico para o ID atual.
- Preserva entregas de estabelecimentos e motoboys antigos mesmo quando o usuário correspondente já não existe em `user_entity`; o snapshot histórico da própria entrega é mantido.
- Se uma entrega antiga não tiver o `id` lógico, usa o `_id` do MongoDB como identificador de recuperação.
- Aceita `establishmentId` escalar de versões antigas quando o snapshot `establishment.id` estiver ausente.
- Só ignora uma entrega quando não existe nenhum identificador recuperável da entrega ou nenhum identificador recuperável do estabelecimento.
- Campos de créditos iFood usam `NUMERIC`, inclusive valores antigos grandes como `1000000000000000000`.

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

Ele informa quantas cidades e usuários serão reaproveitados, quantos registros são candidatos à importação e quantos registros realmente não possuem dados mínimos para recuperação. A seção `diagnostics` também mostra quantas referências legadas foram preservadas sem exigir que a empresa/motoboy antigo ainda exista como usuário ativo.

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

- usuários duplicados = 0;
- **entregas órfãs ativas/não finalizadas = 0**;
- divergência de `establishmentId` com o snapshot = 0;
- divergência de `motoboyId` com o snapshot = 0;
- vínculos iFood apontando para entrega inexistente = 0.

É normal existirem **referências históricas** para estabelecimentos ou motoboys que já foram excluídos da tabela de usuários. A v4 preserva essas referências porque elas fazem parte do histórico e não existe FK obrigando o usuário antigo a continuar cadastrado. O que não deve existir no corte final é entrega órfã ainda ativa/não finalizada.

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


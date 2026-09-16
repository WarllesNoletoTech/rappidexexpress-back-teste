import { randomUUID } from 'crypto';
import {
  Brackets,
  DeleteResult,
  EntityNotFoundError,
  ObjectLiteral,
  Repository,
} from 'typeorm';

/**
 * Camada de compatibilidade temporária para a migração MongoDB -> PostgreSQL.
 *
 * O Rappidex possuía filtros no formato do driver Mongo do TypeORM. Esta classe
 * traduz os operadores usados pelo projeto para SQL parametrizado, permitindo
 * migrar o banco sem reescrever toda a regra de negócio de uma só vez.
 */
export class PostgresCompatRepository<T extends ObjectLiteral> {
  private parameterIndex = 0;

  private readonly fieldAliases: Record<string, string> = {
    _id: 'id',
    'motoboy.id': 'motoboyId',
    'establishment.id': 'establishmentId',
    'establishment.cityId': 'establishmentCityId',
  };

  constructor(private readonly repository: Repository<T>) {}

  get metadata() {
    return this.repository.metadata;
  }

  private nextParam(prefix = 'p') {
    this.parameterIndex += 1;
    return `${prefix}_${this.parameterIndex}`;
  }

  private resetParams() {
    this.parameterIndex = 0;
  }

  private propertyName(field: string) {
    return this.fieldAliases[field] || field;
  }

  private columnReference(field: string, alias?: string) {
    const property = this.propertyName(field);
    const column =
      this.repository.metadata.findColumnWithPropertyName(property) ||
      this.repository.metadata.findColumnWithPropertyPath(property);

    if (!column) {
      throw new Error(
        `Campo não mapeado para PostgreSQL: ${this.repository.metadata.name}.${field}`,
      );
    }

    const escape = (value: string) =>
      this.repository.manager.connection.driver.escape(value);
    const columnName = escape(column.databaseName);

    return alias ? `${escape(alias)}.${columnName}` : columnName;
  }

  private isOperatorObject(value: unknown): value is Record<string, any> {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      Object.keys(value as Record<string, unknown>).some((key) =>
        key.startsWith('$'),
      )
    );
  }

  private jsonElemMatchSql(
    columnRef: string,
    condition: Record<string, any>,
    params: Record<string, any>,
  ) {
    const predicates: string[] = [];

    for (const [rawKey, rawValue] of Object.entries(condition || {})) {
      if (!/^[A-Za-z0-9_]+$/.test(rawKey)) {
        throw new Error(`Campo JSON inválido: ${rawKey}`);
      }

      const jsonValue = `elem->>'${rawKey}'`;

      if (this.isOperatorObject(rawValue)) {
        for (const [operator, operand] of Object.entries(rawValue)) {
          const param = this.nextParam('json');
          switch (operator) {
            case '$ne':
              params[param] = String(operand);
              predicates.push(
                `(${jsonValue} IS NULL OR ${jsonValue} <> :${param})`,
              );
              break;
            case '$in': {
              const values = Array.isArray(operand) ? operand.map(String) : [];
              if (!values.length) {
                predicates.push('1 = 0');
              } else {
                params[param] = values;
                predicates.push(`${jsonValue} IN (:...${param})`);
              }
              break;
            }
            default:
              throw new Error(`Operador JSON não suportado: ${operator}`);
          }
        }
      } else {
        const param = this.nextParam('json');
        params[param] = String(rawValue);
        predicates.push(`${jsonValue} = :${param}`);
      }
    }

    if (!predicates.length) {
      return '1 = 1';
    }

    return `EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(${columnRef}, '[]'::jsonb)) AS elem WHERE ${predicates.join(
      ' AND ',
    )})`;
  }

  private fieldConditionSql(
    field: string,
    value: any,
    params: Record<string, any>,
    alias?: string,
  ): string {
    const column = this.columnReference(field, alias);

    if (value === null || value === undefined) {
      return `${column} IS NULL`;
    }

    if (!this.isOperatorObject(value)) {
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        const param = this.nextParam('json');
        params[param] = JSON.stringify(value);
        return `${column} @> CAST(:${param} AS jsonb)`;
      }

      const param = this.nextParam();
      params[param] = value;
      return `${column} = :${param}`;
    }

    const conditions: string[] = [];

    for (const [operator, operand] of Object.entries(value)) {
      const param = this.nextParam();

      switch (operator) {
        case '$in': {
          const values = Array.isArray(operand) ? operand : [];
          if (!values.length) {
            conditions.push('1 = 0');
          } else {
            params[param] = values;
            conditions.push(`${column} IN (:...${param})`);
          }
          break;
        }
        case '$nin': {
          const values = Array.isArray(operand) ? operand : [];
          if (!values.length) {
            conditions.push('1 = 1');
          } else {
            params[param] = values;
            conditions.push(`(${column} NOT IN (:...${param}) OR ${column} IS NULL)`);
          }
          break;
        }
        case '$ne':
          if (operand === null) {
            conditions.push(`${column} IS NOT NULL`);
          } else {
            params[param] = operand;
            conditions.push(`(${column} <> :${param} OR ${column} IS NULL)`);
          }
          break;
        case '$gte':
          params[param] = operand;
          conditions.push(`${column} >= :${param}`);
          break;
        case '$lte':
          params[param] = operand;
          conditions.push(`${column} <= :${param}`);
          break;
        case '$gt':
          params[param] = operand;
          conditions.push(`${column} > :${param}`);
          break;
        case '$lt':
          params[param] = operand;
          conditions.push(`${column} < :${param}`);
          break;
        case '$exists':
          conditions.push(
            operand ? `${column} IS NOT NULL` : `${column} IS NULL`,
          );
          break;
        case '$elemMatch':
          conditions.push(
            this.jsonElemMatchSql(
              column,
              (operand || {}) as Record<string, any>,
              params,
            ),
          );
          break;
        default:
          throw new Error(
            `Operador Mongo não suportado na compatibilidade PostgreSQL: ${operator}`,
          );
      }
    }

    return conditions.length ? conditions.join(' AND ') : '1 = 1';
  }

  private buildWhereSql(
    where: Record<string, any> | undefined,
    params: Record<string, any>,
    alias?: string,
  ): string {
    if (!where || !Object.keys(where).length) {
      return '1 = 1';
    }

    const andConditions: string[] = [];

    for (const [key, value] of Object.entries(where)) {
      if (key === '$or') {
        const branches = Array.isArray(value) ? value : [];
        const branchSql = branches.map(
          (branch) => `(${this.buildWhereSql(branch, params, alias)})`,
        );
        andConditions.push(branchSql.length ? `(${branchSql.join(' OR ')})` : '1 = 0');
        continue;
      }

      if (key === '$and') {
        const branches = Array.isArray(value) ? value : [];
        const branchSql = branches.map(
          (branch) => `(${this.buildWhereSql(branch, params, alias)})`,
        );
        andConditions.push(branchSql.length ? `(${branchSql.join(' AND ')})` : '1 = 1');
        continue;
      }

      andConditions.push(this.fieldConditionSql(key, value, params, alias));
    }

    return andConditions.length ? andConditions.join(' AND ') : '1 = 1';
  }

  private applySelect(qb: any, select?: Record<string, boolean>) {
    if (!select || typeof select !== 'object') return;

    const fields = Object.entries(select)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([field]) => `e.${this.propertyName(field)}`);

    if (fields.length) {
      qb.select(fields);
    }
  }

  private applyOrder(qb: any, order?: Record<string, any>) {
    if (!order || typeof order !== 'object') return;

    let first = true;
    for (const [field, direction] of Object.entries(order)) {
      const property = this.propertyName(field);
      const column = this.repository.metadata.findColumnWithPropertyName(property);
      if (!column) continue;
      const dir = String(direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const ref = `e.${property}`;
      if (first) {
        qb.orderBy(ref, dir);
        first = false;
      } else {
        qb.addOrderBy(ref, dir);
      }
    }
  }

  private normalizeFindOptions(options: any = {}) {
    const value = options || {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { where: value };
    }

    const optionKeys = new Set([
      'where',
      'skip',
      'take',
      'order',
      'select',
      'relations',
      'cache',
      'withDeleted',
      'loadRelationIds',
    ]);

    const isFindOptions = Object.keys(value).some((key) => optionKeys.has(key));
    return isFindOptions ? value : { where: value };
  }

  async find(options: any = {}): Promise<T[]> {
    this.resetParams();
    const normalized = this.normalizeFindOptions(options);

    const qb = this.repository.createQueryBuilder('e');
    const params: Record<string, any> = {};
    const sql = this.buildWhereSql(normalized.where, params, 'e');
    qb.where(new Brackets((inner) => inner.where(sql, params)));

    this.applySelect(qb, normalized.select);
    this.applyOrder(qb, normalized.order);

    if (Number.isFinite(Number(normalized.skip))) {
      qb.skip(Number(normalized.skip));
    }
    if (Number.isFinite(Number(normalized.take))) {
      qb.take(Number(normalized.take));
    }

    return qb.getMany();
  }

  async count(optionsOrWhere: any = {}): Promise<number> {
    this.resetParams();
    const where =
      optionsOrWhere && Object.prototype.hasOwnProperty.call(optionsOrWhere, 'where')
        ? optionsOrWhere.where
        : optionsOrWhere;
    const qb = this.repository.createQueryBuilder('e');
    const params: Record<string, any> = {};
    const sql = this.buildWhereSql(where, params, 'e');
    qb.where(sql, params);
    return qb.getCount();
  }

  async findOne(options: any): Promise<T | null> {
    const rows = await this.find({ ...(options || {}), take: 1 });
    return rows[0] || null;
  }

  async findOneBy(where: any): Promise<T | null> {
    return this.findOne({ where });
  }

  async findOneByOrFail(where: any): Promise<T> {
    const entity = await this.findOneBy(where);
    if (!entity) {
      throw new EntityNotFoundError(this.repository.metadata.target, where);
    }
    return entity;
  }

  async findOneOrFail(options: any): Promise<T> {
    const entity = await this.findOne(options);
    if (!entity) {
      throw new EntityNotFoundError(
        this.repository.metadata.target,
        options?.where || options,
      );
    }
    return entity;
  }

  private ensureManualPrimaryKey(entity: any) {
    const primary = this.repository.metadata.primaryColumns[0];
    if (
      primary &&
      !primary.isGenerated &&
      primary.propertyName === 'id' &&
      !entity?.id
    ) {
      entity.id = randomUUID();
    }
    return entity;
  }

  async save(entity: any): Promise<any> {
    return this.repository.save(this.ensureManualPrimaryKey(entity));
  }

  async insert(entity: any): Promise<any> {
    return this.repository.insert(this.ensureManualPrimaryKey(entity));
  }

  async delete(criteria: any): Promise<DeleteResult> {
    if (
      typeof criteria === 'string' ||
      typeof criteria === 'number' ||
      Array.isArray(criteria)
    ) {
      return this.repository.delete(criteria as any);
    }

    this.resetParams();
    const params: Record<string, any> = {};
    const whereSql = this.buildWhereSql(criteria, params);
    return this.repository
      .createQueryBuilder()
      .delete()
      .from(this.repository.metadata.target)
      .where(whereSql, params)
      .execute();
  }

  async deleteOne(filter: any) {
    const result = await this.delete(filter);
    return { deletedCount: result.affected || 0 };
  }

  private buildUpdateSet(update: any) {
    const setValues: Record<string, any> = {};

    for (const [field, value] of Object.entries(update?.$set || {})) {
      const property = this.propertyName(field);
      if (!this.repository.metadata.findColumnWithPropertyName(property)) {
        throw new Error(`Campo de update não mapeado: ${field}`);
      }
      setValues[property] = value;
    }

    for (const [field, rawDelta] of Object.entries(update?.$inc || {})) {
      const property = this.propertyName(field);
      const column = this.repository.metadata.findColumnWithPropertyName(property);
      if (!column) {
        throw new Error(`Campo de incremento não mapeado: ${field}`);
      }
      const delta = Number(rawDelta);
      if (!Number.isFinite(delta)) {
        throw new Error(`Incremento inválido para ${field}`);
      }
      const escaped = this.repository.manager.connection.driver.escape(
        column.databaseName,
      );
      setValues[property] = () => `${escaped} + (${delta})`;
    }

    return setValues;
  }

  async updateOne(filter: any, update: any) {
    this.resetParams();
    const params: Record<string, any> = {};
    const whereSql = this.buildWhereSql(filter, params);
    const result = await this.repository
      .createQueryBuilder()
      .update(this.repository.metadata.target)
      .set(this.buildUpdateSet(update) as any)
      .where(whereSql, params)
      .execute();

    return {
      matchedCount: result.affected || 0,
      modifiedCount: result.affected || 0,
    };
  }

  async findOneAndUpdate(filter: any, update: any, _options?: any) {
    this.resetParams();
    const params: Record<string, any> = {};
    const whereSql = this.buildWhereSql(filter, params);
    const result = await this.repository
      .createQueryBuilder()
      .update(this.repository.metadata.target)
      .set(this.buildUpdateSet(update) as any)
      .where(whereSql, params)
      .returning('*')
      .execute();

    return { value: result.raw?.[0] || null };
  }

  /**
   * Os índices PostgreSQL são criados pelo schema SQL/TypeORM. O método existe
   * apenas para manter compatibilidade com serviços antigos durante a migração.
   */
  async createCollectionIndex(_keys: any, options?: any) {
    return options?.name || 'postgres-index-managed-by-schema';
  }
}

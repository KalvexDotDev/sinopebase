/**
 * Runner — internal `parseAndRun` logic for RecordFieldResolver.
 *
 * Port of PocketBase core/record_field_resolver_runner.go (MIT license).
 * Layer 2 — imports from ~/tools/* and ~/core/*.
 *
 * Handles:
 *   - @collection.* field resolution
 *   - @request.auth.* field resolution (plain fields, auth collection rels)
 *   - @request.body.* field resolution (plain, relation, modifiers)
 *   - Regular fields with relation traversal
 *   - Back relations (via `_via_` naming convention)
 *   - Multi-match subqueries
 *   - Filter modifiers (:each, :length, :lower, :changed)
 */

import type { ResolverResult } from '~/tools/search/simple_field_resolver';
import type { MultiMatchSubQuery } from '~/tools/search/multi_match_subquery';
import { MultiMatchSubQuery as MultiMatchSubQueryClass } from '~/tools/search/multi_match_subquery';
import { Columnify } from '~/tools/inflector/inflector';
import { jsonEach, jsonArrayLength, jsonExtract } from '~/tools/dbutils/json';
import { ToUniqueStringSlice, ToInterfaceSlice } from '~/tools/list/list';
import { findSingleColumnUniqueIndex } from '~/tools/dbutils/index';
import {
  RecordFieldResolver,
  FieldNameId,
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNameVerified,
  splitModifier,
  toSlice,
  EachModifier,
  LengthModifier,
  LowerModifier,
  ChangedModifier,
  IssetModifier,
} from './record_field_resolver';
import type {
  CollectionStub,
  FieldStub,
  MultiValuer,
} from './record_field_resolver';
import { ReplaceWithExpression } from './record_field_resolver_replace_expr';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed nested relation depth. */
const maxNestedRels = 6;

/**
 * Auth filter fields that can be resolved without joining the auth collection.
 */
const plainRequestAuthFields = new Set<string>([
  '@request.auth.' + FieldNameId,
  '@request.auth.' + FieldNameEmailVisibility,
  '@request.auth.' + FieldNameEmail,
  '@request.auth.' + FieldNameVerified,
]);

// ---------------------------------------------------------------------------
// viaRegex — matches "someCollection_via_relFieldName"
// ---------------------------------------------------------------------------

const viaRegex = /^(\w+)_via_(\w+)$/;

// ---------------------------------------------------------------------------
// parseAndRun — entry point
// ---------------------------------------------------------------------------

/**
 * Entry point for RecordFieldResolver.Resolve().
 *
 * Creates a new Runner and executes it for the given fieldName.
 */
export function parseAndRun(
  fieldName: string,
  resolver: RecordFieldResolver,
): ResolverResult | Error {
  const r = new Runner(fieldName, resolver);
  return r.run();
}

// ---------------------------------------------------------------------------
// Runner class
// ---------------------------------------------------------------------------

/**
 * Runner performs a single field resolution.
 *
 * Each Runner can be used once (enforced by `used` flag).
 */
class Runner {
  protected used = false;
  protected resolver: RecordFieldResolver;
  protected fieldName: string;

  // Shared processing state
  protected activeProps: string[] = [];
  protected activeCollectionName = '';
  protected activeTableAlias = '';
  protected nullifyMissingField = false;
  protected withMultiMatch = false;
  protected multiMatchActiveTableAlias = '';
  protected multiMatch: MultiMatchSubQuery;

  constructor(fieldName: string, resolver: RecordFieldResolver) {
    this.fieldName = fieldName;
    this.resolver = resolver;
    this.multiMatch = new MultiMatchSubQueryClass({});
  }

  /**
   * Runs the field resolution.
   */
  run(): ResolverResult | Error {
    if (this.used) {
      return new Error('the runner was already used');
    }

    // Check allowed fields
    if (
      this.resolver.allowedFields().length > 0 &&
      !this.fieldMatchesAllowed(this.fieldName)
    ) {
      return new Error(`failed to resolve field "${this.fieldName}"`);
    }

    this.used = true;

    this.prepare();

    // @collection.* field (non-relational join)
    if (this.activeProps[0] === '@collection') {
      return this.processCollectionField();
    }

    // @request.* fields
    if (this.activeProps[0] === '@request') {
      if (!this.resolver['requestInfo']) {
        return { identifier: 'NULL' };
      }

      if (this.fieldName.startsWith('@request.auth.')) {
        return this.processRequestAuthField();
      }

      if (
        this.fieldName.startsWith('@request.body.') &&
        this.activeProps.length > 2
      ) {
        let name: string;
        let modifier: string;
        try {
          const r = splitModifier(this.activeProps[2]!);
          name = r[0];
          modifier = r[1];
        } catch {
          name = this.activeProps[2]!;
          modifier = '';
        }

        const bodyField = this.resolver['baseCollection'].fields.getByName(name);

        if (bodyField) {
          // Check for body relation field
          if (
            bodyField.type === 'relation' &&
            this.activeProps.length > 3
          ) {
            return this.processRequestBodyRelationField(bodyField);
          }

          // Check modifiers on last prop (totalProps === 3)
          if (this.activeProps.length === 3) {
            switch (modifier) {
              case EachModifier:
                return this.processRequestBodyEachModifier(bodyField);
              case LengthModifier:
                return this.processRequestBodyLengthModifier(bodyField);
              case LowerModifier:
                return this.processRequestBodyLowerModifier(bodyField);
              case ChangedModifier:
                return this.processRequestBodyChangedModifier(bodyField);
            }
          }
        }
      }

      // Other @request.* static field
      return this.resolver.resolveStaticRequestField(...this.activeProps.slice(1));
    }

    // Regular field
    return this.processActiveProps();
  }

  /**
   * Checks if fieldName matches any allowed field pattern (regex or exact).
   */
  protected fieldMatchesAllowed(fieldName: string): boolean {
    for (const pattern of this.resolver.allowedFields()) {
      if (pattern.startsWith('^') && pattern.endsWith('$')) {
        try {
          const re = new RegExp(pattern);
          if (re.test(fieldName)) return true;
        } catch {
          // Invalid regex — skip
        }
      } else if (fieldName === pattern) {
        return true;
      }
    }
    return false;
  }

  /**
   * Initializes shared processing state.
   */
  protected prepare(): void {
    this.activeProps = this.fieldName.split('.');

    this.activeCollectionName = this.resolver['baseCollection'].name;
    this.activeTableAlias = this.resolver.baseCollectionAlias ||
      Columnify(this.activeCollectionName);

    // Enable nullifyMissingField for @request.* fields
    this.nullifyMissingField = this.activeProps[0] === '@request';

    // Prepare multi-match subquery
    this.multiMatch = new MultiMatchSubQueryClass({
      targetTableAlias: this.activeTableAlias,
      fromTableName: Columnify(this.activeCollectionName),
      fromTableAlias: '__mm_' + this.activeTableAlias,
    });
    this.multiMatchActiveTableAlias = this.multiMatch.fromTableAlias;
    this.withMultiMatch = false;
  }

  /**
   * Processes @collection.COLLECTION_NAME.FIELD[.FIELD2...] expressions.
   */
  protected processCollectionField(): ResolverResult | Error {
    if (this.activeProps.length < 3) {
      return new Error(`invalid @collection field path in "${this.fieldName}"`);
    }

    // Name or name:alias
    const collectionParts = this.activeProps[1]!.split(':');
    let collection: CollectionStub;

    try {
      collection = this.resolver.loadCollection(collectionParts[0]!);
    } catch (err) {
      return new Error(
        `failed to load collection "${this.activeProps[1]}" from field path "${this.fieldName}"`,
      );
    }

    this.activeCollectionName = collection.name;

    if (collectionParts.length === 2 && collectionParts[1] !== '') {
      this.activeTableAlias =
        Columnify('__collection_alias_' + collectionParts[1]) +
        this.resolver.joinAliasSuffix;
    } else {
      this.activeTableAlias =
        Columnify('__collection_' + this.activeCollectionName) +
        this.resolver.joinAliasSuffix;
    }

    this.withMultiMatch = true;

    // Join the collection to the main query
    this.resolver.registerJoin(
      Columnify(collection.name),
      this.activeTableAlias,
      '',
    );

    // Join to multi-match subquery
    this.multiMatchActiveTableAlias = '__mm_' + this.activeTableAlias;
    this.multiMatch.joins.push({
      tableName: Columnify(collection.name),
      tableAlias: this.multiMatchActiveTableAlias,
      on: '',
    });

    // Leave only collection fields
    // @collection.someCollection.fieldA.fieldB → fieldA.fieldB
    this.activeProps = this.activeProps.slice(2);

    return this.processActiveProps();
  }

  /**
   * Processes @request.auth.* fields.
   */
  protected processRequestAuthField(): ResolverResult | Error {
    const ri = this.resolver['requestInfo'];

    if (!ri || !ri.auth || !ri.auth.collection()) {
      return { identifier: 'NULL' };
    }

    // Plain auth field (no join needed)
    if (plainRequestAuthFields.has(this.fieldName)) {
      return this.resolver.resolveStaticRequestField(
        ...this.activeProps.slice(1),
      );
    }

    // Resolve auth collection field (requires join)
    const collection = ri.auth.collection();

    this.activeCollectionName = collection.name;
    this.activeTableAlias =
      '__auth_' +
      Columnify(this.activeCollectionName) +
      this.resolver.joinAliasSuffix;

    // Join the auth collection to the main query
    this.resolver.registerJoin(
      Columnify(this.activeCollectionName),
      this.activeTableAlias,
      `${this.activeTableAlias}.id = ${this.resolveParamPlaceholder(ri.auth.id)}`,
    );

    // Join the auth collection to the multi-match subquery
    this.multiMatchActiveTableAlias = '__mm_' + this.activeTableAlias;
    this.multiMatch.joins.push({
      tableName: Columnify(this.activeCollectionName),
      tableAlias: this.multiMatchActiveTableAlias,
      on: `${this.multiMatchActiveTableAlias}.id = ${this.resolveParamPlaceholder(ri.auth.id)}`,
    });

    // Leave only auth relation fields
    // @request.auth.fieldA.fieldB → fieldA.fieldB
    this.activeProps = this.activeProps.slice(2);

    return this.processActiveProps();
  }

  /**
   * Processes @request.body.REL_FIELD.* relation fields.
   */
  protected processRequestBodyRelationField(
    bodyField: FieldStub,
  ): ResolverResult | Error {
    const ri = this.resolver['requestInfo'];

    // We need the raw relation field from the collection schema
    const relFieldConfig = this.resolver['baseCollection'].fields.getByName(
      bodyField.name,
    );
    if (!relFieldConfig) {
      return new Error(
        `failed to initialize data relation field "${bodyField.getName()}"`,
      );
    }

    let relCollection: CollectionStub;
    try {
      // Look up the related collection id from the field config
      const collId =
        (relFieldConfig as unknown as Record<string, unknown>)['collectionId'] ||
        '';
      relCollection = this.resolver.loadCollection(collId);
    } catch (err) {
      return new Error(
        `failed to load collection from data field "${bodyField.getName()}"`,
      );
    }

    let dataRelIds: string[] = [];
    if (ri && ri.body) {
      dataRelIds = ToUniqueStringSlice(ri.body[bodyField.getName()]);
    }

    if (dataRelIds.length === 0) {
      return { identifier: 'NULL' };
    }

    this.activeCollectionName = relCollection.name;
    this.activeTableAlias =
      Columnify(`__data_${relCollection.name}_${bodyField.getName()}`) +
      this.resolver.joinAliasSuffix;

    // Join the data rel collection to the main collection
    this.resolver.registerJoin(
      this.activeCollectionName,
      this.activeTableAlias,
      `${this.activeTableAlias}.id IN (${dataRelIds.map((id) => `'${id}'`).join(',')})`,
    );

    const isMultiple = (
      relFieldConfig as unknown as Record<string, unknown>
    )['isMultiple'] as boolean;
    if (isMultiple) {
      this.withMultiMatch = true;
    }

    // Join to multi-match subquery
    this.multiMatchActiveTableAlias = '__mm_' + this.activeTableAlias;
    this.multiMatch.joins.push({
      tableName: this.activeCollectionName,
      tableAlias: this.multiMatchActiveTableAlias,
      on: `${this.multiMatchActiveTableAlias}.id IN (${dataRelIds.map((id) => `'${id}'`).join(',')})`,
    });

    // Leave only data relation fields
    // @request.body.someRel.fieldA.fieldB → fieldA.fieldB
    this.activeProps = this.activeProps.slice(3);

    return this.processActiveProps();
  }

  /**
   * Processes @request.body.FIELD:changed modifier.
   */
  protected processRequestBodyChangedModifier(
    bodyField: FieldStub,
  ): ResolverResult | Error {
    const name = bodyField.getName();

    // Build a sub-expression that checks: isset && != original
    const subFilter = `@request.body.${name}:isset = true && @request.body.${name} != ${name}`;
    const aliasExpr = subFilter; // Simplified — in Go this uses FilterData.BuildExpr

    const placeholder = `@changed@${name}_${Math.random().toString(36).slice(2, 10)}`;

    return {
      identifier: placeholder,
      nullFallback: 1, // NullFallbackPreference.Disabled
      params: {},
      afterBuild: (sql: string) => {
        // In the Go version, this uses replaceWithExpression.
        // For our TS port, we do the replacement at the string level.
        const expr = new ReplaceWithExpression(placeholder, sql, aliasExpr);
        return expr.build();
      },
    };
  }

  /**
   * Processes @request.body.FIELD:lower modifier.
   */
  protected processRequestBodyLowerModifier(
    bodyField: FieldStub,
  ): ResolverResult | Error {
    const ri = this.resolver['requestInfo'];
    const rawValue = ri?.body?.[bodyField.getName()] ?? '';
    const strValue = String(rawValue);

    const placeholder =
      'infoLower' + bodyField.getName() + Math.random().toString(36).slice(2, 10);

    return {
      identifier: `LOWER({:${placeholder}})`,
      params: { [placeholder]: strValue },
    };
  }

  /**
   * Processes @request.body.FIELD:length modifier.
   */
  protected processRequestBodyLengthModifier(
    bodyField: FieldStub,
  ): ResolverResult | Error {
    const ri = this.resolver['requestInfo'];
    const bodyItems = toSlice(ri?.body?.[bodyField.getName()]);

    return {
      identifier: String(bodyItems.length),
    };
  }

  /**
   * Processes @request.body.FIELD:each modifier.
   */
  protected processRequestBodyEachModifier(
    bodyField: FieldStub,
  ): ResolverResult | Error {
    const ri = this.resolver['requestInfo'];
    const bodyItems = toSlice(ri?.body?.[bodyField.getName()]);

    const bodyItemsRaw = JSON.stringify(bodyItems);
    const placeholder =
      'dataEach' + Math.random().toString(36).slice(2, 12);
    const cleanFieldName = Columnify(bodyField.getName());
    const jeTable = `jsonb_array_elements({:${placeholder}})`;
    const jeAlias =
      '__dataEach_je_' +
      cleanFieldName +
      this.resolver.joinAliasSuffix;

    this.resolver.registerJoin(jeTable, jeAlias, '');

    // Check if multi-value field
    const isMultivaluer = (
      bodyField as unknown as MultiValuer
    ).isMultiple?.() ?? false;

    if (isMultivaluer) {
      this.withMultiMatch = true;
    }

    const result: ResolverResult = {
      identifier: `${jeAlias}.value`,
      params: { [placeholder]: bodyItemsRaw },
    };

    if (this.withMultiMatch) {
      const mmPlaceholder = 'mm' + placeholder;
      const jeTable2 = `jsonb_array_elements({:${mmPlaceholder}})`;
      const jeAlias2 = '__mm_' + jeAlias;

      this.multiMatch.joins.push({
        tableName: jeTable2,
        tableAlias: jeAlias2,
        on: '',
      });
      this.multiMatch.params[mmPlaceholder] = bodyItemsRaw;
      this.multiMatchValueIdentifier = `${jeAlias2}.value`;

      result.multiMatchSubQuery = this.multiMatch;
    }

    return result;
  }

  // --- multi-match value identifier helper ---
  protected multiMatchValueIdentifier = '';

  /**
   * Processes the active property chain (regular fields, relations, back-relations).
   */
  protected processActiveProps(): ResolverResult | Error {
    const totalProps = this.activeProps.length;

    for (let i = 0; i < totalProps; i++) {
      const prop = this.activeProps[i]!;

      let collection: CollectionStub;
      try {
        collection = this.resolver.loadCollection(this.activeCollectionName);
      } catch (err) {
        return new Error(`failed to resolve field "${prop}"`);
      }

      // Last property — finalize
      if (i === totalProps - 1) {
        return this.finalizeActivePropsProcessing(collection, prop, i);
      }

      const field = collection.fields.getByName(prop);

      // Hidden field check
      if (field && field.getHidden && field.getHidden() && !this.resolver.getAllowHiddenFields()) {
        return new Error(`non-filterable field "${prop}"`);
      }

      // JSON or geoPoint field — treat remaining props as JSON path
      if (
        field &&
        (field.type === 'json' || field.type === 'geoPoint')
      ) {
        const remaining = this.activeProps.slice(i + 1);
        const jsonPath = remaining
          .map((p) => {
            if (/^\d+$/.test(p)) {
              return `[${Columnify(p)}]`;
            }
            return Columnify(p);
          })
          .join('.');

        const result: ResolverResult = {
          nullFallback: 1, // NullFallbackPreference.Disabled
          identifier: jsonExtract(
            `${this.activeTableAlias}.${Columnify(prop)}`,
            jsonPath,
          ),
        };

        if (this.withMultiMatch) {
          this.multiMatch.valueIdentifier = jsonExtract(
            `${this.multiMatchActiveTableAlias}.${Columnify(prop)}`,
            jsonPath,
          );
          result.multiMatchSubQuery = this.multiMatch;
        }

        return result;
      }

      if (i >= maxNestedRels) {
        return new Error(
          `max nested relations reached for field "${prop}"`,
        );
      }

      // Check for back relation (e.g. yourCollection_via_yourRelField)
      if (!field) {
        const parts = viaRegex.exec(prop);

        if (!parts || parts.length !== 3) {
          if (this.nullifyMissingField) {
            return { identifier: 'NULL' };
          }
          return new Error(`failed to resolve field "${prop}"`);
        }

        const backCollectionName = parts[1]!;
        const backFieldName = parts[2]!;

        let backCollection: CollectionStub;
        try {
          backCollection = this.resolver.loadCollection(backCollectionName);
        } catch (err) {
          if (this.nullifyMissingField) {
            return { identifier: 'NULL' };
          }
          return new Error(
            `failed to load back relation field "${prop}" collection`,
          );
        }

        const backField = backCollection.fields.getByName(backFieldName);
        if (!backField) {
          if (this.nullifyMissingField) {
            return { identifier: 'NULL' };
          }
          return new Error(
            `missing back relation field "${backFieldName}"`,
          );
        }

        if (backField.type !== 'relation') {
          if (this.nullifyMissingField) {
            return { identifier: 'NULL' };
          }
          return new Error(
            `invalid back relation field "${backFieldName}"`,
          );
        }

        if (backField.getHidden && backField.getHidden() && !this.resolver.getAllowHiddenFields()) {
          return new Error(
            `non-filterable back relation field "${backField.getName()}"`,
          );
        }

        const cleanProp = Columnify(prop);
        const cleanBackFieldName = Columnify(backFieldName);
        const newTableAlias =
          this.activeTableAlias +
          '_' +
          cleanProp +
          this.resolver.joinAliasSuffix;
        const newCollectionName = Columnify(backCollection.name);

        // Check if back relation is multiple
        const isBackRelMultiple =
          (backField as unknown as MultiValuer).isMultiple?.() ?? false;

        if (!isBackRelMultiple) {
          this.resolver.registerJoin(
            newCollectionName,
            newTableAlias,
            `${newTableAlias}.${cleanBackFieldName} = ${this.activeTableAlias}.id`,
          );
        } else {
          const jeAlias = '__je_' + newTableAlias;
          const jsonEachExpr = jsonEach(
            `${newTableAlias}.${cleanBackFieldName}`,
          );
          this.resolver.registerJoin(jsonEachExpr, jeAlias, '');
          this.resolver.registerJoin(
            newCollectionName,
            newTableAlias,
            `${this.activeTableAlias}.id IN (SELECT ${jeAlias}.value FROM ${jsonEachExpr} ${jeAlias})`,
          );
        }

        this.activeCollectionName = backCollection.name;
        this.activeTableAlias = newTableAlias;

        // Multi-match subquery handling
        if (isBackRelMultiple) {
          this.withMultiMatch = true;
        } else if (!this.withMultiMatch) {
          // Check for single column unique index
          const { found: hasUniqueIndex } = findSingleColumnUniqueIndex(
            backCollection.indexes,
            backFieldName,
          );
          this.withMultiMatch = !hasUniqueIndex;
        }

        const newTableAlias2 =
          this.multiMatchActiveTableAlias +
          '_' +
          cleanProp;

        if (!isBackRelMultiple) {
          this.multiMatch.joins.push({
            tableName: newCollectionName,
            tableAlias: newTableAlias2,
            on: `${newTableAlias2}.${cleanBackFieldName} = ${this.multiMatchActiveTableAlias}.id`,
          });
        } else {
          const jeAlias2 = '__je_' + newTableAlias2;
          const jsonEachExpr2 = jsonEach(
            `${newTableAlias2}.${cleanBackFieldName}`,
          );
          this.multiMatch.joins.push({
            tableName: jsonEachExpr2,
            tableAlias: jeAlias2,
            on: '',
          });
          this.multiMatch.joins.push({
            tableName: newCollectionName,
            tableAlias: newTableAlias2,
            on: `${this.multiMatchActiveTableAlias}.id IN (SELECT ${jeAlias2}.value FROM ${jsonEachExpr2} ${jeAlias2})`,
          });
        }

        this.multiMatchActiveTableAlias = newTableAlias2;

        continue;
      }

      // Direct relation
      if (field.type !== 'relation') {
        return new Error(`field "${prop}" is not a valid relation`);
      }

      const relCollectionName = (field as unknown as Record<string, unknown>)[
        'collectionId'
      ] as string;
      let relCollection: CollectionStub;
      try {
        relCollection = this.resolver.loadCollection(relCollectionName);
      } catch (err) {
        return new Error(`failed to load field "${prop}" collection`);
      }

      const cleanFieldName = Columnify(field.getName());
      const prefixedFieldName =
        this.activeTableAlias + '.' + cleanFieldName;
      const newTableAlias =
        this.activeTableAlias +
        '_' +
        cleanFieldName +
        this.resolver.joinAliasSuffix;
      const newCollectionName = Columnify(relCollection.name);

      // "id" lookup optimization for single relations
      if (
        !(field as unknown as MultiValuer).isMultiple?.() &&
        i === totalProps - 2 &&
        this.activeProps[i + 1] === FieldNameId
      ) {
        return this.finalizeActivePropsProcessing(collection, field.getName(), i);
      }

      const isRelMultiple =
        (field as unknown as MultiValuer).isMultiple?.() ?? false;

      if (!isRelMultiple) {
        this.resolver.registerJoin(
          newCollectionName,
          newTableAlias,
          `${newTableAlias}.id = ${prefixedFieldName}`,
        );
      } else {
        const jeAlias = '__je_' + newTableAlias;
        const jsonEachExpr = jsonEach(prefixedFieldName);
        this.resolver.registerJoin(jsonEachExpr, jeAlias, '');
        this.resolver.registerJoin(
          newCollectionName,
          newTableAlias,
          `${newTableAlias}.id = ${jeAlias}.value`,
        );
      }

      this.activeCollectionName = relCollection.name;
      this.activeTableAlias = newTableAlias;

      // Multi-match subquery handling
      if (isRelMultiple) {
        this.withMultiMatch = true;
      }

      const newTableAlias2 =
        this.multiMatchActiveTableAlias + '_' + cleanFieldName;
      const prefixedFieldName2 =
        this.multiMatchActiveTableAlias + '.' + cleanFieldName;

      if (!isRelMultiple) {
        this.multiMatch.joins.push({
          tableName: newCollectionName,
          tableAlias: newTableAlias2,
          on: `${newTableAlias2}.id = ${prefixedFieldName2}`,
        });
      } else {
        const jeAlias2 =
          this.multiMatchActiveTableAlias +
          '_' +
          cleanFieldName +
          '_je';
        const jsonEachExpr2 = jsonEach(prefixedFieldName2);
        this.multiMatch.joins.push({
          tableName: jsonEachExpr2,
          tableAlias: jeAlias2,
          on: '',
        });
        this.multiMatch.joins.push({
          tableName: newCollectionName,
          tableAlias: newTableAlias2,
          on: `${newTableAlias2}.id = ${jeAlias2}.value`,
        });
      }

      this.multiMatchActiveTableAlias = newTableAlias2;
    }

    return new Error(`failed to resolve field "${this.fieldName}"`);
  }

  /**
   * Finalizes processing of the last property in the field chain.
   * Applies field modifiers and returns the ResolverResult.
   */
  protected finalizeActivePropsProcessing(
    collection: CollectionStub,
    prop: string,
    _propDepth: number,
  ): ResolverResult | Error {
    let name: string;
    let modifier: string;
    try {
      const r = splitModifier(prop);
      name = r[0];
      modifier = r[1];
    } catch (err) {
      return err as Error;
    }

    const field = collection.fields.getByName(name);
    if (!field) {
      if (this.nullifyMissingField) {
        return { identifier: 'NULL' };
      }
      return new Error(`unknown field "${name}"`);
    }

    if (field.getHidden && field.getHidden() && !this.resolver.getAllowHiddenFields()) {
      return new Error(`non-filterable field "${name}"`);
    }

    const cleanFieldName = Columnify(field.getName());
    const isMultivaluer = !!(
      field as unknown as MultiValuer
    ).isMultiple?.();

    // :length modifier for arrayable fields
    if (modifier === LengthModifier && isMultivaluer) {
      const jePair = `${this.activeTableAlias}.${cleanFieldName}`;
      const result: ResolverResult = {
        identifier: jsonArrayLength(jePair),
      };

      if (this.withMultiMatch) {
        const jePair2 =
          this.multiMatchActiveTableAlias + '.' + cleanFieldName;
        this.multiMatch.valueIdentifier = jsonArrayLength(jePair2);
        result.multiMatchSubQuery = this.multiMatch;
      }

      return result;
    }

    // :each modifier for arrayable fields
    if (modifier === EachModifier && isMultivaluer) {
      const jePair = `${this.activeTableAlias}.${cleanFieldName}`;
      const jeAlias =
        '__je_' +
        this.activeTableAlias +
        '_' +
        cleanFieldName +
        this.resolver.joinAliasSuffix;

      this.resolver.registerJoin(jsonEach(jePair), jeAlias, '');

      const result: ResolverResult = {
        identifier: `${jeAlias}.value`,
      };

      if (
        (field as unknown as MultiValuer).isMultiple?.()
      ) {
        this.withMultiMatch = true;
      }

      if (this.withMultiMatch) {
        const jePair2 =
          this.multiMatchActiveTableAlias + '.' + cleanFieldName;
        const jeAlias2 =
          '__je_' +
          this.multiMatchActiveTableAlias +
          '_' +
          cleanFieldName;

        this.multiMatch.joins.push({
          tableName: jsonEach(jePair2),
          tableAlias: jeAlias2,
          on: '',
        });
        this.multiMatch.valueIdentifier = `${jeAlias2}.value`;
        result.multiMatchSubQuery = this.multiMatch;
      }

      return result;
    }

    // Default identifier
    const result: ResolverResult = {
      identifier: `${this.activeTableAlias}.${cleanFieldName}`,
    };

    if (this.withMultiMatch) {
      this.multiMatch.valueIdentifier =
        `${this.multiMatchActiveTableAlias}.${cleanFieldName}`;
      result.multiMatchSubQuery = this.multiMatch;
    }

    // Email visibility check
    if (
      field.getName() === FieldNameEmail &&
      !this.resolver.getAllowHiddenFields() &&
      collection.isAuth?.()
    ) {
      const origAfterBuild = result.afterBuild;
      result.afterBuild = (sql: string) => {
        const emailVisCheck = `${this.activeTableAlias}.${FieldNameEmailVisibility} = TRUE`;
        const wrapped = `(${sql} AND ${emailVisCheck})`;
        return origAfterBuild ? origAfterBuild(wrapped) : wrapped;
      };
    }

    // JSON field wrapping
    if (field.type === 'json') {
      result.nullFallback = 1; // NullFallbackPreference.Disabled
      result.identifier = jsonExtract(
        `${this.activeTableAlias}.${cleanFieldName}`,
        '',
      );
      if (this.withMultiMatch) {
        this.multiMatch.valueIdentifier = jsonExtract(
          `${this.multiMatchActiveTableAlias}.${cleanFieldName}`,
          '',
        );
      }
    }

    // :lower modifier
    if (modifier === LowerModifier) {
      result.identifier = `LOWER(${result.identifier})`;
      if (this.withMultiMatch) {
        this.multiMatch.valueIdentifier = `LOWER(${this.multiMatch.valueIdentifier})`;
      }
    }

    return result;
  }

  /**
   * Creates a parameterized placeholder for a literal value.
   */
  protected resolveParamPlaceholder(value: string): string {
    const placeholder =
      'p' + Math.random().toString(36).slice(2, 12);
    return `{:${placeholder}}`;
  }
}

// Re-export for convenience
export { Runner };

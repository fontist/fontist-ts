import * as yaml from 'yaml';

export type ScalarType = 'string' | 'integer' | 'boolean' | 'float';

export interface AttributeOptions {
  /** The attribute holds a collection (rendered as YAML sequence). */
  collection?: boolean;
  /** Factory for the default value, evaluated lazily per instance. */
  default?: () => unknown;
  /** Nested model class (for single or collection attributes). */
  model?: new (data?: unknown) => SerializableModel;
  /** Render the attribute even when null/undefined (default: omitted). */
  renderNil?: boolean;
  /** Conditional omission hook, evaluated against the instance. */
  omitWhen?: (instance: object) => boolean;
}

export interface AttributeDef {
  name: string;
  scalar?: ScalarType;
  model?: AttributeOptions['model'];
  options: AttributeOptions;
}

export interface MappingOptions {
  /** YAML key (defaults to snake_case of the attribute name). */
  to?: string;
  /** The YAML mapping is keyed by name; the key is folded into this attribute. */
  childKeyTo?: string;
  /** Polymorphic models are tagged with this key (e.g. `type`). */
  polymorphicTag?: string;
  /** Tag value -> concrete class registry for polymorphic attributes. */
  polymorphicRegistry?: Record<string, new (data?: unknown) => SerializableModel>;
}

export interface MappingDef {
  attr: string;
  key: string;
  childKeyTo?: string;
  polymorphicTag?: string;
  polymorphicRegistry?: MappingOptions['polymorphicRegistry'];
}

const SCALARS: readonly ScalarType[] = ['string', 'integer', 'boolean', 'float'];

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Declarative schema of a model: attributes plus YAML key-value mappings. */
export class ModelDefinition {
  readonly attributes = new Map<string, AttributeDef>();
  readonly mappings = new Map<string, MappingDef>();

  attribute(name: string, type: ScalarType | (new (data?: unknown) => SerializableModel), options: AttributeOptions = {}): this {
    if (typeof type === 'string') {
      if (!SCALARS.includes(type)) {
        throw new Error(`Unknown scalar type: ${type}`);
      }
      this.attributes.set(name, { name, scalar: type, options });
    } else {
      this.attributes.set(name, { name, model: type, options });
    }
    return this;
  }

  /** Declares a YAML mapping for an attribute. Called once per mapped attribute. */
  mapping(attr: string, options: MappingOptions = {}): this {
    const def = this.attributes.get(attr);
    if (!def) {
      throw new Error(`Cannot map unknown attribute: ${attr}`);
    }
    this.mappings.set(attr, {
      attr,
      key: options.to ?? snakeCase(attr),
      childKeyTo: options.childKeyTo,
      polymorphicTag: options.polymorphicTag,
      polymorphicRegistry: options.polymorphicRegistry,
    });
    return this;
  }
}

type ModelConstructor = new (data?: unknown) => SerializableModel;

const definitions = new WeakMap<object, ModelDefinition>();

export abstract class SerializableModel {
  /**
   * Declares attributes and mappings. Called once per concrete class.
   * Every serialized model must define its schema here — instances never
   * hand-implement serialization.
   */
  static define(_definition: ModelDefinition): void {
    // no-op by default
  }

  static definition(): ModelDefinition {
    let def = definitions.get(this);
    if (!def) {
      def = new ModelDefinition();
      this.define(def);
      for (const mapping of def.mappings.values()) {
        if (!def.attributes.has(mapping.attr)) {
          throw new Error(`Mapping for unmapped attribute: ${this.name}.${mapping.attr}`);
        }
      }
      definitions.set(this, def);
    }
    return def;
  }

  static fromYamlObject(data: unknown): SerializableModel {
    const cls = this as unknown as ModelConstructor;
    return new cls(data);
  }

  static fromYaml(text: string): SerializableModel {
    return this.fromYamlObject(yaml.parse(text));
  }

  static async fromYamlFile(filePath: string): Promise<SerializableModel> {
    const { readTextFile } = await import('../util/fsx.js');
    return this.fromYaml(await readTextFile(filePath));
  }

  constructor(data?: unknown) {
    const def = (this.constructor as unknown as { definition(): ModelDefinition }).definition();
    for (const attr of def.attributes.values()) {
      (this as unknown as Record<string, unknown>)[attr.name] = attr.options.default
        ? attr.options.default()
        : null;
    }
    if (data !== null && data !== undefined) {
      this.assign(data);
    }
  }

  private assign(data: unknown): void {
    const def = (this.constructor as unknown as { definition(): ModelDefinition }).definition();
    if (typeof data !== 'object' || data === null) return;
    for (const mapping of def.mappings.values()) {
      const raw = (data as Record<string, unknown>)[mapping.key];
      (this as unknown as Record<string, unknown>)[mapping.attr] = deserializeValue(mapping, def, raw);
    }
  }

  toYamlObject(): Record<string, unknown> {
    const def = (this.constructor as unknown as { definition(): ModelDefinition }).definition();
    const result: Record<string, unknown> = {};
    for (const mapping of def.mappings.values()) {
      const attrDef = def.attributes.get(mapping.attr);
      if (!attrDef) continue;
      if (attrDef.options.omitWhen?.(this)) continue;
      const value = (this as unknown as Record<string, unknown>)[mapping.attr];
      if (value === null || value === undefined) {
        if (attrDef.options.renderNil) result[mapping.key] = null;
        continue;
      }
      result[mapping.key] = serializeValue(mapping, attrDef, value);
    }
    return result;
  }

  toYaml(): string {
    return yaml.stringify(this.toYamlObject(), { lineWidth: 80 });
  }

  async toYamlFile(filePath: string): Promise<void> {
    const { atomicWriteFile } = await import('../util/fsx.js');
    await atomicWriteFile(filePath, this.toYaml());
  }

  /** Tag emitted for polymorphic attributes; null for plain models. */
  yamlTag(): string | null {
    return null;
  }

  /** Structural equality against another model of the same class. */
  equals(other: SerializableModel): boolean {
    if (this.constructor !== other.constructor) return false;
    const def = (this.constructor as unknown as { definition(): ModelDefinition }).definition();
    for (const attr of def.attributes.keys()) {
      if (
        JSON.stringify((this as unknown as Record<string, unknown>)[attr]) !==
        JSON.stringify((other as unknown as Record<string, unknown>)[attr])
      ) {
        return false;
      }
    }
    return true;
  }
}

function deserializeValue(mapping: MappingDef, def: ModelDefinition, raw: unknown): unknown {
  const attrDef = def.attributes.get(mapping.attr);
  if (!attrDef) return null;
  if (raw === null || raw === undefined) {
    return attrDef.options.default ? attrDef.options.default() : null;
  }
  if (mapping.childKeyTo) {
    return deserializeKeyedModels(attrDef, raw, mapping.childKeyTo);
  }
  if (mapping.polymorphicTag && mapping.polymorphicRegistry) {
    return deserializePolymorphic(mapping.polymorphicTag, mapping.polymorphicRegistry, raw);
  }
  if (attrDef.model) {
    if (attrDef.options.collection) {
      const items = Array.isArray(raw) ? raw : [raw];
      return items.map((item) => new attrDef.model!(item as Record<string, unknown>));
    }
    return new attrDef.model(raw as Record<string, unknown>);
  }
  return deserializeScalar(attrDef.scalar, attrDef.options.collection, raw);
}

function deserializeKeyedModels(
  attrDef: AttributeDef,
  raw: unknown,
  keyTo: string,
): unknown {
  if (!attrDef.model) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result: SerializableModel[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const fields =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : {};
    result.push(new attrDef.model({ ...fields, [keyTo]: key }));
  }
  return result;
}

function deserializePolymorphic(
  tagKey: string,
  registry: Record<string, ModelConstructor>,
  raw: unknown,
): unknown {
  if (typeof raw !== 'object' || raw === null) return null;
  const tag = (raw as Record<string, unknown>)[tagKey];
  const cls = typeof tag === 'string' ? registry[tag] : undefined;
  return cls ? new cls(raw as Record<string, unknown>) : null;
}

function deserializeScalar(scalar: ScalarType | undefined, collection: boolean | undefined, raw: unknown): unknown {
  if (collection) {
    const items = Array.isArray(raw) ? raw : [raw];
    return items.filter((item) => item !== null && item !== undefined).map((item) => coerceScalar(scalar, item));
  }
  return coerceScalar(scalar, raw);
}

function coerceScalar(scalar: ScalarType | undefined, value: unknown): unknown {
  switch (scalar) {
    case 'string':
      return value === null || value === undefined ? null : String(value);
    case 'integer': {
      if (typeof value === 'number') return Math.trunc(value);
      const parsed = Number.parseInt(String(value), 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    case 'float': {
      if (typeof value === 'number') return value;
      const parsed = Number.parseFloat(String(value));
      return Number.isNaN(parsed) ? null : parsed;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'false') return false;
      if (value === 'true') return true;
      return Boolean(value);
    default:
      return value;
  }
}

function serializeValue(mapping: MappingDef, attrDef: AttributeDef, value: unknown): unknown {
  if (mapping.childKeyTo) {
    return serializeKeyedModels(value, mapping.childKeyTo);
  }
  if (mapping.polymorphicTag && mapping.polymorphicRegistry) {
    return serializePolymorphic(mapping.polymorphicTag, value);
  }
  if (attrDef.model) {
    const items = attrDef.options.collection
      ? (value as SerializableModel[])
      : [value as SerializableModel];
    const serialized = items.map((item) => item.toYamlObject());
    return attrDef.options.collection ? serialized : serialized[0] ?? null;
  }
  return value;
}

function serializeKeyedModels(value: unknown, keyFrom: string): unknown {
  const result: Record<string, unknown> = {};
  for (const item of value as SerializableModel[]) {
    const obj = item.toYamlObject();
    const key = obj[keyFrom];
    delete obj[keyFrom];
    result[String(key)] = obj;
  }
  return result;
}

function serializePolymorphic(tagKey: string, value: unknown): unknown {
  const model = value as SerializableModel | null;
  if (!model) return null;
  const obj = model.toYamlObject();
  const tag = model.yamlTag();
  if (tag === null) return obj;
  return { [tagKey]: tag, ...obj };
}

// ── Keyed collections (root YAML mapping of name -> model fields) ───────────

/**
 * Models whose YAML form is a root mapping `name -> fields` (e.g. manifests).
 * The key is folded into each item's `keyAttr`; on serialization it is lifted
 * back out as the mapping key. Concrete subclasses construct items with their
 * own item class via the protected constructor.
 */
export abstract class KeyedCollectionModel<T extends SerializableModel> {
  readonly items: T[];

  protected constructor(
    private readonly itemClass: new (data?: unknown) => T,
    private readonly keyAttr: string,
    data?: unknown,
  ) {
    this.items = [];
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const fields =
          typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)
            : {};
        this.items.push(new itemClass({ ...fields, [keyAttr]: key }));
      }
    }
  }

  toYamlObject(): Record<string, unknown> {    const result: Record<string, unknown> = {};
    for (const item of this.items) {
      const obj = item.toYamlObject();
      const key = (item as unknown as Record<string, unknown>)[this.keyAttr];
      delete obj[this.keyAttr];
      result[String(key)] = obj;
    }
    return result;
  }

  toYaml(): string {
    return yaml.stringify(this.toYamlObject(), { lineWidth: 80 });
  }
}

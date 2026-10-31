/**
 * Lightweight JSON Schema validator extracted from diagnostics.ts for direct
 * unit testing (see src/__tests__/schema-validator.test.ts), same pattern as
 * completion-data.ts. Reimplements a JSON Schema subset instead of using
 * `ajv` to keep the extension's bundle size small.
 */
import * as path from "path";
import * as fs from "fs";

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  /** For `additionalProperties`: the property names that ARE allowed there. */
  allowed?: string[];
}

// Data nesting depth, not schema depth: a full Caddy config reaches
// apps.http.servers.<srv>.routes[i].handle[j].routes[k].handle[l].upstreams[m].dial
// (~15 levels), so 10 silently stopped validating real configs part-way.
const MAX_VALIDATION_DEPTH = 32;
// Bounds $ref chains (a -> b -> a) independently of data depth.
const MAX_REF_HOPS = 64;

export class SimpleSchemaValidator {
  private schemas: Map<string, object> = new Map();
  /** Schema passed to the current validate() call; `#/...` refs resolve against it. */
  private root: Record<string, unknown> = {};
  private extensionPath: string;
  private log: (message: string) => void;

  constructor(extensionPath: string, log?: (message: string) => void) {
    this.extensionPath = extensionPath;
    this.log = log ?? (() => {});
    this.loadSchemas();
  }

  private loadSchemas(): void {
    const schemasDir = path.join(this.extensionPath, "schemas");

    if (!fs.existsSync(schemasDir)) {
      return;
    }

    const schemaFiles = fs.readdirSync(schemasDir).filter((f) => f.endsWith(".json"));

    for (const file of schemaFiles) {
      try {
        const schemaPath = path.join(schemasDir, file);
        const content = fs.readFileSync(schemaPath, "utf-8");
        const schema = JSON.parse(content) as object;
        this.schemas.set(file, schema);
      } catch {
        // Ignore invalid schema files
      }
    }
  }

  getSchemaForFile(fileName: string): object | undefined {
    const basename = path.basename(fileName).toLowerCase();

    // Portal/policy checked before the generic caddy-security check: a
    // filename like "auth.caddy-security-portal.json" also contains the
    // substring "caddy-security" and would otherwise match that branch first.
    if (basename.includes("portal")) {
      return this.schemas.get("caddy-security-portal.json");
    }

    if (basename.includes("policy")) {
      return this.schemas.get("caddy-security-policy.json");
    }

    if (basename.includes("caddy-security") || basename.includes("security-config")) {
      return this.schemas.get("caddy-security-config.json");
    }

    if (basename.endsWith(".caddy.json") || basename === "caddy.json") {
      return this.schemas.get("caddy-route.json");
    }

    return undefined;
  }

  /**
   * Validates JSON data against a schema
   * Returns validation errors with paths and messages
   */
  validate(data: unknown, schema: object): ValidationError[] {
    const errors: ValidationError[] = [];
    // Ancestors on the current data path, for circular-data detection. A
    // plain "seen" set would wrongly skip the same object when it's checked
    // against several anyOf/oneOf branches.
    const visited = new Set<object>();
    const startTime = performance.now();
    this.root = schema as Record<string, unknown>;
    this.validateSame(data, this.root, "", errors, 0, visited);
    this.log(
      `Validation completed in ${(performance.now() - startTime).toFixed(2)}ms, ${errors.length} errors found`
    );
    return errors;
  }

  private validateObject(
    data: unknown,
    schema: Record<string, unknown>,
    currentPath: string,
    errors: ValidationError[],
    depth: number = 0,
    visited: Set<object> = new Set()
  ): void {
    // Depth guard to prevent excessive recursion
    if (depth > MAX_VALIDATION_DEPTH) {
      this.log(`Max depth (${MAX_VALIDATION_DEPTH}) exceeded at path: ${currentPath}`);
      return;
    }

    schema = this.resolveRefs(schema);

    // Circular reference detection for objects
    const isObject = typeof data === "object" && data !== null;
    if (isObject) {
      if (visited.has(data)) {
        this.log(`Circular reference detected at path: ${currentPath}`);
        return;
      }
      visited.add(data);
    }
    try {
      this.validateResolved(data, schema, currentPath, errors, depth, visited);
    } finally {
      if (isObject) visited.delete(data);
    }
  }

  /**
   * Follow local `$ref`s (`#/definitions/x`, `#/$defs/x`, any JSON pointer
   * into the root schema). Every generated schema is rooted in one, so without
   * this the validator checked nothing at all. Sibling keywords next to a
   * `$ref` are kept (draft 2019+ semantics, harmless for draft-07 output).
   */
  private resolveRefs(schema: Record<string, unknown>): Record<string, unknown> {
    let current = schema;
    for (let hops = 0; typeof current.$ref === "string" && hops < MAX_REF_HOPS; hops++) {
      const target = this.resolvePointer(current.$ref as string);
      if (!target) {
        this.log(`Unresolvable $ref: ${String(current.$ref)}`);
        const { $ref: _ignored, ...rest } = current;
        return rest;
      }
      const { $ref: _ref, ...siblings } = current;
      current = { ...target, ...siblings };
    }
    return current;
  }

  private resolvePointer(ref: string): Record<string, unknown> | undefined {
    if (ref === "#") return this.root;
    if (!ref.startsWith("#/")) return undefined; // remote refs unsupported
    let node: unknown = this.root;
    for (const raw of ref.slice(2).split("/")) {
      const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      if (typeof node !== "object" || node === null) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return typeof node === "object" && node !== null
      ? (node as Record<string, unknown>)
      : undefined;
  }

  private validateResolved(
    data: unknown,
    schema: Record<string, unknown>,
    currentPath: string,
    errors: ValidationError[],
    depth: number,
    visited: Set<object>
  ): void {
    // Check type constraints
    const schemaType = schema.type as string | string[] | undefined;

    if (schemaType) {
      const types = Array.isArray(schemaType) ? schemaType : [schemaType];
      const actualType = this.getJsonType(data);

      const integerOk =
        actualType === "number" && types.includes("integer") && Number.isInteger(data);
      if (!types.includes(actualType) && !integerOk && !(types.includes("null") && data === null)) {
        errors.push({
          path: currentPath || "$",
          message: `Expected ${types.join(" | ")}, got ${actualType}`,
          keyword: "type",
        });
        return;
      }
    }

    // Check required properties
    const required = schema.required as string[] | undefined;
    if (required && typeof data === "object" && data !== null) {
      for (const prop of required) {
        if (!(prop in data)) {
          errors.push({
            path: currentPath ? `${currentPath}.${prop}` : prop,
            message: `Missing required property: ${prop}`,
            keyword: "required",
          });
        }
      }
    }

    // Check properties
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties && typeof data === "object" && data !== null) {
      const dataObj = data as Record<string, unknown>;

      for (const [key, value] of Object.entries(dataObj)) {
        const propSchema = properties[key];
        if (propSchema) {
          const propPath = currentPath ? `${currentPath}.${key}` : key;
          this.validateObject(value, propSchema, propPath, errors, depth + 1, visited);
        }
      }
    }

    // Check additionalProperties
    const additionalProperties = schema.additionalProperties;
    if (
      additionalProperties === false &&
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data)
    ) {
      const dataObj = data as Record<string, unknown>;
      const allowedKeys = new Set(Object.keys(properties ?? {}));

      for (const key of Object.keys(dataObj)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            path: currentPath ? `${currentPath}.${key}` : key,
            message: `Unexpected property: ${key}`,
            keyword: "additionalProperties",
            allowed: [...allowedKeys],
          });
        }
      }
    }

    // additionalProperties as a schema (e.g. a map of domain -> cookie config)
    if (
      typeof additionalProperties === "object" &&
      additionalProperties !== null &&
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data)
    ) {
      const known = new Set(Object.keys(properties ?? {}));
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (known.has(key)) continue;
        const propPath = currentPath ? `${currentPath}.${key}` : key;
        this.validateObject(
          value,
          additionalProperties as Record<string, unknown>,
          propPath,
          errors,
          depth + 1,
          visited
        );
      }
    }

    // Check allOf
    const allOf = schema.allOf as Record<string, unknown>[] | undefined;
    if (allOf) {
      for (const sub of allOf) {
        this.validateSame(data, sub, currentPath, errors, depth + 1, visited);
      }
    }

    // Check array items
    const items = schema.items as Record<string, unknown> | undefined;
    if (items && Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const itemPath = `${currentPath}[${i}]`;
        this.validateObject(data[i], items, itemPath, errors, depth + 1, visited);
      }
    }

    // Check enum values
    const enumValues = schema.enum as unknown[] | undefined;
    if (enumValues) {
      if (!enumValues.includes(data)) {
        errors.push({
          path: currentPath || "$",
          message: `Value must be one of: ${enumValues.map((v) => JSON.stringify(v)).join(", ")}`,
          keyword: "enum",
        });
      }
    }

    // Check const value
    const constValue = schema.const;
    if (constValue !== undefined && data !== constValue) {
      errors.push({
        path: currentPath || "$",
        message: `Value must be: ${JSON.stringify(constValue)}`,
        keyword: "const",
      });
    }

    // Check string constraints
    if (typeof data === "string") {
      const minLength = schema.minLength as number | undefined;
      const maxLength = schema.maxLength as number | undefined;
      const pattern = schema.pattern as string | undefined;

      if (minLength !== undefined && data.length < minLength) {
        errors.push({
          path: currentPath || "$",
          message: `String must be at least ${minLength} characters`,
          keyword: "minLength",
        });
      }

      if (maxLength !== undefined && data.length > maxLength) {
        errors.push({
          path: currentPath || "$",
          message: `String must be at most ${maxLength} characters`,
          keyword: "maxLength",
        });
      }

      if (pattern) {
        try {
          const regex = new RegExp(pattern);
          if (!regex.test(data)) {
            errors.push({
              path: currentPath || "$",
              message: `String must match pattern: ${pattern}`,
              keyword: "pattern",
            });
          }
        } catch {
          // Invalid regex pattern in schema
        }
      }
    }

    // Check number constraints
    if (typeof data === "number") {
      const minimum = schema.minimum as number | undefined;
      const maximum = schema.maximum as number | undefined;

      if (minimum !== undefined && data < minimum) {
        errors.push({
          path: currentPath || "$",
          message: `Value must be >= ${minimum}`,
          keyword: "minimum",
        });
      }

      const exclusiveMinimum = schema.exclusiveMinimum as number | undefined;
      const exclusiveMaximum = schema.exclusiveMaximum as number | undefined;
      if (typeof exclusiveMinimum === "number" && data <= exclusiveMinimum) {
        errors.push({
          path: currentPath || "$",
          message: `Value must be > ${exclusiveMinimum}`,
          keyword: "exclusiveMinimum",
        });
      }
      if (typeof exclusiveMaximum === "number" && data >= exclusiveMaximum) {
        errors.push({
          path: currentPath || "$",
          message: `Value must be < ${exclusiveMaximum}`,
          keyword: "exclusiveMaximum",
        });
      }

      if (maximum !== undefined && data > maximum) {
        errors.push({
          path: currentPath || "$",
          message: `Value must be <= ${maximum}`,
          keyword: "maximum",
        });
      }
    }

    // Check oneOf (discriminated unions)
    const oneOf = schema.oneOf as Record<string, unknown>[] | undefined;
    if (oneOf) {
      this.validateOneOf(data, oneOf, currentPath, errors, depth, visited);
    }

    // Check anyOf
    const anyOf = schema.anyOf as Record<string, unknown>[] | undefined;
    // Handler unions are emitted as anyOf too: pick the branch by its
    // `handler` const so errors inside it (e.g. a typo'd field) surface with
    // their real path instead of a generic "does not match any".
    const discriminated = anyOf ? this.branchForHandler(data, anyOf) : undefined;
    if (discriminated) {
      this.validateSame(data, discriminated, currentPath, errors, depth + 1, visited);
    } else if (anyOf) {
      const anyValid = anyOf.some((subSchema) => {
        const subErrors: ValidationError[] = [];
        this.validateSame(data, subSchema, currentPath, subErrors, depth + 1, visited);
        return subErrors.length === 0;
      });

      if (!anyValid) {
        errors.push({
          path: currentPath || "$",
          message: "Value does not match any of the allowed schemas",
          keyword: "anyOf",
        });
      }
    }
  }

  private validateOneOf(
    data: unknown,
    oneOf: Record<string, unknown>[],
    currentPath: string,
    errors: ValidationError[],
    depth: number,
    visited: Set<object>
  ): void {
    // For handler discriminated unions, check if data has handler property
    if (typeof data === "object" && data !== null && "handler" in data) {
      const handlerValue = (data as Record<string, unknown>).handler;

      // Find matching schema by handler const value
      const matchingSchema = oneOf.find((schema) => {
        const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
        if (props?.handler?.const === handlerValue) {
          return true;
        }
        return false;
      });

      if (matchingSchema) {
        this.validateSame(data, matchingSchema, currentPath, errors, depth + 1, visited);
        return;
      } else if (typeof handlerValue === "string") {
        // Check if handler value is valid at all
        const validHandlers = oneOf
          .map((s) => {
            const props = s.properties as Record<string, Record<string, unknown>> | undefined;
            return props?.handler?.const;
          })
          .filter(Boolean);

        if (validHandlers.length > 0) {
          errors.push({
            path: currentPath ? `${currentPath}.handler` : "handler",
            message: `Unknown handler type: "${handlerValue}". Valid types: ${validHandlers.map((h) => `"${h}"`).join(", ")}`,
            keyword: "oneOf",
          });
          return;
        }
      }
    }

    // Generic oneOf validation - check if exactly one matches
    const matchResults = oneOf.map((schema) => {
      const subErrors: ValidationError[] = [];
      this.validateSame(data, schema, currentPath, subErrors, depth + 1, visited);
      return subErrors.length === 0;
    });

    const matchCount = matchResults.filter(Boolean).length;

    if (matchCount === 0) {
      errors.push({
        path: currentPath || "$",
        message: "Value does not match any of the expected schemas",
        keyword: "oneOf",
      });
    } else if (matchCount > 1) {
      errors.push({
        path: currentPath || "$",
        message: "Value matches multiple schemas when only one should match",
        keyword: "oneOf",
      });
    }
  }

  /**
   * Re-check the SAME value against another (sub)schema -- allOf/anyOf/oneOf
   * branches. Bypasses the ancestor check in validateObject, which would
   * otherwise mistake the value for a circular reference to itself.
   */
  private validateSame(
    data: unknown,
    schema: Record<string, unknown>,
    currentPath: string,
    errors: ValidationError[],
    depth: number,
    visited: Set<object>
  ): void {
    if (depth > MAX_VALIDATION_DEPTH) return;
    this.validateResolved(data, this.resolveRefs(schema), currentPath, errors, depth, visited);
  }

  private branchForHandler(
    data: unknown,
    branches: Record<string, unknown>[]
  ): Record<string, unknown> | undefined {
    if (typeof data !== "object" || data === null || !("handler" in data)) return undefined;
    const handler = (data as Record<string, unknown>).handler;
    return branches.find((branch) => {
      const props = this.resolveRefs(branch).properties as
        | Record<string, Record<string, unknown>>
        | undefined;
      return props?.handler?.const === handler;
    });
  }

  private getJsonType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }
}

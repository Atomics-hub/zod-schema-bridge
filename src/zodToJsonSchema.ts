import type { ZodSchema } from "zod/v3";
import * as z4 from "zod/v4";
import { ignoreOverride, type Options, type Targets } from "./Options.js";
import { parseDef } from "./parseDef.js";
import type { JsonSchema7Type } from "./parseTypes.js";
import { getRefs } from "./Refs.js";
import { parseAnyDef } from "./parsers/any.js";

export type AnyZodSchema = ZodSchema<any> | z4.ZodType;

export type BridgeDiagnostic = {
  code:
    | "native-zod4"
    | "emulated-dialect"
    | "ignored-legacy-option"
    | "adapted-legacy-option"
    | "lossy-schema"
    | "provider-validated"
    | "openai-normalized";
  level: "info" | "warning";
  message: string;
};

export type BridgeConversionResult = {
  schema: JsonSchema7Type & Record<string, unknown>;
  engine: "legacy-zod3" | "native-zod4";
  diagnostics: BridgeDiagnostic[];
};

type SchemaObject = Record<string, any>;

const isObject = (value: unknown): value is SchemaObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isZodV4Schema = (schema: unknown): schema is z4.ZodType =>
  isObject(schema) && "_zod" in schema;

const replaceRefPrefix = (
  value: unknown,
  from: string,
  to: string,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => replaceRefPrefix(item, from, to));
  }
  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "$ref" && typeof item === "string"
        ? item.replace(from, to)
        : replaceRefPrefix(item, from, to),
    ]),
  );
};

const normalizeDefinitionPath = (
  schema: SchemaObject,
  definitionPath: string,
): SchemaObject => {
  if (definitionPath === "$defs" || !("$defs" in schema)) return schema;

  const normalized = replaceRefPrefix(
    schema,
    "#/$defs/",
    `#/${definitionPath}/`,
  ) as SchemaObject;
  const definitions = normalized.$defs;
  delete normalized.$defs;
  normalized[definitionPath] = definitions;
  return normalized;
};

const allowsNull = (schema: unknown): boolean => {
  if (!isObject(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.some(allowsNull);
};

const makeNullable = (schema: unknown): unknown =>
  allowsNull(schema) ? schema : { anyOf: [schema, { type: "null" }] };

const normalizeOpenAiStrict = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeOpenAiStrict);
  if (!isObject(value)) return value;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      normalizeOpenAiStrict(item),
    ]),
  ) as SchemaObject;

  if (normalized.type === "object" && isObject(normalized.properties)) {
    const originallyRequired = new Set(
      Array.isArray(normalized.required) ? normalized.required : [],
    );
    normalized.properties = Object.fromEntries(
      Object.entries(normalized.properties).map(([key, property]) => [
        key,
        originallyRequired.has(key) ? property : makeNullable(property),
      ]),
    );
    normalized.required = Object.keys(normalized.properties);
    normalized.additionalProperties = false;
  }

  return normalized;
};

const optionsObject = <Target extends Targets>(
  options?: Partial<Options<Target>> | string,
): Partial<Options<Target>> =>
  typeof options === "string" ? { name: options } : (options ?? {});

const convertZod4 = <Target extends Targets>(
  schema: z4.ZodType,
  options: Partial<Options<Target>> | string | undefined,
  diagnostics: BridgeDiagnostic[],
): JsonSchema7Type & Record<string, unknown> => {
  const resolved = optionsObject(options);
  const target = resolved.target ?? "jsonSchema7";
  const definitionPath = resolved.definitionPath ?? "definitions";

  const nativeTarget =
    target === "openApi3"
      ? "openapi-3.0"
      : target === "jsonSchema7" || target === "openAi"
        ? "draft-7"
        : "draft-2020-12";

  diagnostics.push({
    code: "native-zod4",
    level: "info",
    message: `Converted with Zod 4's native ${nativeTarget} engine.`,
  });

  if (target === "jsonSchema2019-09") {
    diagnostics.push({
      code: "emulated-dialect",
      level: "warning",
      message:
        "Zod 4 does not emit draft 2019-09 directly; the bridge emits draft 2020-12-compatible output and declares the requested dialect.",
    });
  }

  const hasLegacyCallbacks = resolved.override || resolved.postProcess;
  if (hasLegacyCallbacks) {
    diagnostics.push({
      code: "adapted-legacy-option",
      level: "warning",
      message: "Legacy override/postProcess callbacks are adapted to Zod 4 definitions; callbacks that inspect Zod 3-only internals still require review.",
    });
  }

  if (resolved.unrepresentable === "any") {
    diagnostics.push({
      code: "lossy-schema",
      level: "warning",
      message: "Unrepresentable Zod 4 types may be emitted as unconstrained `{}` schemas.",
    });
  }

  const compatibilityRefs = getRefs(resolved as Partial<Options<any>>);

  let output = z4.toJSONSchema(schema, {
    target: nativeTarget,
    io: resolved.pipeStrategy === "output" ? "output" : "input",
    unrepresentable: resolved.unrepresentable ?? "throw",
    cycles: resolved.$refStrategy === "none" ? "throw" : "ref",
    reused: resolved.$refStrategy === "none" ? "inline" : "ref",
    ...(hasLegacyCallbacks
      ? {
          override: (context: any) => {
            let replacement: unknown = ignoreOverride;
            if (resolved.override) {
              replacement = resolved.override(
                (context.zodSchema as any)._def,
                compatibilityRefs,
                undefined,
                false,
              );
            }
            if (replacement !== ignoreOverride) {
              const replacementObject = isObject(replacement) ? { ...replacement } : undefined;
              for (const key of Object.keys(context.jsonSchema)) delete context.jsonSchema[key];
              if (replacementObject) Object.assign(context.jsonSchema, replacementObject);
            }
            if (resolved.postProcess) {
              const processed = resolved.postProcess(
                context.jsonSchema as JsonSchema7Type,
                (context.zodSchema as any)._def,
                compatibilityRefs,
              );
              const processedObject = isObject(processed) ? { ...processed } : undefined;
              for (const key of Object.keys(context.jsonSchema)) delete context.jsonSchema[key];
              if (processedObject) Object.assign(context.jsonSchema, processedObject);
            }
          },
        }
      : {}),
  }) as SchemaObject;

  output = normalizeDefinitionPath(output, definitionPath);

  if (resolved.definitions && Object.keys(resolved.definitions).length > 0) {
    const convertedDefinitions = Object.fromEntries(
      Object.entries(resolved.definitions).map(([definitionName, definition]) => {
        const converted = isZodV4Schema(definition)
          ? z4.toJSONSchema(definition, {
              target: nativeTarget,
              io: resolved.pipeStrategy === "output" ? "output" : "input",
              unrepresentable: resolved.unrepresentable ?? "throw",
            }) as SchemaObject
          : legacyZodToJsonSchema(definition as ZodSchema<any>, {
              ...resolved,
              name: undefined,
              definitions: {},
            } as Partial<Options<any>>) as SchemaObject;
        const clean = { ...converted };
        delete clean.$schema;
        return [definitionName, clean];
      }),
    );
    output[definitionPath] = {
      ...(isObject(output[definitionPath]) ? output[definitionPath] : {}),
      ...convertedDefinitions,
    };
  }

  if (target === "jsonSchema2019-09") {
    output.$schema = "https://json-schema.org/draft/2019-09/schema#";
  }

  if (target === "openAi") {
    output = normalizeOpenAiStrict(output) as SchemaObject;
    output.$schema = "https://json-schema.org/draft/2019-09/schema#";
    diagnostics.push({
      code: "openai-normalized",
      level: "info",
      message:
        "Optional object properties were converted to required nullable properties and objects were closed for OpenAI strict mode.",
    });
  }

  const name = resolved.name;
  if (name && resolved.nameStrategy !== "title") {
    const schemaDeclaration = output.$schema;
    const definition = { ...output };
    delete definition.$schema;
    output = {
      ...(schemaDeclaration ? { $schema: schemaDeclaration } : {}),
      $ref: `#/${definitionPath}/${name}`,
      [definitionPath]: { [name]: definition },
    };
  } else if (name && resolved.nameStrategy === "title") {
    output.title = name;
  }

  return output as JsonSchema7Type & Record<string, unknown>;
};

const legacyZodToJsonSchema = <Target extends Targets = "jsonSchema7">(
  schema: ZodSchema<any>,
  options?: Partial<Options<Target>> | string,
): (Target extends "jsonSchema7" ? JsonSchema7Type : object) & {
  $schema?: string;
  definitions?: Record<string, JsonSchema7Type | object>;
} => {
  const refs = getRefs(options);

  let definitions =
    typeof options === "object" && options.definitions
      ? Object.entries(options.definitions).reduce(
          (acc: Record<string, JsonSchema7Type>, [name, definition]) => ({
            ...acc,
            [name]:
              parseDef(
                (definition as ZodSchema<any>)._def,
                {
                  ...refs,
                  currentPath: [...refs.basePath, refs.definitionPath, name],
                },
                true,
              ) ?? parseAnyDef(refs),
          }),
          {},
        )
      : undefined;

  const name =
    typeof options === "string"
      ? options
      : options?.nameStrategy === "title"
        ? undefined
        : options?.name;

  const main =
    parseDef(
      schema._def,
      name === undefined
        ? refs
        : {
            ...refs,
            currentPath: [...refs.basePath, refs.definitionPath, name],
          },
      false,
    ) ?? (parseAnyDef(refs) as JsonSchema7Type);

  const title =
    typeof options === "object" &&
    options.name !== undefined &&
    options.nameStrategy === "title"
      ? options.name
      : undefined;

  if (title !== undefined) main.title = title;

  if (refs.flags.hasReferencedOpenAiAnyType) {
    definitions ??= {};
    if (!definitions[refs.openAiAnyTypeName]) {
      definitions[refs.openAiAnyTypeName] = {
        type: ["string", "number", "integer", "boolean", "array", "null"],
        items: {
          $ref:
            refs.$refStrategy === "relative"
              ? "1"
              : [
                  ...refs.basePath,
                  refs.definitionPath,
                  refs.openAiAnyTypeName,
                ].join("/"),
        },
      } as JsonSchema7Type;
    }
  }

  const combined: any =
    name === undefined
      ? definitions
        ? { ...main, [refs.definitionPath]: definitions }
        : main
      : {
          $ref: [
            ...(refs.$refStrategy === "relative" ? [] : refs.basePath),
            refs.definitionPath,
            name,
          ].join("/"),
          [refs.definitionPath]: { ...definitions, [name]: main },
        };

  if (refs.target === "jsonSchema7") {
    combined.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (refs.target === "jsonSchema2019-09" || refs.target === "openAi") {
    combined.$schema = "https://json-schema.org/draft/2019-09/schema#";
  }

  if (
    refs.target === "openAi" &&
    ("anyOf" in combined ||
      "oneOf" in combined ||
      "allOf" in combined ||
      ("type" in combined && Array.isArray(combined.type)))
  ) {
    console.warn(
      "Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property.",
    );
  }

  return combined;
};

export const convertZodSchema = <Target extends Targets = "jsonSchema7">(
  schema: AnyZodSchema,
  options?: Partial<Options<Target>> | string,
): BridgeConversionResult => {
  const diagnostics: BridgeDiagnostic[] = [];
  if (isZodV4Schema(schema)) {
    return {
      schema: convertZod4(schema, options, diagnostics),
      engine: "native-zod4",
      diagnostics,
    };
  }

  return {
    schema: legacyZodToJsonSchema(schema as ZodSchema<any>, options) as JsonSchema7Type &
      Record<string, unknown>,
    engine: "legacy-zod3",
    diagnostics,
  };
};

export const zodToJsonSchema = <Target extends Targets = "jsonSchema7">(
  schema: AnyZodSchema,
  options?: Partial<Options<Target>> | string,
): (Target extends "jsonSchema7" ? JsonSchema7Type : object) & {
  $schema?: string;
  definitions?: Record<string, JsonSchema7Type | object>;
} => convertZodSchema(schema, options).schema as any;

export { legacyZodToJsonSchema };

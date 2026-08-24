import type { Targets } from "./Options.js";
import {
  convertZodSchema,
  type AnyZodSchema,
  type BridgeDiagnostic,
} from "./zodToJsonSchema.js";

export type Provider = "openai" | "anthropic" | "gemini" | "mcp" | "vercel";

export type ProviderOptions = {
  provider: Provider;
  name: string;
  description?: string;
  unrepresentable?: "throw" | "any";
  validation?: "strict" | "none";
  strict?: boolean;
  /** OpenAI can produce either a Structured Outputs response format or a function tool. */
  openaiMode?: "responseFormat" | "tool";
};

type JsonObjectSchema = Record<string, unknown> & { type: "object" };

export type OpenAIResponseFormatPayload = {
  type: "json_schema";
  json_schema: { name: string; description?: string; strict: boolean; schema: Record<string, unknown> };
};
export type OpenAIToolPayload = {
  type: "function";
  function: { name: string; description?: string; strict: boolean; parameters: Record<string, unknown> };
};
export type AnthropicToolPayload = {
  name: string;
  description?: string;
  input_schema: JsonObjectSchema;
};
export type GeminiFunctionDeclarationPayload = {
  name: string;
  description?: string;
  parametersJsonSchema: JsonObjectSchema;
};
export type McpToolPayload = {
  name: string;
  description?: string;
  inputSchema: JsonObjectSchema;
};
export type VercelToolPayload = {
  description?: string;
  inputSchema: {
    readonly _type: undefined;
    readonly jsonSchema: JsonObjectSchema;
    readonly validate: undefined;
    readonly [key: symbol]: unknown;
  };
  strict: boolean;
};

export type ProviderPayloadMap = {
  openai: OpenAIResponseFormatPayload | OpenAIToolPayload;
  anthropic: AnthropicToolPayload;
  gemini: GeminiFunctionDeclarationPayload;
  mcp: McpToolPayload;
  vercel: VercelToolPayload;
};

export type ProviderConversionResult<P extends Provider = Provider> = {
  provider: P;
  payload: ProviderPayloadMap[P];
  schema: Record<string, unknown>;
  diagnostics: BridgeDiagnostic[];
};

export class ProviderSchemaError extends Error {
  constructor(
    readonly provider: Provider,
    readonly issues: string[],
  ) {
    super(`${provider} schema validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "ProviderSchemaError";
  }
}

const geminiKeywords = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum",
  "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf",
  "properties", "additionalProperties", "required", "propertyOrdering", "default",
]);

const withoutDialect = (schema: Record<string, unknown>) => {
  const clean = { ...schema };
  delete clean.$schema;
  return clean;
};

const normalizeGeminiSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeGeminiSchema);
  if (typeof value !== "object" || value === null) return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeGeminiSchema(item)]),
  ) as Record<string, unknown>;
  if ("const" in normalized) {
    normalized.enum = [normalized.const];
    delete normalized.const;
  }
  return normalized;
};

const toVercelSchema = (schema: JsonObjectSchema) => ({
  [Symbol.for("vercel.ai.schema")]: true,
  _type: undefined,
  jsonSchema: schema,
  validate: undefined,
});

const visitSchema = (
  value: unknown,
  path: string,
  visitor: (schema: Record<string, unknown>, path: string) => void,
) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSchema(item, `${path}/${index}`, visitor));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const schema = value as Record<string, unknown>;
  visitor(schema, path);
  for (const mapKey of ["properties", "$defs", "definitions", "patternProperties"]) {
    const map = schema[mapKey];
    if (typeof map === "object" && map !== null && !Array.isArray(map)) {
      for (const [key, child] of Object.entries(map)) visitSchema(child, `${path}/${mapKey}/${key}`, visitor);
    }
  }
  for (const childKey of ["items", "additionalProperties", "not", "if", "then", "else", "contains"]) {
    visitSchema(schema[childKey], `${path}/${childKey}`, visitor);
  }
  for (const listKey of ["prefixItems", "anyOf", "oneOf", "allOf"]) {
    visitSchema(schema[listKey], `${path}/${listKey}`, visitor);
  }
};

const validateProviderSchema = (
  provider: Provider,
  name: string,
  schema: Record<string, unknown>,
  strict: boolean,
) => {
  const issues: string[] = [];
  const commonNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
  const geminiNamePattern = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
  if (!(provider === "gemini" ? geminiNamePattern : commonNamePattern).test(name)) {
    issues.push(`tool/format name ${JSON.stringify(name)} is invalid for ${provider}`);
  }
  if (schema.type !== "object") issues.push("the root schema must have type: object");

  visitSchema(schema, "#", (node, path) => {
    if (provider === "gemini") {
      for (const key of Object.keys(node)) {
        if (!geminiKeywords.has(key) && !key.startsWith("x-")) {
          issues.push(`${path} uses unsupported Gemini keyword ${JSON.stringify(key)}`);
        }
      }
    }
    if (provider === "openai" && strict && node.type === "object" && node.properties) {
      const properties = Object.keys(node.properties as Record<string, unknown>);
      const required = Array.isArray(node.required) ? node.required : [];
      if (node.additionalProperties !== false) issues.push(`${path} must set additionalProperties: false`);
      if (properties.some((key) => !required.includes(key)) || required.length !== properties.length) {
        issues.push(`${path} must require every declared property in OpenAI strict mode`);
      }
    }
  });

  try {
    JSON.stringify(schema);
  } catch {
    issues.push("the generated schema is not JSON serializable");
  }
  if (issues.length) throw new ProviderSchemaError(provider, issues);
};

export const toProviderSchema = <P extends Provider>(
  schema: AnyZodSchema,
  options: ProviderOptions & { provider: P },
): ProviderConversionResult<P> => {
  const strict = options.strict ?? true;
  const target: Targets = options.provider === "openai" && strict ? "openAi" : "jsonSchema7";
  const converted = convertZodSchema(schema, {
    target,
    definitionPath: "$defs",
    unrepresentable: options.unrepresentable ?? "throw",
  });
  const providerSchema = (
    options.provider === "gemini"
      ? normalizeGeminiSchema(withoutDialect(converted.schema))
      : withoutDialect(converted.schema)
  ) as Record<string, unknown>;
  if (options.validation !== "none") {
    validateProviderSchema(options.provider, options.name, providerSchema, strict);
    converted.diagnostics.push({
      code: "provider-validated",
      level: "info",
      message: `Validated the generated schema against ${options.provider} boundary invariants.`,
    });
  }
  const description = options.description ? { description: options.description } : {};

  const payload =
    options.provider === "openai"
      ? options.openaiMode === "tool"
        ? {
            type: "function",
            function: {
              name: options.name,
              ...description,
              parameters: providerSchema,
              strict,
            },
          }
        : {
            type: "json_schema",
            json_schema: {
              name: options.name,
              ...description,
              strict,
              schema: providerSchema,
            },
          }
      : options.provider === "anthropic"
        ? { name: options.name, ...description, input_schema: providerSchema }
        : options.provider === "gemini"
          ? { name: options.name, ...description, parametersJsonSchema: providerSchema }
          : options.provider === "mcp"
            ? { name: options.name, ...description, inputSchema: providerSchema }
            : { ...description, inputSchema: toVercelSchema(providerSchema as JsonObjectSchema), strict };

  return {
    provider: options.provider,
    payload: payload as ProviderPayloadMap[P],
    schema: providerSchema,
    diagnostics: converted.diagnostics,
  };
};

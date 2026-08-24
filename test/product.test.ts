import { z as z4 } from "zod/v4";
import {
  convertZodSchema,
  toProviderSchema,
  zodToJsonSchema,
} from "../src/index.js";
import { suite } from "./suite.js";

suite("migration product", (test) => {
  test("builds provider-native payload envelopes", (assert) => {
    const schema = z4.object({ query: z4.string(), limit: z4.number().int().optional() });
    const openai = toProviderSchema(schema, { provider: "openai", name: "search" });
    const anthropic = toProviderSchema(schema, { provider: "anthropic", name: "search" });
    const gemini = toProviderSchema(schema, { provider: "gemini", name: "search" });
    const mcp = toProviderSchema(schema, { provider: "mcp", name: "search" });
    const vercel = toProviderSchema(schema, { provider: "vercel", name: "search" });
    assert((openai.payload as any).json_schema.strict, true);
    assert((anthropic.payload as any).input_schema.type, "object");
    assert((gemini.payload as any).parametersJsonSchema.type, "object");
    assert((mcp.payload as any).inputSchema.type, "object");
    assert((vercel.payload as any).inputSchema.jsonSchema.type, "object");
  });

  test("throws on lossy Zod 4 conversion by default", (assert) => {
    let threw = false;
    try {
      zodToJsonSchema(z4.date());
    } catch {
      threw = true;
    }
    assert(threw, true);
  });

  test("makes explicitly lossy conversion visible in diagnostics", (assert) => {
    const result = convertZodSchema(z4.date(), { unrepresentable: "any" });
    assert(result.schema, { $schema: "http://json-schema.org/draft-07/schema#" });
    assert(result.diagnostics.some((item) => item.code === "lossy-schema"), true);
  });

  test("preloads mixed-version definitions for a Zod 4 root", (assert) => {
    const schema = zodToJsonSchema(z4.object({ id: z4.string() }), {
      definitions: { Shared: z4.object({ token: z4.string() }) },
    }) as any;
    assert(schema.definitions.Shared.properties.token.type, "string");
  });

  test("adapts legacy postProcess callbacks to Zod 4", (assert) => {
    const result = convertZodSchema(z4.string(), {
      postProcess: (schema) => ({ ...schema, "x-bridge": true } as any),
    });
    assert(result.schema["x-bridge"], true);
    assert(result.diagnostics.some((item) => item.code === "adapted-legacy-option"), true);
  });
});

import type { FunctionDeclaration } from "@google/genai";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages";
import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { asSchema } from "ai";
import { z as z4 } from "zod/v4";
import type {
  AnthropicToolPayload,
  GeminiFunctionDeclarationPayload,
  McpToolPayload,
  OpenAIResponseFormatPayload,
  OpenAIToolPayload,
} from "../src/index.js";
import { toProviderSchema } from "../src/index.js";
import { suite } from "./suite.js";

type Assert<T extends true> = T;
type _OpenAIContract = Assert<OpenAIResponseFormatPayload extends ResponseFormatJSONSchema ? true : false>;
type _OpenAIToolContract = Assert<OpenAIToolPayload extends ChatCompletionTool ? true : false>;
type _AnthropicContract = Assert<AnthropicToolPayload extends AnthropicTool ? true : false>;
type _GeminiContract = Assert<GeminiFunctionDeclarationPayload extends FunctionDeclaration ? true : false>;
type _McpContract = Assert<McpToolPayload extends McpTool ? true : false>;

const schemaForContracts = z4.object({ value: z4.string() });

suite("official provider contracts", (test) => {
  test("payloads satisfy installed SDK boundaries", (assert) => {
    const schema = z4.object({ query: z4.string(), limit: z4.number().int().optional() });
    const openai = toProviderSchema(schema, { provider: "openai", name: "search" });
    const openaiTool = toProviderSchema(schema, { provider: "openai", openaiMode: "tool", name: "search" });
    const anthropic = toProviderSchema(schema, { provider: "anthropic", name: "search" });
    const gemini = toProviderSchema(schema, { provider: "gemini", name: "search" });
    const mcp = toProviderSchema(schema, { provider: "mcp", name: "search" });
    const vercel = toProviderSchema(schema, { provider: "vercel", name: "search" });

    assert(openai.diagnostics.some((item) => item.code === "provider-validated"), true);
    assert((openaiTool.payload as ChatCompletionTool).function.strict, true);
    assert((anthropic.payload as AnthropicTool).input_schema.type, "object");
    assert((gemini.payload as FunctionDeclaration).parametersJsonSchema !== undefined, true);
    assert((mcp.payload as McpTool).inputSchema.type, "object");
    assert(asSchema((vercel.payload as any).inputSchema).jsonSchema, vercel.schema);
  });

  test("normalizes Gemini literals to supported enums", (assert) => {
    const gemini = toProviderSchema(z4.object({ mode: z4.literal("fast") }), {
      provider: "gemini",
      name: "run",
    });
    const mode = (gemini.payload as any).parametersJsonSchema.properties.mode;
    assert(mode.enum, ["fast"]);
    assert("const" in mode, false);
  });

  test("rejects invalid names and provider-incompatible keywords", (assert) => {
    let invalidName = false;
    let unsupportedKeyword = false;
    try {
      toProviderSchema(schemaForContracts, { provider: "openai", name: "contains spaces" });
    } catch {
      invalidName = true;
    }
    try {
      toProviderSchema(z4.object({ value: z4.string().min(2) }), { provider: "gemini", name: "valid" });
    } catch {
      unsupportedKeyword = true;
    }
    assert(invalidName, true);
    assert(unsupportedKeyword, true);
  });
});

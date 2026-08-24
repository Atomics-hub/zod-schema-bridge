import { z as z3 } from "zod/v3";
import { z as z4 } from "zod/v4";
import { suite } from "./suite.js";
import {
  convertZodSchema,
  isZodV4Schema,
  zodToJsonSchema,
} from "../src/index.js";

suite("bridge", (test) => {
  test("detects genuine Zod 4 schemas", (assert) => {
    assert(isZodV4Schema(z4.string()), true);
    assert(isZodV4Schema(z3.string()), false);
  });

  test("preserves the legacy Zod 3 engine", (assert) => {
    const result = convertZodSchema(z3.object({ name: z3.string() }), "User");
    assert(result.engine, "legacy-zod3");
    assert(result.diagnostics, []);
    assert(result.schema.$ref, "#/definitions/User");
  });

  test("converts genuine Zod 4 schemas with native JSON Schema", (assert) => {
    const result = convertZodSchema(
      z4.object({ name: z4.string(), age: z4.number().int().optional() }),
      "User",
    );
    assert(result.engine, "native-zod4");
    assert(result.schema.$ref, "#/definitions/User");
    assert(result.diagnostics[0]?.code, "native-zod4");
  });

  test("normalizes optional fields for OpenAI strict mode", (assert) => {
    const schema = zodToJsonSchema(
      z4.object({ required: z4.string(), optional: z4.number().optional() }),
      { target: "openAi" },
    ) as any;
    assert(schema.required, ["required", "optional"]);
    assert(schema.additionalProperties, false);
    assert(schema.properties.optional.anyOf[1], { type: "null" });
  });

  test("reports emulated draft 2019-09 output", (assert) => {
    const result = convertZodSchema(z4.string(), {
      target: "jsonSchema2019-09",
    });
    assert(result.schema.$schema, "https://json-schema.org/draft/2019-09/schema#");
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === "emulated-dialect"),
      true,
    );
  });
});

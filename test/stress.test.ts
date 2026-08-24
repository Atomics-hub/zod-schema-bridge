import { performance } from "node:perf_hooks";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import fc from "fast-check";
import { z as z3 } from "zod/v3";
import { z as z4 } from "zod/v4";
import {
  legacyZodToJsonSchema,
  zodToJsonSchema,
} from "../src/index.js";
import { suite } from "./suite.js";

const stressRuns = Number.parseInt(process.env.BRIDGE_STRESS_RUNS ?? "300", 10);
const seed = Number.parseInt(process.env.BRIDGE_STRESS_SEED ?? "424242", 10);

const assertProperty = (property: fc.IProperty<unknown[]>, numRuns = stressRuns) =>
  fc.assert(property, { seed, numRuns, endOnFailure: true });

const json = (value: unknown) => JSON.stringify(value);

const dialectAgnosticSchema = (schema: Record<string, unknown>) => {
  const output = structuredClone(schema);
  delete output.$schema;
  return output;
};

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

const semanticCorpus = [
  z4.string().min(2).max(12),
  z4.number().int().min(-100).max(100),
  z4.boolean(),
  z4.enum(["red", "green", "blue"]),
  z4.array(z4.string().min(1)).min(1).max(5),
  z4.union([z4.string().min(1), z4.number().int()]),
  z4.nullable(z4.string().regex(/^[a-z]{1,8}$/)),
  z4.strictObject({
    id: z4.string().uuid(),
    count: z4.number().int().nonnegative(),
    note: z4.string().max(30).optional(),
  }),
];

const visitObjects = (
  value: unknown,
  visitor: (object: Record<string, unknown>) => void,
): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => visitObjects(item, visitor));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const object = value as Record<string, unknown>;
  visitor(object);
  Object.values(object).forEach((item) => visitObjects(item, visitor));
};

suite("stress", (test) => {
  test("Zod 3 dispatch is byte-for-byte compatible across generated schemas", (assert) => {
    const field = fc.record({
      name: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
      kind: fc.constantFrom("string", "integer", "boolean", "strings"),
      optional: fc.boolean(),
      nullable: fc.boolean(),
    });

    assertProperty(
      fc.property(fc.array(field, { minLength: 1, maxLength: 20 }), (fields) => {
        const shape: Record<string, z3.ZodTypeAny> = {};
        for (const descriptor of fields) {
          let schema: z3.ZodTypeAny =
            descriptor.kind === "string"
              ? z3.string().min(1).max(40)
              : descriptor.kind === "integer"
                ? z3.number().int().min(-1000).max(1000)
                : descriptor.kind === "boolean"
                  ? z3.boolean()
                  : z3.array(z3.string().min(1)).max(10);
          if (descriptor.nullable) schema = schema.nullable();
          if (descriptor.optional) schema = schema.optional();
          shape[descriptor.name] = schema;
        }
        const schema = z3.object(shape);
        const options = { name: "Generated", target: "jsonSchema7" as const };
        if (json(zodToJsonSchema(schema, options)) !== json(legacyZodToJsonSchema(schema, options))) {
          throw new Error("hybrid dispatch diverged from the vendored Zod 3 engine");
        }
      }),
    );
    assert(true);
  });

  test("Zod 4 JSON Schema agrees with Zod on broad JSON inputs", (assert) => {
    for (const schema of semanticCorpus) {
      const generated = dialectAgnosticSchema(
        zodToJsonSchema(schema) as Record<string, unknown>,
      );
      const validate = ajv.compile(generated);
      assertProperty(
        fc.property(fc.jsonValue(), (value) => {
          const zodAccepted = schema.safeParse(value).success;
          const jsonSchemaAccepted = validate(value) as boolean;
          if (zodAccepted !== jsonSchemaAccepted) {
            throw new Error(
              `semantic mismatch for ${json(generated)} on ${json(value)}: Zod=${zodAccepted}, JSON Schema=${jsonSchemaAccepted}; ${ajv.errorsText(validate.errors)}`,
            );
          }
        }),
        Math.max(100, Math.floor(stressRuns / semanticCorpus.length)),
      );
    }
    assert(true);
  });

  test("OpenAI output closes every object and requires every property", (assert) => {
    const schema = z4.object({
      id: z4.string(),
      profile: z4.object({
        nickname: z4.string().optional(),
        flags: z4.array(z4.object({ enabled: z4.boolean().optional() })),
      }).optional(),
    });
    const generated = zodToJsonSchema(schema, { target: "openAi" });
    let objectCount = 0;
    visitObjects(generated, (object) => {
      if (object.type !== "object" || typeof object.properties !== "object" || object.properties === null) return;
      objectCount += 1;
      const keys = Object.keys(object.properties);
      if (json(object.required) !== json(keys)) throw new Error("OpenAI required keys are incomplete");
      if (object.additionalProperties !== false) throw new Error("OpenAI object is not closed");
    });
    assert(objectCount, 3);
  });

  test("recursive and reused schemas compile and preserve references", (assert) => {
    type Node = { value: string; children: Node[] };
    const node: z4.ZodType<Node> = z4.lazy(() =>
      z4.object({ value: z4.string(), children: z4.array(node) }),
    );
    const shared = z4.object({ token: z4.string().min(1) });
    const root = z4.object({ tree: node, left: shared, right: shared });
    const generated = dialectAgnosticSchema(
      zodToJsonSchema(root, { $refStrategy: "root" }) as Record<string, unknown>,
    );
    const serialized = json(generated);
    assert(serialized.includes("$ref"), true);
    const validate = ajv.compile(generated);
    assert(validate({
      tree: { value: "root", children: [{ value: "leaf", children: [] }] },
      left: { token: "a" },
      right: { token: "b" },
    }), true);
  });

  test("wide, deep, and union-heavy schemas convert without blowups", (assert) => {
    const wideShape: Record<string, z4.ZodType> = {};
    for (let index = 0; index < 1500; index += 1) wideShape[`field_${index}`] = z4.string().optional();
    let deep: z4.ZodType = z4.string();
    for (let index = 0; index < 120; index += 1) deep = z4.object({ child: deep });
    const union = z4.union(
      Array.from({ length: 100 }, (_, index) => z4.literal(`choice_${index}`)) as [
        z4.ZodLiteral<string>,
        z4.ZodLiteral<string>,
        ...z4.ZodLiteral<string>[],
      ],
    );
    const started = performance.now();
    const wide = zodToJsonSchema(z4.object(wideShape));
    const nested = zodToJsonSchema(deep);
    const manyChoices = zodToJsonSchema(union);
    const elapsed = performance.now() - started;
    assert(Object.keys((wide as any).properties).length, 1500);
    assert(json(nested).length > 1000);
    const validateChoice = ajv.compile(dialectAgnosticSchema(manyChoices as Record<string, unknown>));
    assert(validateChoice("choice_99"), true);
    assert(validateChoice("choice_100"), false);
    assert(elapsed < 10_000, true);
  });

  test("conversion is deterministic across repeated runs", (assert) => {
    const schema = z4.object({
      id: z4.string().uuid(),
      payload: z4.union([z4.string(), z4.array(z4.number()), z4.null()]),
      metadata: z4.record(z4.string(), z4.string()).optional(),
    });
    const first = json(zodToJsonSchema(schema, { name: "Envelope", target: "openAi" }));
    for (let index = 0; index < 500; index += 1) {
      if (json(zodToJsonSchema(schema, { name: "Envelope", target: "openAi" })) !== first) {
        throw new Error(`non-deterministic output at repetition ${index}`);
      }
    }
    assert(true);
  });
});

#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Targets } from "./Options.js";
import { convertZodSchema } from "./zodToJsonSchema.js";
import { migrateRepository } from "./migrate.js";

const HELP = `zod-schema-bridge <module> [options]
zod-schema-bridge migrate [directory] [--write] [--check] [--force] [--json]

Convert a Zod schema exported by a JavaScript module.

Options:
  --export <name>       Export name (default: default)
  --target <target>     jsonSchema7, jsonSchema2019-09, openApi3, or openAi
  --name <name>         Wrap the schema in a named definition
  --out <file>          Write JSON to a file instead of stdout
  --diagnostics         Print conversion diagnostics to stderr
  -h, --help            Show this help

Migration options:
  --write               Apply safe import and dependency rewrites
  --check               Exit non-zero when deterministic changes are needed
  --force               Permit writes in a dirty Git worktree
  --json                Print a machine-readable migration report
`;

type CliOptions = {
  modulePath?: string;
  exportName: string;
  target: Targets;
  name?: string;
  out?: string;
  diagnostics: boolean;
};

const targets = new Set<Targets>([
  "jsonSchema7",
  "jsonSchema2019-09",
  "openApi3",
  "openAi",
]);

const takeValue = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = {
    exportName: "default",
    target: "jsonSchema7",
    diagnostics: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === "--diagnostics") {
      options.diagnostics = true;
      continue;
    }
    if (arg === "--export") {
      options.exportName = takeValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--target") {
      const target = takeValue(args, index, arg) as Targets;
      if (!targets.has(target)) throw new Error(`Unknown target: ${target}`);
      options.target = target;
      index += 1;
      continue;
    }
    if (arg === "--name") {
      options.name = takeValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = takeValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (options.modulePath) throw new Error("Only one module path is allowed");
    options.modulePath = arg;
  }

  if (!options.modulePath) throw new Error("A schema module path is required");
  return options;
};

const main = async () => {
  if (process.argv[2] === "migrate") {
    const args = process.argv.slice(3);
    const write = args.includes("--write");
    const check = args.includes("--check");
    const force = args.includes("--force");
    const json = args.includes("--json");
    const unknown = args.find(
      (arg) =>
        arg.startsWith("-") &&
        !["--write", "--check", "--force", "--json"].includes(arg),
    );
    if (unknown) throw new Error(`Unknown migration option: ${unknown}`);
    const directories = args.filter((arg) => !arg.startsWith("-"));
    if (directories.length > 1) throw new Error("Only one migration directory is allowed");
    const report = await migrateRepository(directories[0] ?? ".", { write, force });
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${write ? "Migrated" : "Scanned"} ${report.filesScanned} files; ${report.filesChanged} files ${write ? "changed" : "would change"}.\n`,
      );
      for (const finding of report.findings) {
        process.stdout.write(
          `${finding.severity.toUpperCase()} ${finding.file}:${finding.line} ${finding.message}\n`,
        );
      }
    }
    if (check && report.filesChanged > 0) process.exitCode = 1;
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const moduleUrl = pathToFileURL(resolve(options.modulePath!)).href;
  const loaded = (await import(moduleUrl)) as Record<string, unknown>;
  const schema = loaded[options.exportName];
  if (!schema) {
    throw new Error(
      `Export ${JSON.stringify(options.exportName)} was not found in ${options.modulePath}`,
    );
  }

  const result = convertZodSchema(schema as any, {
    target: options.target,
    ...(options.name ? { name: options.name } : {}),
  });
  const json = `${JSON.stringify(result.schema, null, 2)}\n`;

  if (options.diagnostics) {
    for (const diagnostic of result.diagnostics) {
      process.stderr.write(
        `[${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}\n`,
      );
    }
  }

  if (options.out) {
    await writeFile(resolve(options.out), json, "utf8");
  } else {
    process.stdout.write(json);
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`zod-schema-bridge: ${message}\n`);
  process.exitCode = 1;
});

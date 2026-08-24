import { execFile } from "node:child_process";
import { chmod, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MigrationFinding = {
  file: string;
  line: number;
  severity: "change" | "review";
  code: "legacy-import" | "legacy-dependency" | "unrepresentable-zod4" | "legacy-option";
  message: string;
};

export type MigrationReport = {
  root: string;
  filesScanned: number;
  filesChanged: number;
  findings: MigrationFinding[];
  wroteChanges: boolean;
};

export type MigrationOptions = { write?: boolean; force?: boolean };

type Token = {
  kind: "identifier" | "string" | "punctuation";
  value: string;
  start: number;
  end: number;
};

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);
const unrepresentableTypes = new Set(["date", "map", "set", "bigint", "symbol", "undefined", "void", "nan", "custom"]);
const transformMethods = new Set(["transform", "pipe", "preprocess"]);
const legacyOptions = new Set(["override", "postProcess", "effectStrategy", "dateStrategy", "mapStrategy", "removeAdditionalStrategy", "strictUnions"]);

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const isIdentifierStart = (character: string) => /[A-Za-z_$]/.test(character);
const isIdentifierPart = (character: string) => /[A-Za-z0-9_$]/.test(character);

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      if (quote !== "`") {
        tokens.push({ kind: "string", value: source.slice(start + 1, index - 1), start, end: index });
      }
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index]!)) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index), start, end: index });
      continue;
    }
    tokens.push({ kind: "punctuation", value: character, start: index, end: index + 1 });
    index += 1;
  }
  return tokens;
};

const isModuleSpecifier = (tokens: Token[], index: number): boolean => {
  const previous = tokens[index - 1];
  const beforePrevious = tokens[index - 2];
  const next = tokens[index + 1];
  if (previous?.kind === "identifier" && previous.value === "from") return true;
  if (previous?.kind === "identifier" && previous.value === "import") return true;
  return previous?.value === "(" && next?.value === ")" &&
    beforePrevious?.kind === "identifier" && (beforePrevious.value === "require" || beforePrevious.value === "import");
};

const migrateSource = (source: string, file: string): { source: string; findings: MigrationFinding[] } => {
  const tokens = tokenize(source);
  const findings: MigrationFinding[] = [];
  const replacements: { start: number; end: number }[] = [];

  tokens.forEach((token, index) => {
    if (token.kind === "string" && token.value === "zod-to-json-schema" && isModuleSpecifier(tokens, index)) {
      replacements.push({ start: token.start + 1, end: token.end - 1 });
      findings.push({ file, line: lineOf(source, token.start), severity: "change", code: "legacy-import", message: "Replace the legacy package module specifier with zod-schema-bridge." });
    }

    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];
    if (token.value === "." && next?.kind === "identifier" && transformMethods.has(next.value) && afterNext?.value === "(") {
      findings.push({ file, line: lineOf(source, token.start), severity: "review", code: "unrepresentable-zod4", message: "Transforms and pipelines can have different input/output schemas." });
    }
    if ((token.value === "z" || token.value === "zod") && next?.value === "." && afterNext?.kind === "identifier" && unrepresentableTypes.has(afterNext.value) && tokens[index + 3]?.value === "(") {
      findings.push({ file, line: lineOf(source, token.start), severity: "review", code: "unrepresentable-zod4", message: `Zod type ${afterNext.value} may not be representable as JSON Schema.` });
    }
    if (token.kind === "identifier" && legacyOptions.has(token.value) && next?.value === ":") {
      findings.push({ file, line: lineOf(source, token.start), severity: "review", code: "legacy-option", message: `Review legacy option ${JSON.stringify(token.value)} when converting genuine Zod 4 schemas.` });
    }
  });

  let migrated = source;
  for (const replacement of replacements.reverse()) {
    migrated = `${migrated.slice(0, replacement.start)}zod-schema-bridge${migrated.slice(replacement.end)}`;
  }
  return { source: migrated, findings };
};

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(path));
    } else if (entry.name === "package.json" || sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
};

const assertSafeToWrite = async (root: string, force: boolean) => {
  if (force) return;
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"]);
    const { stdout } = await execFileAsync("git", ["-C", root, "status", "--porcelain"]);
    if (stdout.trim()) {
      throw new Error("Refusing to modify a dirty Git worktree. Commit/stash changes or pass --force.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
  }
};

const atomicWrite = async (file: string, contents: string) => {
  const metadata = await stat(file);
  const temporary = join(dirname(file), `.${basename(file)}.zsb-${process.pid}`);
  await writeFile(temporary, contents, { encoding: "utf8", mode: metadata.mode });
  await chmod(temporary, metadata.mode);
  await rename(temporary, file);
};

export const migrateRepository = async (
  directory: string,
  options: MigrationOptions = {},
): Promise<MigrationReport> => {
  const root = resolve(directory);
  if (options.write) await assertSafeToWrite(root, options.force === true);
  const files = await walk(root);
  const findings: MigrationFinding[] = [];
  let filesChanged = 0;

  for (const file of files) {
    const original = await readFile(file, "utf8");
    let migrated = original;
    const displayFile = relative(root, file) || "package.json";

    if (file.endsWith("package.json")) {
      try {
        const manifest = JSON.parse(original) as Record<string, any>;
        let changed = false;
        for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          const dependencies = manifest[section] as Record<string, string> | undefined;
          if (!dependencies?.["zod-to-json-schema"]) continue;
          delete dependencies["zod-to-json-schema"];
          dependencies["zod-schema-bridge"] = "^0.2.0";
          changed = true;
          findings.push({ file: displayFile, line: 1, severity: "change", code: "legacy-dependency", message: `Replace zod-to-json-schema in ${section}.` });
        }
        if (changed) migrated = `${JSON.stringify(manifest, null, 2)}\n`;
      } catch {}
    } else {
      const result = migrateSource(original, displayFile);
      migrated = result.source;
      findings.push(...result.findings);
    }

    if (migrated !== original) {
      filesChanged += 1;
      if (options.write) await atomicWrite(file, migrated);
    }
  }

  return { root, filesScanned: files.length, filesChanged, findings, wroteChanges: options.write === true };
};

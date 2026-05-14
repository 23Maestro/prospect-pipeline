#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = join(REPO_ROOT, 'src/generated/code-index.generated.json');
const TS_ROOTS = ['src', 'apps/prospect-web'];
const PYTHON_ROUTER_ROOT = 'npid-api-layer/app/routers';
const SCRIPT_ROOT = 'scripts';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  'venv',
  '__pycache__',
  'generated',
]);

function toPosix(path) {
  return path.split('\\').join('/');
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function listFiles(root, extensions) {
  const absoluteRoot = join(REPO_ROOT, root);
  if (!existsSync(absoluteRoot)) return [];

  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      if (IGNORED_DIRS.has(entry)) return [];
      const absolute = join(dir, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) return walk(absolute);
      if (!extensions.has(extname(entry))) return [];
      return [toPosix(relative(REPO_ROOT, absolute))];
    });

  return walk(absoluteRoot).sort();
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function sourceLine(text, line) {
  return text.split(/\r?\n/)[line - 1]?.trim() || '';
}

function stableId(record) {
  return [
    record.kind,
    record.system,
    record.file,
    record.line,
    record.method || '',
    record.path || '',
    record.name,
  ]
    .join(':')
    .replace(/[^a-zA-Z0-9:._/-]+/g, '-')
    .replace(/-+/g, '-');
}

function classifySystem(file) {
  if (file.startsWith('apps/prospect-web/')) return 'Vercel';
  if (file.startsWith('npid-api-layer/')) return 'FastAPI';
  if (file.startsWith('scripts/')) return 'Scripts';
  if (file.startsWith('src/domain/')) return 'Domain';
  if (
    file.endsWith('.tsx') ||
    file.startsWith('src/components/') ||
    file.startsWith('src/features/')
  ) {
    return 'Raycast';
  }
  return 'Raycast';
}

function classifyBucket(file, name, kind, tags = []) {
  const haystack = `${file} ${name} ${tags.join(' ')}`.toLowerCase();
  if (kind === 'route')
    return file.startsWith('apps/prospect-web/') ? 'Vercel API route' : 'FastAPI route';
  if (kind === 'api_call') {
    if (haystack.includes('supabase')) return 'Supabase persistence';
    if (
      haystack.includes('fastapi') ||
      haystack.includes('apifetch') ||
      haystack.includes('apirootfetch')
    ) {
      return 'Laravel/FastAPI adapter';
    }
    return 'API call';
  }
  if (file.startsWith('scripts/')) return 'Script/sync job';
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx') || file.endsWith('.test.mjs'))
    return 'Test/helper';
  if (file.startsWith('src/domain/')) return 'Domain logic';
  if (file.startsWith('src/lib/supabase') || haystack.includes('supabase'))
    return 'Supabase persistence';
  if (file.startsWith('src/lib/fastapi') || haystack.includes('apifetch'))
    return 'Laravel/FastAPI adapter';
  if (file.endsWith('.tsx')) return 'Raycast UI';
  return 'Domain logic';
}

function makeRecord(record) {
  const normalized = {
    exported: false,
    tags: [],
    snippet: '',
    signature: '',
    ...record,
  };
  normalized.tags = Array.from(new Set(normalized.tags.filter(Boolean)));
  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === undefined) delete normalized[key];
  });
  normalized.id = stableId(normalized);
  return normalized;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function nameOf(node) {
  if (node.name?.escapedText) return String(node.name.escapedText);
  if (node.name?.text) return String(node.name.text);
  return null;
}

function isFunctionLikeInitializer(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function scanTsFunctions(file) {
  const absolute = join(REPO_ROOT, file);
  const text = readText(absolute);
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const records = [];

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node)) {
      const name = nameOf(node) || (hasExportModifier(node) ? 'default' : null);
      if (name) {
        const line = lineOf(sourceFile, node);
        const tags = [];
        if (hasExportModifier(node)) tags.push('exported');
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) tags.push('test');
        records.push(
          makeRecord({
            kind: 'function',
            name,
            file,
            line,
            system: classifySystem(file),
            bucket: classifyBucket(file, name, 'function', tags),
            exported: hasExportModifier(node),
            tags,
            snippet: sourceLine(text, line),
            signature: sourceLine(text, line),
          }),
        );
      }
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        if (!declaration.initializer || !isFunctionLikeInitializer(declaration.initializer))
          continue;
        const name = nameOf(declaration);
        if (!name) continue;
        const line = lineOf(sourceFile, declaration);
        const tags = [];
        if (exported) tags.push('exported');
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) tags.push('test');
        records.push(
          makeRecord({
            kind: 'function',
            name,
            file,
            line,
            system: classifySystem(file),
            bucket: classifyBucket(file, name, 'function', tags),
            exported,
            tags,
            snippet: sourceLine(text, line),
            signature: sourceLine(text, line),
          }),
        );
      }
    }

    if (ts.isMethodDeclaration(node)) {
      const name = nameOf(node);
      if (name) {
        const line = lineOf(sourceFile, node);
        const tags = ['method'];
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) tags.push('test');
        records.push(
          makeRecord({
            kind: 'function',
            name,
            file,
            line,
            system: classifySystem(file),
            bucket: classifyBucket(file, name, 'function', tags),
            exported: false,
            tags,
            snippet: sourceLine(text, line),
            signature: sourceLine(text, line),
          }),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return records;
}

function literalArgumentText(node, sourceFile) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(sourceFile);
  return null;
}

function scanTsApiCalls(file) {
  const absolute = join(REPO_ROOT, file);
  const text = readText(absolute);
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const records = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(sourceFile);
      const callName = expression.split('.').pop();
      if (
        ['apiFetch', 'apiRootFetch', 'fetch', 'prospectFetch', 'callPythonServer'].includes(
          callName,
        )
      ) {
        const line = lineOf(sourceFile, node);
        const path = literalArgumentText(node.arguments[0], sourceFile);
        const tags = [callName];
        if (callName === 'fetch') tags.push('fetch');
        if (path?.includes('supabase')) tags.push('Supabase');
        records.push(
          makeRecord({
            kind: 'api_call',
            name: path ? `${callName} ${path}` : callName,
            file,
            line,
            system: classifySystem(file),
            bucket: classifyBucket(file, callName, 'api_call', tags),
            exported: false,
            tags,
            path: path || undefined,
            snippet: sourceLine(text, line),
            signature: sourceLine(text, line),
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return records;
}

function scanNextRoutes(file) {
  if (!file.startsWith('apps/prospect-web/app/api/') || !file.endsWith('/route.ts')) return [];
  const absolute = join(REPO_ROOT, file);
  const text = readText(absolute);
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const routePath = `/${file
    .replace(/^apps\/prospect-web\/app\/api\//, 'api/')
    .replace(/\/route\.ts$/, '')}`;
  const records = [];

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && hasExportModifier(node)) {
      const method = nameOf(node);
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const line = lineOf(sourceFile, node);
        records.push(
          makeRecord({
            kind: 'route',
            name: `${method} ${routePath}`,
            file,
            line,
            system: 'Vercel',
            bucket: 'Vercel API route',
            exported: true,
            tags: ['route', method, 'Next.js'],
            method,
            path: routePath,
            snippet: sourceLine(text, line),
            signature: sourceLine(text, line),
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return records;
}

function scanPythonRoutes(file) {
  const text = readText(join(REPO_ROOT, file));
  const lines = text.split(/\r?\n/);
  const records = [];
  const pending = [];

  lines.forEach((line, index) => {
    const decorator = line.match(/^\s*@router\.(get|post|put|patch|delete)\(([^)]*)\)/);
    if (decorator) {
      const method = decorator[1].toUpperCase();
      const pathMatch = decorator[2].match(/["']([^"']*)["']/);
      pending.push({ method, path: pathMatch?.[1] || '', line: index + 1 });
      return;
    }

    const handler = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!handler || pending.length === 0) return;

    for (const route of pending.splice(0)) {
      records.push(
        makeRecord({
          kind: 'route',
          name: `${route.method} ${route.path || '/'}`,
          file,
          line: route.line,
          system: 'FastAPI',
          bucket: 'FastAPI route',
          exported: false,
          tags: ['route', route.method, 'FastAPI', handler[1]],
          method: route.method,
          path: route.path || '/',
          snippet: lines[route.line - 1].trim(),
          signature: line.trim(),
        }),
      );
    }
  });

  return records;
}

function scanScriptFile(file) {
  const text = readText(join(REPO_ROOT, file));
  const lines = text.split(/\r?\n/);
  const records = [];

  lines.forEach((line, index) => {
    const functionMatch =
      line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/) ||
      line.match(/^\s*const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/);
    if (functionMatch) {
      const name = functionMatch[1];
      records.push(
        makeRecord({
          kind: 'function',
          name,
          file,
          line: index + 1,
          system: 'Scripts',
          bucket: 'Script/sync job',
          exported: false,
          tags: ['script'],
          snippet: line.trim(),
          signature: line.trim(),
        }),
      );
    }

    for (const callName of ['apiFetch', 'fetch']) {
      const callIndex = line.indexOf(`${callName}(`);
      if (callIndex === -1) continue;
      const pathMatch = line.slice(callIndex).match(/\(\s*["'`]([^"'`]+)["'`]/);
      const path = pathMatch?.[1];
      records.push(
        makeRecord({
          kind: 'api_call',
          name: path ? `${callName} ${path}` : callName,
          file,
          line: index + 1,
          system: 'Scripts',
          bucket: classifyBucket(file, callName, 'api_call', [callName]),
          exported: false,
          tags: [callName, 'script'],
          path,
          snippet: line.trim(),
          signature: line.trim(),
        }),
      );
    }
  });

  return records;
}

export function generateCodeIndex() {
  const tsFiles = TS_ROOTS.flatMap((root) => listFiles(root, new Set(['.ts', '.tsx']))).filter(
    (file) => !file.includes('/generated/'),
  );
  const pythonFiles = listFiles(PYTHON_ROUTER_ROOT, new Set(['.py']));
  const scriptFiles = listFiles(SCRIPT_ROOT, new Set(['.mjs']));

  const records = [
    ...tsFiles.flatMap((file) => [
      ...scanTsFunctions(file),
      ...scanTsApiCalls(file),
      ...scanNextRoutes(file),
    ]),
    ...pythonFiles.flatMap(scanPythonRoutes),
    ...scriptFiles.flatMap(scanScriptFile),
  ];

  const unique = new Map();
  for (const record of records) unique.set(record.id, record);

  return Array.from(unique.values()).sort((a, b) =>
    `${a.system}:${a.kind}:${a.file}:${a.line}:${a.name}`.localeCompare(
      `${b.system}:${b.kind}:${b.file}:${b.line}:${b.name}`,
    ),
  );
}

export function writeCodeIndex(outputPath = OUTPUT_PATH) {
  const records = generateCodeIndex();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`);
  return records;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const records = writeCodeIndex();
  console.log(`Wrote ${relative(REPO_ROOT, OUTPUT_PATH)} (${records.length} records)`);
}

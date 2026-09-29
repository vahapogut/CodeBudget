import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';
import type { ImportReference, IndexedFile, SourceSymbol } from './types.js';

const require = createRequire(import.meta.url);
let ready: Promise<Map<string, Language>> | undefined;

export const PARSER_VERSION = 'web-tree-sitter@0.27.0/javascript@0.25.0/typescript@0.23.2/schema1';

export async function loadLanguages(): Promise<Map<string, Language>> {
  ready ??= (async () => {
    const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets');
    const bundledRuntime = join(assets, 'web-tree-sitter.wasm');
    await Parser.init(existsSync(bundledRuntime) ? { locateFile: () => bundledRuntime } : undefined);
    const languages = new Map<string, Language>();
    for (const language of ['javascript', 'typescript', 'tsx']) {
      const packageName = language === 'javascript' ? 'tree-sitter-javascript' : 'tree-sitter-typescript';
      const bundledGrammar = join(assets, `tree-sitter-${language}.wasm`);
      languages.set(language, await Language.load(existsSync(bundledGrammar) ? bundledGrammar : require.resolve(`${packageName}/tree-sitter-${language}.wasm`)));
    }
    return languages;
  })();
  return ready;
}

export function languageFor(path: string): IndexedFile['language'] {
  const extension = extname(path).toLowerCase();
  if (['.ts', '.mts', '.cts'].includes(extension)) return 'typescript';
  if (extension === '.tsx') return 'tsx';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return 'javascript';
  return 'text';
}

export function parseSource(path: string, source: string, languages: Map<string, Language>): Pick<IndexedFile, 'language' | 'symbols' | 'imports' | 'parseErrors'> {
  const language = languageFor(path);
  if (language === 'text') return { language, symbols: [], imports: [], parseErrors: false };
  const parser = new Parser();
  parser.setLanguage(languages.get(language) ?? null);
  const tree = parser.parse(source);
  if (!tree) { parser.delete(); throw new Error(`Tree-sitter failed to parse ${path}`); }
  try {
    const symbols: SourceSymbol[] = [];
    const imports: ImportReference[] = [];
    const declarations = new Set(['function_declaration', 'generator_function_declaration', 'class_declaration', 'abstract_class_declaration', 'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'lexical_declaration', 'variable_declaration']);
    for (const top of tree.rootNode.namedChildren) {
      const exported = top.type === 'export_statement';
      const declaration = exported ? top.namedChildren.find((child) => declarations.has(child.type)) : top;
      if (declaration && declarations.has(declaration.type)) {
        const named = declaration.childForFieldName('name') ?? declaration.namedChildren.find((child) => child.type === 'variable_declarator')?.childForFieldName('name');
        const body = declaration.childForFieldName('body');
        const signature = body ? source.slice(top.startIndex, body.startIndex).trim() : top.text.split('\n')[0] ?? '';
        symbols.push({ name: named?.text ?? 'default', kind: declaration.type, signature, body: top.text, startLine: top.startPosition.row + 1, endLine: top.endPosition.row + 1, exported });
      }
    }
    const visit = (node: Node): void => {
      if (node.type === 'import_statement' || node.type === 'export_statement') {
        const from = node.childForFieldName('source');
        if (from) imports.push({ source: from.text.slice(1, -1), statement: node.text, dynamic: false, confidence: 'syntax' });
      }
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (fn?.text === 'import' || fn?.text === 'require') {
          const argument = node.childForFieldName('arguments')?.namedChildren[0];
          imports.push({ source: argument?.type === 'string' ? argument.text.slice(1, -1) : '<unresolved>', statement: node.text, dynamic: true, confidence: 'heuristic' });
        }
      }
      for (const child of node.namedChildren) visit(child);
    };
    visit(tree.rootNode);
    return { language, symbols, imports, parseErrors: tree.rootNode.hasError };
  } finally {
    tree.delete();
    parser.delete();
  }
}

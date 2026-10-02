import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogDir = path.join(root, 'src/i18n/catalogs');
const locales = ['en', 'zh-CN'];
const placeholders = text => [...text.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g)].map(match => match[1]);
const forms = value => typeof value === 'string' ? [value] : Object.values(value);
export async function readCatalog() {
  const files = (await readdir(catalogDir)).filter(file => file.endsWith('.json')).sort();
  const entries = {}, owners = {};
  for (const file of files) {
    const source = await readFile(path.join(catalogDir, file), 'utf8');
    const group = JSON.parse(source);
    walk(parse('(' + source + ')'), node => {
      if (node.type !== 'ObjectExpression') return;
      const keys = new Set();
      for (const property of node.properties) {
        const key = property.key.value ?? property.key.name;
        if (keys.has(key)) throw new Error(`Duplicate JSON property: ${file} / ${key}`);
        keys.add(key);
      }
    });
    for (const [key, entry] of Object.entries(group)) {
      if (entries[key]) throw new Error(`Duplicate message key: ${key}`);
      if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(key)) throw new Error(`Invalid message key: ${key}`);
      const parameterSets = [];
      for (const locale of locales) {
        const value = entry[locale];
        if (typeof value !== 'string' && (!value || Array.isArray(value) || !value.other || Object.keys(value).some(form => !['zero','one','two','few','many','other'].includes(form)))) throw new Error(`Missing text/plural fallback: ${key} (${locale})`);
        if (forms(value).some(text => typeof text !== 'string' || !text.length && !entry.allowEmpty)) throw new Error(`Empty text: ${key} (${locale})`);
        parameterSets.push([...new Set(forms(value).flatMap(placeholders))].sort());
      }
      const allParameters = [...new Set(parameterSets.flat())].sort();
      for (const [index, locale] of locales.entries()) {
        const missing = allParameters.filter(name => !parameterSets[index].includes(name));
        if (JSON.stringify(missing) !== JSON.stringify((entry.omitParameters?.[locale] ?? []).slice().sort())) throw new Error(`Parameters differ between languages: ${key} (${locale})`);
      }
      if (!entry.context || !['translated','pending','keep'].includes(entry.review)) throw new Error(`Missing review status/context: ${key}`);
      if (JSON.stringify(entry.en) === JSON.stringify(entry['zh-CN']) && entry.review === 'translated') throw new Error(`Identical text needs pending/keep status: ${key}`);
      if (allParameters.some(name => ['lng','ns','defaultValue','fallbackLng','interpolation','keySeparator','returnObjects'].includes(name))) throw new Error(`Reserved interpolation parameter: ${key}`);
      entries[key] = entry; owners[key] = `src/i18n/catalogs/${file}`;
    }
  }
  return { files, entries, owners };
}
export function walk(node, visit, parent, field) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parent, field);
  for (const [key, value] of Object.entries(node)) {
    if (['loc','extra','comments','tokens'].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit, node, key);
    else if (value?.type) walk(value, visit, node, key);
  }
}
export async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (file !== 'src/i18n') files.push(...await sourceFiles(file)); }
    else if (/\.tsx?$/.test(file) && !file.endsWith('.d.ts')) files.push(file);
  }
  return files.sort();
}
export async function scanReferences(entries, { onHardcoded } = {}) {
  const references = new Map(Object.keys(entries).map(key => [key, []]));
  const hardcoded = [];
  for (const file of [...await sourceFiles('src'), ...await sourceFiles('webview')]) {
    const source = await readFile(path.join(root, file), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const parents = new WeakMap(); walk(ast, (node, parent) => parents.set(node, parent));
    walk(ast, (node, parent, field) => {
      if (node.type === 'StringLiteral' && references.has(node.value)) { references.get(node.value).push(`${file}:${node.loc.start.line}`); return; }
      const callee = node.callee?.name ?? node.callee?.property?.name;
      if (node.type === 'CallExpression' && ['t','translate','hostText','message','localizeMessage','uiText','text'].includes(callee)) {
        const offset = ['translate','hostText'].includes(callee) ? 1 : 0;
        const key = node.arguments[offset];
        if (key?.type === 'StringLiteral' && !entries[key.value]) throw new Error(`Unknown message key: ${file}:${key.loc.start.line} ${key.value}`);
      }
      if (file === 'webview/demo.ts') return;
      let sink = node.type === 'JSXText';
      if (node.type === 'StringLiteral') sink = parent?.type === 'JSXAttribute' && ['title','aria-label','placeholder','alt','label'].includes(parent.name.name)
        || parent?.type === 'ObjectProperty' && field === 'value' && ['title','label','description','prompt','detail','tooltip'].includes(parent.key.name ?? parent.key.value)
        || parent?.type === 'NewExpression' && parent.arguments[0] === node && /Error$/.test(parent.callee.name);
      if (node.type === 'StringLiteral' && /[A-Z][a-z]+(?:\s|[.:?…])|[\u3400-\u9fff]/.test(node.value) && !/^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)+$/.test(node.value)) {
        sink = true;
        for (let ancestor = parent; ancestor; ancestor = parents.get(ancestor)) {
          if (ancestor.type.startsWith('Import') || ancestor.type.startsWith('TS') && !['TSAsExpression','TSNonNullExpression','TSSatisfiesExpression'].includes(ancestor.type)) { sink = false; break; }
        }
        if (parent?.type === 'ObjectProperty' && field === 'key' || parent?.type === 'BinaryExpression' && parent.operator !== '+') sink = false;
      }
      if (node.type === 'TemplateLiteral' && /[A-Z][a-z]+\s|[\u3400-\u9fff]/.test(node.quasis.map(part => part.value.cooked).join(''))) {
        sink = true;
        for (let ancestor = parent; ancestor; ancestor = parents.get(ancestor)) {
          if (ancestor.type === 'JSXAttribute' && !['title','aria-label','placeholder','alt','label'].includes(ancestor.name.name)) { sink = false; break; }
          if (ancestor.type === 'TaggedTemplateExpression') { sink = false; break; }
        }
      }
      if (sink) {
        const value = node.type === 'TemplateLiteral' ? node.quasis.map(part => part.value.cooked).join('') : node.value;
        const text = value?.replace(/\s+/g, ' ').trim();
        // Product names, Git identifiers and pixel units are syntax/data, not authored copy.
        if (text && /[a-zA-Z\u3400-\u9fff]/.test(text) && !['AlwayGit','HEAD','px'].includes(text)) {
          const occurrence = { file, line: node.loc.start.line, start: node.start, end: node.end, type: node.type, text };
          if (onHardcoded) onHardcoded(occurrence); else hardcoded.push(occurrence);
        }
      }
    });
  }
  if (hardcoded.length) throw new Error('Hardcoded display text:\n' + hardcoded.map(item => `${item.file}:${item.line} ${JSON.stringify(item.text)}`).join('\n'));
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const visit = value => { if (typeof value === 'string' && /^%.*%$/.test(value)) { const key = value.slice(1,-1); if (!references.has(key)) throw new Error(`Unknown manifest message: ${key}`); references.get(key).push('package.json'); } else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
  visit(manifest);
  return references;
}
export async function generate(check = false) {
  const { files, entries } = await readCatalog();
  const fields = Object.entries(entries).map(([key, entry]) => {
    const names = [...new Set(locales.flatMap(locale => forms(entry[locale]).flatMap(placeholders)))];
    if (typeof entry.en !== 'string' || typeof entry['zh-CN'] !== 'string') { if (!names.includes('count')) names.push('count'); }
    return `  ${JSON.stringify(key)}: { ${names.map(name => `${name}: ${name === 'count' ? 'number' : 'ParameterValue'}`).join('; ')} };`;
  }).join('\n');
  const runtime = Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, { en: entry.en, 'zh-CN': entry['zh-CN'] }]));
  const outputs = { 'src/i18n/generated.ts': `// Generated by scripts/i18n.mjs; edit catalogs instead.\nimport type { ParameterValue } from './index';\nexport const catalog = ${JSON.stringify(runtime, null, 2)} as const;\nexport interface MessageParameters {\n${fields}\n}\n` };
  for (const locale of locales) outputs[locale === 'en' ? 'package.nls.json' : 'package.nls.zh-cn.json'] = JSON.stringify(Object.fromEntries(Object.entries(entries).filter(([key]) => key.startsWith('manifest.')).map(([key, entry]) => [key, entry[locale]])), null, 2) + '\n';
  for (const [file, contents] of Object.entries(outputs)) {
    const current = await readFile(path.join(root, file), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (current !== contents) { if (check) throw new Error(`Generated file is stale: ${file}; run npm run i18n:generate`); await writeFile(path.join(root, file), contents); }
  }
  return entries;
}
async function main() {
  const mode = process.argv[2] ?? 'check';
  if (mode === 'generate') { await generate(); return; }
  const { entries, owners } = await readCatalog();
  await generate(true);
  const references = await scanReferences(entries);
  if (mode === 'export') {
    const output = path.resolve(process.argv[3] ?? path.join(root, 'artifacts/copy-review.csv'));
    const cell = value => '"' + String(value).replaceAll('"','""') + '"';
    const rows = [['key','en','zh-CN','review','context','resource','references'], ...Object.entries(entries).map(([key, entry]) => [key, typeof entry.en === 'string' ? entry.en : JSON.stringify(entry.en), typeof entry['zh-CN'] === 'string' ? entry['zh-CN'] : JSON.stringify(entry['zh-CN']), entry.review, entry.context, owners[key], references.get(key).join('\n')])];
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n');
    console.log(`Exported ${Object.keys(entries).length} messages: ${output}`); return;
  }
  if (mode !== 'check') throw new Error(`Unknown i18n mode: ${mode}`);
  const unused = [...references].filter(([, locations]) => !locations.length).map(([key]) => key);
  if (unused.length) throw new Error(`Unused messages: ${unused.join(', ')}`);
  console.log(`Validated ${Object.keys(entries).length} bilingual messages and generated files.`);
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();

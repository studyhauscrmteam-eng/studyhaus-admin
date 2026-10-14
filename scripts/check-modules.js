// Module resolution checker for browser ES modules
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDE_DIRS = ['node_modules', 'migration'];

function walk(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (/\.(js|mjs|html)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk(ROOT);
console.log(`Scanning ${files.length} files...\n`);

// 1. Check imports in .js files
const importRegex = /(?:import|export)\s+(?:[\w*{},\s]+?\s+from\s+)?['"]([^'"]+)['"]/g;
const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

const issues = [];
const importMap = {};

for (const file of files) {
  if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const relFile = path.relative(ROOT, file);

  let match;
  const allImports = [];

  // static imports/exports
  while ((match = importRegex.exec(content)) !== null) {
    allImports.push({ spec: match[1], type: 'static' });
  }
  // dynamic imports
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    allImports.push({ spec: match[1], type: 'dynamic' });
  }

  for (const imp of allImports) {
    const spec = imp.spec;

    // skip bare specifiers (node modules, firebase, etc.)
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // Track firebase imports for import map check
      if (spec.startsWith('firebase/')) {
        importMap[spec] = importMap[spec] || [];
        importMap[spec].push(relFile);
      }
      continue;
    }

    // Resolve the path
    const fileDir = path.dirname(file);
    let resolved = path.resolve(fileDir, spec);

    // Check if exists as-is (with extension)
    let exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();

    if (!exists) {
      // Check if missing extension
      if (!path.extname(resolved)) {
        issues.push({
          file: relFile,
          import: spec,
          issue: 'MISSING_EXTENSION',
          detail: 'Import has no file extension - will fail in browser ES modules'
        });
        // Try with .js
        if (fs.existsSync(resolved + '.js')) {
          // file exists with .js but import lacks it
        }
      } else {
        // Check case sensitivity
        const dir = path.dirname(resolved);
        const base = path.basename(resolved);
        if (fs.existsSync(dir)) {
          const actualFiles = fs.readdirSync(dir);
          const lowerMatch = actualFiles.find(f => f.toLowerCase() === base.toLowerCase());
          if (lowerMatch && lowerMatch !== base) {
            issues.push({
              file: relFile,
              import: spec,
              issue: 'CASE_MISMATCH',
              detail: `Imported as "${base}" but file is "${lowerMatch}"`
            });
          } else {
            issues.push({
              file: relFile,
              import: spec,
              issue: 'FILE_NOT_FOUND',
              detail: 'Target file does not exist'
            });
          }
        } else {
          // Check if directory case mismatch
          const parts = spec.split('/').filter(p => p && p !== '.' && p !== '..');
          let curDir = fileDir;
          let badPart = null;
          for (const part of parts) {
            if (fs.existsSync(path.join(curDir, part))) {
              curDir = path.join(curDir, part);
            } else {
              // check case-insensitive
              const entries = fs.readdirSync(curDir);
              const ciMatch = entries.find(e => e.toLowerCase() === part.toLowerCase());
              if (ciMatch && ciMatch !== part) {
                badPart = `segment "${part}" (actual: "${ciMatch}")`;
              } else {
                badPart = `segment "${part}" (does not exist)`;
              }
              break;
            }
          }
          issues.push({
            file: relFile,
            import: spec,
            issue: 'PATH_NOT_FOUND',
            detail: badPart || 'Path segment not found'
          });
        }
      }
    }
  }
}

console.log('=== ISSUES FOUND ===\n');
if (issues.length === 0) {
  console.log('No resolution issues found.');
} else {
  const grouped = {};
  for (const i of issues) {
    grouped[i.issue] = grouped[i.issue] || [];
    grouped[i.issue].push(i);
  }
  for (const [type, list] of Object.entries(grouped)) {
    console.log(`\n--- ${type} (${list.length}) ---`);
    for (const i of list) {
      console.log(`  ${i.file}: import "${i.import}" — ${i.detail}`);
    }
  }
}

// 2. Check import map coverage
console.log('\n=== FIREBASE IMPORT MAP COVERAGE ===');
const htmlFiles = files.filter(f => f.endsWith('.html'));
let importMapSpec = '';
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8');
  const m = c.match(/<script\s+type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    importMapSpec = m[1];
    console.log(`Import map found in ${path.relative(ROOT, hf)}`);
    break;
  }
}
if (importMapSpec) {
  const mapped = importMapSpec.match(/"([^"]+)":\s*"([^"]+)"/g) || [];
  const mappedKeys = mapped.map(m => m.split('":')[0].replace('"', ''));
  console.log('Mapped keys:', mappedKeys);
  console.log('\nFirebase imports used in code:');
  for (const [spec, users] of Object.entries(importMap)) {
    const inMap = mappedKeys.some(k => spec === k || spec.startsWith(k + '/'));
    console.log(`  ${spec} — ${inMap ? 'OK' : 'NOT IN IMPORT MAP'} (used in ${users.length} files)`);
  }
}

// 3. Check HTML script tags
console.log('\n=== HTML SCRIPT TAGS ===');
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8');
  const rel = path.relative(ROOT, hf);
  const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*>/g;
  let m;
  while ((m = scriptRegex.exec(c)) !== null) {
    const src = m[1];
    if (src.startsWith('http') || src.startsWith('//')) continue;
    const resolved = path.resolve(path.dirname(hf), src);
    const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
    console.log(`  ${rel}: src="${src}" — ${exists ? 'OK' : 'MISSING FILE'}`);
  }
}

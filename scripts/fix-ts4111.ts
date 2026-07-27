/**
 * Fix TS4111 errors mechanically.
 *
 * TS4111: "Property 'X' comes from an index signature, so it must be
 * accessed with ['X']."
 *
 * Parses tsc error output and replaces `.propertyName` with `['propertyName']`
 * at the exact file:line:column positions reported.
 *
 * Usage: bun run typecheck 2>&1 | bun run scripts/fix-ts4111.ts
 */

const ERROR_RE = /^(.+?)\((\d+),(\d+)\): error TS4111: Property '(.+?)' comes from an index signature/;

// Collect replacements: file -> line -> { col, propName }
const replacements = new Map<string, Map<number, Array<{ col: number; name: string }>>>();

// Read tsc errors from stdin
const decoder = new TextDecoder();
const input = await Bun.stdin.bytes();
const text = decoder.decode(input);

for (const line of text.split('\n')) {
  const m = line.match(ERROR_RE);
  if (!m) continue;
  const [, file, lineStr, colStr, propName] = m;
  const lineNum = parseInt(lineStr!, 10);
  const col = parseInt(colStr!, 10);
  const f = replacements.get(file!) ?? new Map();
  const arr = f.get(lineNum) ?? [];
  arr.push({ col, name: propName! });
  f.set(lineNum, arr);
  replacements.set(file!, f);
}

// Apply fixes: for each file, sort replacements by column descending so
// earlier columns don't shift later ones on the same line.
for (const [file, lineMap] of replacements) {
  const content = await Bun.file(file).text();
  const lines = content.split('\n');

  for (const [lineNum, reps] of lineMap) {
    // Sort by column descending
    reps.sort((a, b) => b.col - a.col);

    let line = lines[lineNum - 1];
    if (!line) continue;

    for (const { col, name } of reps) {
      const dotIdx = col - 2; // col points to first char of propertyName, dot is one before
      if (line[dotIdx] !== '.') {
        console.warn(`[warn] ${file}:${lineNum}:${col} expected '.' at idx ${dotIdx}, got '${line[dotIdx]}' — skipping`);
        continue;
      }
      const before = line.slice(0, dotIdx);
      const after = line.slice(dotIdx + 1 + name.length); // skip '.' + propertyName
      line = `${before}['${name}']${after}`;
    }
    lines[lineNum - 1] = line;
  }

  await Bun.write(file, lines.join('\n'));
}

console.log(`[fix-ts4111] Fixed ${replacements.size} files`);

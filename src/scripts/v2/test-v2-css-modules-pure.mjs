import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(scriptDir, "../..");

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.isFile() && extname(entry.name) === ".css" && entry.name.endsWith(".module.css") ? [path] : [];
  });
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function selectors(prelude) {
  const result = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let quote = "";
  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index];
    if (quote) {
      if (char === quote && prelude[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") parens -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
    else if (char === "," && parens === 0 && brackets === 0) {
      result.push(prelude.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(prelude.slice(start).trim());
  return result.filter(Boolean);
}

function lineAt(css, index) {
  return css.slice(0, index).split("\n").length;
}

function checkFile(path) {
  const css = stripComments(readFileSync(path, "utf8"));
  const errors = [];

  function scanBlock(start, inKeyframes) {
    let segmentStart = start;
    let parens = 0;
    let brackets = 0;
    let quote = "";
    for (let index = start; index < css.length; index += 1) {
      const char = css[index];
      if (quote) {
        if (char === quote && css[index - 1] !== "\\") quote = "";
        continue;
      }
      if (char === "\"" || char === "'") {
        quote = char;
        continue;
      }
      if (char === "(") parens += 1;
      else if (char === ")") parens -= 1;
      else if (char === "[") brackets += 1;
      else if (char === "]") brackets -= 1;
      else if (char === ";" && parens === 0 && brackets === 0) segmentStart = index + 1;
      else if (char === "{" && parens === 0 && brackets === 0) {
        const prelude = css.slice(segmentStart, index).trim();
        const isAtRule = prelude.startsWith("@");
        const isKeyframes = /^@(?:-[\w]+-)?keyframes\b/i.test(prelude);
        if (!isAtRule && !inKeyframes) {
          for (const selector of selectors(prelude)) {
            if (!/[.#][A-Za-z_-][\w-]*/.test(selector)) errors.push(`${relative(srcDir, path)}:${lineAt(css, segmentStart)}: ${selector}`);
          }
        }
        index = scanBlock(index + 1, inKeyframes || isKeyframes);
        segmentStart = index;
      } else if (char === "}" && parens === 0 && brackets === 0) {
        return index + 1;
      }
    }
    return css.length;
  }

  scanBlock(0, false);
  return errors;
}

const errors = cssFiles(srcDir).flatMap(checkFile);
assert.deepEqual(errors, [], `CSS Modules selectors must include a local class or id:\n${errors.join("\n")}`);
console.log(`[css-modules-pure] ${cssFiles(srcDir).length} files PASS`);

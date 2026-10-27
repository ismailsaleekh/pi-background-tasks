import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { countSurrogateTokens } = await import(pathToFileURL(resolve('src/core/context/kiro-tokenizer.ts')).href);
for (const path of process.argv.slice(2)) {
  const sample = JSON.parse(readFileSync(path, 'utf8'));
  const promptTokens = countSurrogateTokens([sample.prompt]);
  const systemTokens = countSurrogateTokens([sample.system]);
  console.log(JSON.stringify({ path, promptTokens, systemTokens, localTokens: promptTokens + systemTokens }));
}

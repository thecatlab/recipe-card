// Packages the recipe-card skill so Claude apps can use it.
//
//   npm run skill           regenerate recipe-generator.html, then write dist-skill/recipe-card/ and dist-skill/recipe-card-skill.zip
//   npm run skill:install   the same, then copy the skill to ~/.claude/skills/recipe-card (Claude Code, every folder)
//
// Upload the zip in Claude (Desktop or claude.ai): Settings → Capabilities → Skills.
// Add --skip-generator to package the current recipe-generator.html as is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildGenerator } from './build-generator.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '.claude', 'skills', 'recipe-card');
const out = path.join(root, 'dist-skill');
const skill = path.join(out, 'recipe-card');
const zip = path.join(out, 'recipe-card-skill.zip');
const args = process.argv.slice(2);

if (!args.includes('--skip-generator')) console.log('Regenerated ' + path.relative(root, await buildGenerator()));
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(source, skill, { recursive: true, dereference: true });
fs.mkdirSync(path.join(skill, 'assets'), { recursive: true });
fs.copyFileSync(path.join(root, 'recipe-generator.html'), path.join(skill, 'assets', 'recipe-generator.html'));
console.log('Skill folder: ' + path.relative(root, skill));

// The zip holds the recipe-card folder at its top level, as Claude's skill upload expects.
try {
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${skill}' -DestinationPath '${zip}' -Force`]);
  else execFileSync('zip', ['-qr', zip, 'recipe-card'], { cwd: out });
  console.log('Skill zip: ' + path.relative(root, zip));
} catch {
  console.log('Could not create the zip (no zip tool found). Zip the dist-skill/recipe-card folder yourself.');
}

if (args.includes('--install')) {
  const target = path.join(os.homedir(), '.claude', 'skills', 'recipe-card');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(skill, target, { recursive: true });
  console.log('Installed for Claude Code: ' + target);
}

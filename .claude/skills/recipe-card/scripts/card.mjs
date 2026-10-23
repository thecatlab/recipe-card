#!/usr/bin/env node
// Recipe card maker for the recipe-card skill.
//
// Turns a recipe draft (JSON that refers to ingredients and procedures by short keys) into the
// app's own recipe format, checks it against the same layout rules the editor uses, and writes
// the card: a copy of recipe-generator.html with the recipe inside, which opens on the card view.
//
//   node card.mjs make  <draft.json> [--out <dir>] [--png] [--library <library.json>]
//   node card.mjs check <draft.json>
//   node card.mjs draft <card.html | library.json | recipe.json> [recipe name or id]
//
// No dependencies. --png needs Playwright (optional) and a Chromium or Chrome browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- template and model

const isTemplate = file => {
  try { return fs.readFileSync(file, 'utf8').includes('<script id="generator-runtime">'); } catch { return false; }
};

// The packaged skill carries assets/recipe-generator.html; inside the repo the skill uses the repo's copy.
export function findTemplate() {
  const bundled = path.join(here, '..', 'assets', 'recipe-generator.html');
  if (isTemplate(bundled)) return bundled;
  for (let dir = here; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'recipe-generator.html');
    if (isTemplate(candidate)) return candidate;
    if (path.dirname(dir) === dir) break;
  }
  throw new Error('recipe-generator.html not found. Put it in the skill\'s assets/ folder (npm run skill builds it).');
}

// The template embeds model.js + app.js as its generator runtime; running it gives the same RecipeModel the card uses.
export function loadModel(html) {
  const source = html.match(/<script id="generator-runtime">([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('The template has no generator runtime.');
  const context = vm.createContext({ crypto: globalThis.crypto, window: {} });
  vm.runInContext(source, context);
  return context.RecipeModel;
}

// ---------------------------------------------------------------- draft → recipe

const FIELDS = {
  recipe: ['id', 'name', 'description', 'eyebrow', 'baseServings', 'yieldUnit', 'active', 'total', 'vessel', 'credit', 'monochrome', 'prep', 'ingredients', 'procedures', 'finish', 'notes'],
  ingredient: ['key', 'id', 'name', 'description', 'quantity', 'unit', 'metricQuantity', 'metricUnit'],
  procedure: ['key', 'id', 'title', 'instructions', 'inputs', 'minutes', 'tools', 'parallel', 'outputName', 'outputDescription', 'outputQuantity', 'outputUnit'],
  step: ['id', 'title', 'text', 'tools'],
  decision: ['id', 'text', 'options'],
  option: ['id', 'answer', 'label', 'text', 'tools', 'items'],
  grid: ['id', 'title', 'ingredients', 'procedures'],
  note: ['id', 'title', 'body'],
};
const text = value => value === undefined || value === null ? '' : String(value).trim();
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const filled = (...values) => values.some(value => text(value));
const quote = value => '"' + value + '"';

export function fromDraft(draft, M) {
  const errors = [];
  const warnings = [];
  if (!isObject(draft)) return { errors: ['The draft must be a JSON object.'], warnings };
  const known = (object, kind, where) => Object.keys(object).filter(key => !FIELDS[kind].includes(key)).forEach(key => warnings.push(`${where}: unknown field ${quote(key)} was ignored.`));
  const list = (value, where) => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;
    errors.push(`${where} must be a list.`);
    return [];
  };
  const id = value => typeof value === 'string' && value.trim() ? value.trim() : M.id();
  known(draft, 'recipe', 'Recipe');

  const recipe = { ...M.blankRecipe(), id: id(draft.id), prep: [], finish: [], ingredients: [], procedures: [], notes: [] };
  for (const field of ['name', 'description', 'eyebrow', 'yieldUnit', 'active', 'total', 'vessel', 'credit']) recipe[field] = text(draft[field]);
  recipe.monochrome = Boolean(draft.monochrome);
  if (draft.baseServings !== undefined && draft.baseServings !== '') {
    if (Number(draft.baseServings) > 0) recipe.baseServings = String(draft.baseServings).trim();
    else errors.push(`baseServings must be a positive number (got ${JSON.stringify(draft.baseServings)}).`);
  }
  if (!recipe.name) errors.push('The recipe needs a name.');

  // Keys (and ids, when editing an existing recipe) name ingredients and procedures across all grids.
  const refs = new Map();
  const register = (ref, entry, where) => {
    if (refs.has(ref)) errors.push(`${where}: key ${quote(ref)} is already used by ${refs.get(ref).label}. Keys must be unique in the whole recipe.`);
    else refs.set(ref, entry);
  };
  const grids = [];
  function grid(source, target, label) {
    target.ingredients = list(source.ingredients, label + ' ingredients').map((raw, index) => {
      const where = `${label}, ingredient ${index + 1}`;
      const item = typeof raw === 'string' ? { name: raw } : isObject(raw) ? raw : null;
      if (!item) { errors.push(`${where} must be an object.`); return M.ingredient(); }
      known(item, 'ingredient', where);
      const ingredient = { ...M.ingredient(), id: id(item.id) };
      for (const field of ['name', 'description', 'quantity', 'unit', 'metricQuantity', 'metricUnit']) ingredient[field] = text(item[field]);
      const name = ingredient.name || `ingredient ${index + 1}`;
      if (!ingredient.name && filled(ingredient.description, ingredient.quantity, ingredient.unit, ingredient.metricQuantity, ingredient.metricUnit)) errors.push(`${where} needs a name.`);
      const entry = { kind: 'ingredient', item: ingredient, grid: target, label: `ingredient ${quote(name)}` };
      if (text(item.key)) register(text(item.key), entry, where);
      if (item.id) register(ingredient.id, entry, where);
      return ingredient;
    }).filter(item => filled(item.name, item.description, item.quantity, item.unit, item.metricQuantity, item.metricUnit));
    const pending = [];
    target.procedures = list(source.procedures, label + ' procedures').map((raw, index) => {
      const where = `${label}, procedure ${index + 1}`;
      if (!isObject(raw)) { errors.push(`${where} must be an object.`); return M.procedure(); }
      known(raw, 'procedure', where);
      const stage = { ...M.procedure(), id: id(raw.id), parallel: Boolean(raw.parallel) };
      for (const field of ['title', 'instructions', 'minutes', 'tools', 'outputName', 'outputDescription', 'outputQuantity', 'outputUnit']) stage[field] = text(raw[field]);
      if (stage.minutes && !(Number(stage.minutes) >= 0)) errors.push(`${where}: minutes must be a number (got ${quote(stage.minutes)}).`);
      if (!stage.title) errors.push(`${where} needs a title.`);
      const name = stage.title || `procedure ${index + 1}`;
      const entry = { kind: 'procedure', item: stage, grid: target, label: `procedure ${quote(name)}` };
      if (text(raw.key)) register(text(raw.key), entry, where);
      if (raw.id) register(stage.id, entry, where);
      pending.push({ stage, inputs: list(raw.inputs, where + ' inputs'), where: `${label}, procedure ${quote(name)}` });
      return stage;
    });
    if (target.procedures[0]?.parallel) {
      warnings.push(`${label}: the first procedure cannot be parallel; "parallel" was removed.`);
      target.procedures[0].parallel = false;
    }
    grids.push({ grid: target, label, pending });
  }
  function item(raw, where, nested) {
    if (typeof raw === 'string') return { ...M.instruction(), text: raw.trim() };
    if (!isObject(raw)) { errors.push(`${where} must be an object or a string.`); return M.instruction(); }
    if (raw.options !== undefined) {
      known(raw, 'decision', where + ' (decision)');
      const decision = { id: id(raw.id), text: text(raw.text), options: list(raw.options, where + ' options').map((option, index) => {
        const label = `${where}, option ${index + 1}`;
        if (!isObject(option)) { errors.push(`${label} must be an object.`); return M.option(); }
        known(option, 'option', label);
        const result = { ...M.option(), id: id(option.id) };
        for (const field of ['answer', 'label', 'text', 'tools']) result[field] = text(option[field]);
        result.items = list(option.items, label + ' items').map((entry, position) => item(entry, `${label}, item ${position + 1}`, true));
        return result;
      }) };
      if (decision.options.length < 2) errors.push(`${where}: a decision needs at least two options.`);
      if (!decision.text) warnings.push(`${where}: the decision has no question text.`);
      return decision;
    }
    if (raw.ingredients !== undefined || raw.procedures !== undefined) {
      if (nested) { errors.push(`${where}: a process grid cannot sit inside a decision option.`); return M.instruction(); }
      known(raw, 'grid', where + ' (process grid)');
      const result = { id: id(raw.id), title: text(raw.title), ingredients: [], procedures: [] };
      grid(raw, result, `${where} (process grid${result.title ? ' ' + quote(result.title) : ''})`);
      return result;
    }
    known(raw, 'step', where);
    return { id: id(raw.id), title: text(raw.title), text: text(raw.text), tools: text(raw.tools) };
  }

  recipe.prep = list(draft.prep, 'prep').map((entry, index) => item(entry, `prep ${index + 1}`, false));
  grid(draft, recipe, 'Main grid');
  recipe.finish = list(draft.finish, 'finish').map((entry, index) => item(entry, `finish ${index + 1}`, false));
  recipe.notes = list(draft.notes, 'notes').map((entry, index) => {
    if (typeof entry === 'string') return { id: M.id(), title: '', body: entry.trim() };
    if (!isObject(entry)) { errors.push(`note ${index + 1} must be an object or a string.`); return null; }
    known(entry, 'note', `note ${index + 1}`);
    return { id: id(entry.id), title: text(entry.title), body: text(entry.body) };
  }).filter(note => note && (note.title || note.body));
  if (!recipe.ingredients.length && !recipe.procedures.length) errors.push('The main grid is empty: add ingredients and procedures.');

  // Resolve inputs once every key is known.
  for (const { grid: target, pending } of grids) {
    for (const { stage, inputs, where } of pending) {
      for (const ref of inputs) {
        const entry = refs.get(text(ref));
        if (!entry) {
          const keys = [...refs].filter(([, value]) => value.grid === target && value.item !== stage).map(([key]) => key);
          errors.push(`${where}: input ${quote(ref)} matches no key. Keys in this grid: ${keys.join(', ') || 'none'}.`);
        } else if (entry.item === stage) errors.push(`${where} lists itself as an input.`);
        else if (entry.grid !== target) errors.push(`${where}: input ${quote(ref)} belongs to another grid. Inputs can only use the same grid.`);
        else if (entry.kind === 'procedure' && target.procedures.indexOf(entry.item) > target.procedures.indexOf(stage)) errors.push(`${where}: input ${quote(ref)} is a later procedure. A procedure can only use outputs of procedures listed before it.`);
        else if (stage.inputs.includes(entry.item.id)) warnings.push(`${where}: input ${quote(ref)} is listed twice.`);
        else stage.inputs.push(entry.item.id);
      }
    }
  }
  if (!errors.length) for (const { grid: target, label } of grids) checkLayout(target, label, M, errors, warnings);
  allDecisions([...recipe.prep, ...recipe.finish]).forEach(decision => decision.options.forEach((option, index) => {
    if (!filled(option.answer, option.label, option.text, option.tools) && !option.items.length) warnings.push(`Decision ${quote(decision.text)}: option ${index + 1} is empty and will not show.`);
  }));
  return { recipe, errors, warnings };
}

function allDecisions(list) {
  return list.flatMap(item => item.options ? [item, ...item.options.flatMap(option => allDecisions(option.items || []))] : []);
}

// Same rules as M.validLayout, but each problem is named so it can be fixed.
function checkLayout(grid, label, M, errors, warnings) {
  const name = stage => quote(stage.title);
  const groups = M.columns(grid);
  const columnOf = new Map();
  groups.forEach((group, column) => group.forEach(index => columnOf.set(grid.procedures[index].id, column)));
  const { rows, masks } = M.plan(grid, true);
  const rowName = new Map(rows.map(row => [row.id, row.name]));
  groups.forEach(group => {
    const stages = group.map(index => grid.procedures[index]);
    stages.forEach(stage => stage.inputs.forEach(input => {
      const source = stages.find(other => other.id === input);
      if (source) errors.push(`${label}: ${name(stage)} is parallel with ${name(source)} but uses its output. Remove "parallel" from ${name(stage)}.`);
    }));
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      const shared = [...masks[group[a]]].filter(row => masks[group[b]].has(row));
      if (shared.length) errors.push(`${label}: ${name(grid.procedures[group[a]])} and ${name(grid.procedures[group[b]])} run in the same step (parallel) but both cover ${shared.map(row => quote(rowName.get(row))).join(', ')}. Parallel procedures must use different ingredients; drop "parallel" or split the ingredients.`);
    }
  });
  if (!errors.length && !M.validLayout(grid)) errors.push(`${label}: the layout is not valid (procedures in one step overlap or use each other).`);

  // A procedure's cell merges its rows; rows in between that it does not use split the cell in two.
  const shown = M.plan(grid);
  shown.masks.forEach((mask, index) => {
    const positions = shown.rows.map((row, position) => mask.has(row.id) ? position : -1).filter(position => position >= 0);
    if (positions.length < 2) return;
    const gaps = shown.rows.slice(positions[0], positions.at(-1) + 1).filter(row => !mask.has(row.id));
    if (gaps.length) warnings.push(`${label}: ${name(grid.procedures[index])} covers rows that are not next to each other (${gaps.map(row => quote(row.name)).join(', ')} sit in between), so its cell is split. Reorder the ingredients so each procedure's rows are together.`);
  });
  const used = new Set(shown.masks.flatMap(mask => [...mask]));
  shown.rows.filter(row => !row.preparation && !used.has(row.id)).forEach(row => warnings.push(`${label}: ingredient ${quote(row.name)} is not used by any procedure, so its row has no step next to it.`));
}

// A compact text picture of the grid, for checking the layout without a browser.
export function outline(recipe, M) {
  const lines = [];
  const grids = [...recipe.prep, recipe, ...recipe.finish].filter(item => item === recipe || item.ingredients);
  grids.forEach(grid => {
    const { rows, masks } = M.plan(grid);
    lines.push(grid === recipe ? 'Main grid' : 'Process grid' + (grid.title ? ' "' + grid.title + '"' : ''));
    lines.push('  Rows: ' + rows.map((row, index) => `${index + 1}. ${[row.quantity, row.unit].filter(Boolean).join(' ')} ${row.name}`.replace(/\s+/g, ' ')).join(' | '));
    M.columns(grid).forEach((group, column) => {
      lines.push(`  Step ${column + 1}: ` + group.map(index => {
        const positions = rows.map((row, position) => masks[index].has(row.id) ? position + 1 : 0).filter(Boolean);
        const span = positions.length ? (positions.length === positions.at(-1) - positions[0] + 1 ? `rows ${positions[0]}–${positions.at(-1)}` : 'rows ' + positions.join(',')) : 'no rows';
        return `${grid.procedures[index].title} (${span})`;
      }).join(' + '));
    });
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------- recipe → draft

const slug = value => text(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

// The editable draft for an existing recipe: ids become readable keys and empty fields are left out.
export function toDraft(recipe) {
  const keys = new Map();
  const taken = new Set();
  const keyFor = (id, label, fallback) => {
    const base = slug(label) || fallback;
    let key = base;
    for (let number = 2; taken.has(key); number++) key = base + '-' + number;
    taken.add(key);
    keys.set(id, key);
    return key;
  };
  const compact = (object, fields) => Object.fromEntries(fields.filter(field => object[field] !== undefined && object[field] !== '' && object[field] !== false && !(Array.isArray(object[field]) && !object[field].length)).map(field => [field, object[field]]));
  const gridDraft = grid => {
    const ingredients = grid.ingredients.filter(item => filled(item.name, item.description, item.quantity, item.unit, item.metricQuantity, item.metricUnit)).map((item, index) => ({ key: keyFor(item.id, item.name, 'ingredient-' + (index + 1)), ...compact(item, ['quantity', 'unit', 'name', 'description', 'metricQuantity', 'metricUnit']) }));
    const live = grid.procedures.filter(stage => !stage.blank && !stage.placeholder);
    live.forEach((stage, index) => keyFor(stage.id, stage.title, 'procedure-' + (index + 1)));
    const procedures = live.map((stage, index) => ({ key: keys.get(stage.id), ...compact({ ...stage, parallel: index > 0 && Boolean(stage.parallel), inputs: stage.inputs.map(input => keys.get(input)).filter(Boolean) }, ['title', 'instructions', 'inputs', 'minutes', 'tools', 'parallel', 'outputName', 'outputQuantity', 'outputUnit', 'outputDescription']) }));
    return { ingredients, procedures };
  };
  const itemDraft = item => {
    if (item.options) return { ...compact(item, ['text']), options: item.options.map(option => ({ ...compact(option, ['answer', 'label', 'text', 'tools']), ...(option.items?.length ? { items: option.items.map(itemDraft) } : {}) })) };
    if (item.ingredients) return { ...compact(item, ['title']), ...gridDraft(item) };
    return compact(item, ['title', 'text', 'tools']);
  };
  const isEmptyStep = item => !item.options && !item.ingredients && !filled(item.title, item.text, item.tools);
  const main = gridDraft(recipe);
  return {
    id: recipe.id,
    ...compact(recipe, ['name', 'description', 'baseServings', 'yieldUnit', 'active', 'total', 'vessel', 'credit', 'monochrome']),
    prep: (recipe.prep || []).filter(item => !isEmptyStep(item)).map(itemDraft),
    ...main,
    finish: (recipe.finish || []).filter(item => !isEmptyStep(item)).map(itemDraft),
    notes: (recipe.notes || []).filter(note => note.title || note.body).map(note => compact(note, ['title', 'body'])),
  };
}

// Reads a recipe from an exported card (.html), a library file ({ recipes: [...] }) or a single recipe JSON.
export function readRecipe(file, query) {
  const content = fs.readFileSync(file, 'utf8');
  if (/\.html?$/i.test(file)) {
    const data = content.match(/<script id="recipe-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!data) throw new Error(file + ' has no embedded recipe (recipe-data).');
    return JSON.parse(data);
  }
  const json = JSON.parse(content);
  if (!Array.isArray(json.recipes)) return json;
  const wanted = text(query).toLowerCase();
  const match = json.recipes.find(item => item.id === query) || json.recipes.find(item => text(item.name).toLowerCase() === wanted);
  if (!match) throw new Error(`Name a recipe from ${file}: ` + json.recipes.map(item => quote(item.name)).join(', '));
  return match;
}

// ---------------------------------------------------------------- output

export function fileName(recipe) {
  return (recipe.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'recipe');
}

// The card is the template with this recipe as its embedded snapshot. data-view="card" opens it on the card.
export function cardHTML(template, recipe) {
  const escapeHTML = value => String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  const data = `<script id="recipe-data" type="application/json" data-snapshot="${globalThis.crypto.randomUUID()}" data-view="card">${JSON.stringify(recipe).replace(/</g, '\\u003c')}</script>`;
  let replaced = false;
  const html = template.replace(/<script id="recipe-data"[^>]*>[\s\S]*?<\/script>/, () => { replaced = true; return data; });
  if (!replaced) throw new Error('The template has no recipe-data slot.');
  return html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHTML(recipe.name)} — Recipe card</title>`);
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [process.cwd(), here];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { /* npm not on PATH */ }
  for (const name of ['playwright', 'playwright-core']) {
    for (const root of roots) {
      try { return require(require.resolve(name, { paths: [root] })); } catch { /* try the next place */ }
    }
  }
  return null;
}

// Uses the card's own "HQ PNG" export, so the image matches what the app produces.
export async function renderPNG(htmlFile, pngFile) {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('PNG skipped: Playwright is not installed (npm i -g playwright). Open the HTML card and use Export → HQ PNG instead.');
  const attempts = [{}, { channel: 'chrome' }, ...['/opt/pw-browsers/chromium'].filter(fs.existsSync).map(executablePath => ({ executablePath }))];
  let browser;
  let failure;
  for (const options of attempts) {
    try { browser = await playwright.chromium.launch(options); break; } catch (error) { failure = error; }
  }
  if (!browser) throw new Error('PNG skipped: no Chromium or Chrome browser found (' + failure.message.split('\n')[0] + '). Open the HTML card and use Export → HQ PNG instead.');
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(pathToFileURL(htmlFile).href);
    await page.waitForFunction(() => document.querySelector('#recipe-card h1') && document.fonts.status === 'loaded');
    await page.click('#open-export');
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.click('#export-png');
    const status = page.waitForFunction(() => /too large|could not/i.test(document.getElementById('export-status').textContent), null, { timeout: 60000 }).then(async () => { throw new Error(await page.textContent('#export-status')); });
    await (await Promise.race([download, status])).saveAs(pngFile);
  } finally {
    await browser.close();
  }
}

// Adds the recipe to a library file (recipes/library.json), replacing the recipe with the same id.
export function addToLibrary(file, recipe) {
  const library = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { selectedId: recipe.id, recipes: [] };
  const index = library.recipes.findIndex(item => item.id === recipe.id);
  if (index >= 0) library.recipes[index] = recipe;
  else library.recipes.push(recipe);
  fs.writeFileSync(file, JSON.stringify(library, null, 2) + '\n');
  return index >= 0 ? 'replaced' : 'added';
}

// ---------------------------------------------------------------- command line

async function main(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--png') options.png = true;
    else if (arg === '--out' || arg === '--library' || arg === '--template') options[arg.slice(2)] = rest[++index];
    else positional.push(arg);
  }
  const usage = 'Usage:\n  node card.mjs make <draft.json> [--out <dir>] [--png] [--library <library.json>]\n  node card.mjs check <draft.json>\n  node card.mjs draft <card.html | library.json | recipe.json> [recipe name or id]';
  if (!['make', 'check', 'draft'].includes(command) || !positional[0]) { console.error(usage); return 2; }

  if (command === 'draft') {
    console.log(JSON.stringify(toDraft(readRecipe(positional[0], positional[1])), null, 2));
    return 0;
  }
  const templateFile = options.template || findTemplate();
  const template = fs.readFileSync(templateFile, 'utf8');
  const M = loadModel(template);
  let draft;
  try { draft = JSON.parse(fs.readFileSync(positional[0], 'utf8')); } catch (error) { console.error('Could not read the draft: ' + error.message); return 1; }
  const { recipe, errors, warnings } = fromDraft(draft, M);
  warnings.forEach(message => console.log('WARNING ' + message));
  errors.forEach(message => console.log('ERROR ' + message));
  if (errors.length) { console.log(`\n${errors.length} error(s). Fix the draft and run again; no card was written.`); return 1; }
  console.log(outline(recipe, M));
  if (command === 'check') { console.log('\nThe draft is valid' + (warnings.length ? ` (${warnings.length} warning(s)).` : '.')); return 0; }

  const out = options.out || process.cwd();
  fs.mkdirSync(out, { recursive: true });
  const htmlFile = path.resolve(out, fileName(recipe) + '.html');
  fs.writeFileSync(htmlFile, cardHTML(template, recipe));
  console.log('\nCard: ' + htmlFile);
  if (options.png) {
    const pngFile = htmlFile.replace(/\.html$/, '.png');
    try { await renderPNG(htmlFile, pngFile); console.log('Image: ' + pngFile); } catch (error) { console.log(error.message); }
  }
  if (options.library) console.log(`Library: recipe ${addToLibrary(options.library, recipe)} in ${path.resolve(options.library)}`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}

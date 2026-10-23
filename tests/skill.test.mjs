import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../model.js';
import { fromDraft, toDraft, cardHTML, readRecipe, loadModel, findTemplate } from '../.claude/skills/recipe-card/scripts/card.mjs';

const M = globalThis.RecipeModel;
const library = JSON.parse(fs.readFileSync(new URL('../recipes/library.json', import.meta.url), 'utf8'));
const base = () => ({
  name: 'Toast',
  ingredients: [{ key: 'bread', name: 'Bread', quantity: 2 }, { key: 'butter', name: 'Butter', quantity: '10', unit: 'g' }],
  procedures: [{ key: 'toast', title: 'Toast', inputs: ['bread'] }, { key: 'spread', title: 'Spread', inputs: ['toast', 'butter'] }],
});

test('a draft becomes a recipe whose inputs are ids and whose cells merge over their rows', () => {
  const { recipe, errors, warnings } = fromDraft(base(), M);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  const [bread, butter] = recipe.ingredients;
  assert.equal(bread.quantity, '2');
  assert.deepEqual(recipe.procedures[0].inputs, [bread.id]);
  assert.deepEqual(recipe.procedures[1].inputs, [recipe.procedures[0].id, butter.id]);
  assert.deepEqual(M.plan(recipe).masks.map(mask => mask.size), [1, 2]);
  assert.equal(M.validLayout(recipe), true);
  assert.equal('key' in bread, false);
});

test('broken references and invalid layouts are errors', () => {
  const cases = [
    [draft => { draft.procedures[1].inputs.push('jam'); }, /matches no key/],
    [draft => { draft.procedures[0].inputs = ['spread']; }, /later procedure/],
    [draft => { draft.procedures[1].parallel = true; }, /uses its output/],
    [draft => { draft.procedures[1] = { key: 'melt', title: 'Melt', inputs: ['bread'], parallel: true }; }, /both cover "Bread"/],
    [draft => { draft.ingredients[1].key = 'bread'; }, /already used/],
    [draft => { draft.finish = [{ text: 'Serve?', options: [{ label: 'Now' }] }]; }, /at least two options/],
    [draft => { delete draft.name; }, /needs a name/],
    [draft => { draft.finish = [{ title: 'Jam', ingredients: [{ key: 'jam', name: 'Jam' }], procedures: [{ title: 'Add', inputs: ['toast'] }] }]; }, /another grid/],
  ];
  for (const [change, message] of cases) {
    const draft = base();
    change(draft);
    const { errors } = fromDraft(draft, M);
    assert.ok(errors.some(error => message.test(error)), `${message} not in ${JSON.stringify(errors)}`);
  }
});

test('a split cell, an unused ingredient and an unknown field are warnings', () => {
  const draft = base();
  draft.ingredients.splice(1, 0, { key: 'salt', name: 'Salt' });
  draft.procedures[0].inputs.push('butter');
  draft.steps = [];
  const { errors, warnings } = fromDraft(draft, M);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(warning => /"Salt" sit in between/.test(warning)));
  assert.ok(warnings.some(warning => /"Salt" is not used/.test(warning)));
  assert.ok(warnings.some(warning => /unknown field "steps"/.test(warning)));
});

test('every library recipe survives a round trip through its draft', () => {
  for (const original of library.recipes) {
    const { recipe, errors } = fromDraft(toDraft(original), M);
    assert.deepEqual(errors, [], original.name);
    assert.equal(recipe.id, original.id);
    const shape = item => [item, ...item.prep, ...item.finish].filter(entry => entry === item || entry.ingredients).map(grid => {
      const { rows, masks } = M.plan(grid);
      return { rows: rows.map(row => row.name), cells: masks.map(mask => [...mask].map(id => rows.find(row => row.id === id).name).sort()), columns: M.columns(grid) };
    });
    assert.deepEqual(shape(recipe), shape(original), original.name);
  }
});

test('the card is the generator with the recipe embedded, opening on the card view', () => {
  const template = fs.readFileSync(findTemplate(), 'utf8');
  assert.equal(typeof loadModel(template).plan, 'function');
  const { recipe } = fromDraft({ ...base(), name: 'Toast </script> & jam' }, M);
  const html = cardHTML(template, recipe);
  assert.match(html, /<script id="recipe-data" type="application\/json" data-snapshot="[0-9a-f-]{36}" data-view="card">/);
  assert.match(html, /<title>Toast &lt;\/script&gt; &amp; jam — Recipe card<\/title>/);
  assert.equal(html.match(/<script id="recipe-data"/g).length, 1);
  const file = new URL('../tmp-card-test.html', import.meta.url);
  try {
    fs.writeFileSync(file, html);
    assert.deepEqual(readRecipe(file.pathname), recipe);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

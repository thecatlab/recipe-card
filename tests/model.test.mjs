import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../model.js';

const M = globalThis.RecipeModel;

test('a new recipe starts with an empty ingredient row and no procedures', () => {
  const recipe = M.blankRecipe();
  assert.equal(recipe.name, '');
  assert.equal(recipe.ingredients.length, 1);
  assert.equal(recipe.ingredients[0].quantity, '');
  assert.deepEqual(M.plan(recipe), { rows: [], masks: [] });
  assert.equal(M.plan(recipe, true).rows[0], recipe.ingredients[0]);
});

test('prepared components retain their ingredients through later combinations', () => {
  const recipe = M.blankRecipe();
  recipe.ingredients = ['onion', 'spices', 'chickpeas', 'stock', 'greens'].map(name => ({ ...M.ingredient(), name }));
  recipe.procedures = recipe.ingredients.map((ingredient, index) => ({ ...M.procedure(), title: 'Stage ' + index, inputs: [ingredient.id] }));
  recipe.procedures.forEach((stage, index) => {
    if (index) stage.inputs.push(recipe.procedures[index - 1].id);
  });
  const { masks } = M.plan(recipe);
  assert.deepEqual(masks.map(mask => mask.size), [1, 2, 3, 4, 5]);
  assert.deepEqual([...masks[4]].sort(), recipe.ingredients.map(item => item.id).sort());
  assert.equal(M.validLayout(recipe), true);
  assert.equal(M.validLayout({ ...recipe, procedures: [recipe.procedures[1], recipe.procedures[0], ...recipe.procedures.slice(2)] }), false);
});

test('separate preparations do not acquire unrelated ingredients', () => {
  const recipe = M.blankRecipe();
  recipe.ingredients = ['tomatoes', 'pasta', 'oil'].map(name => ({ ...M.ingredient(), name }));
  const sauce = { ...M.procedure(), title: 'Sauce', inputs: [recipe.ingredients[0].id, recipe.ingredients[2].id] };
  const pasta = { ...M.procedure(), title: 'Pasta', inputs: [recipe.ingredients[1].id] };
  const combine = { ...M.procedure(), title: 'Combine', inputs: [sauce.id, pasta.id] };
  recipe.procedures = [sauce, pasta, combine];
  const { masks } = M.plan(recipe);
  assert.equal(masks[0].has(recipe.ingredients[1].id), false);
  assert.equal(masks[1].has(recipe.ingredients[0].id), false);
  assert.equal(masks[2].size, 3);
  assert.equal(M.validLayout({ ...recipe, procedures: [pasta, sauce, combine] }), true);
  assert.equal(M.validLayout({ ...recipe, procedures: [sauce, combine, pasta] }), false);
});

test('ingredient-free preparations can be used by later procedures', () => {
  const recipe = M.blankRecipe();
  const prep = { ...M.procedure(), title: 'Prepare tray', outputName: 'Prepared tray' };
  recipe.procedures = [prep, { ...M.procedure(), title: 'Use tray', inputs: [prep.id] }];
  const { rows, masks } = M.plan(recipe);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Prepared tray');
  assert.deepEqual(masks[0], masks[1]);
});

test('scaling supports fractions and small decimals without inventing text quantities', () => {
  assert.equal(M.quantity('1 1/2', 0.5), '3/4');
  assert.equal(M.quantity('¼', 2), '1/2');
  assert.equal(M.quantity('1.5'), '1.5');
  assert.equal(M.quantity('1/3', 2), '2/3');
  assert.equal(M.quantity('0.02', 0.5), '0.01');
  assert.equal(M.quantity('60', 1.5), '90');
  assert.equal(M.quantity('to taste', 2), 'to taste');
  assert.equal(M.quantity('1–2', 2), '1–2');
  assert.equal(M.quantity('0', 2), '0');
  assert.equal(M.number('1/0'), null);
});

test('a new decision starts with a question and two empty options', () => {
  const decision = M.decision();
  assert.equal(decision.text, '');
  assert.equal(decision.options.length, 2);
  assert.notEqual(decision.options[0].id, decision.options[1].id);
  assert.deepEqual({ ...decision.options[0], id: '' }, { id: '', answer: '', label: '', text: '', tools: '', items: [] });
});

test('bullet lines group into a single-level list between plain text', () => {
  assert.deepEqual(M.bullets('Simmer gently.\n• Skim foam\n- Keep below a boil\n\nThen strain.'), [
    { list: false, text: 'Simmer gently.' },
    { list: true, items: ['Skim foam', 'Keep below a boil'] },
    { list: false, text: 'Then strain.', space: true },
  ]);
  assert.deepEqual(M.bullets('  * indented still one level'), [{ list: true, items: ['indented still one level'] }]);
  assert.deepEqual(M.bullets('-5°C is not a bullet'), [{ list: false, text: '-5°C is not a bullet' }]);
});

test('a blank line before or after a list is kept as a gap, not inside paragraphs', () => {
  assert.deepEqual(M.bullets('Simmer 24 hrs.\n\n• Skim\n• Season'), [
    { list: false, text: 'Simmer 24 hrs.' },
    { list: true, items: ['Skim', 'Season'], space: true },
  ]);
  assert.deepEqual(M.bullets('First.\n\nSecond.\n• Skim'), [
    { list: false, text: 'First.\n\nSecond.' },
    { list: true, items: ['Skim'] },
  ]);
  assert.deepEqual(M.bullets('\n\n• Skim'), [{ list: true, items: ['Skim'] }]);
});

test('decimals stay decimals; typed fractions scale as fractions', () => {
  assert.equal(M.quantity('0.5', 3), '1.5');
  assert.equal(M.quantity('2', 1 / 3), '0.667');
  assert.equal(M.quantity('1.25', 2.5), '3.13');
  assert.equal(M.quantity('1/2', 3), '1 1/2');
  assert.equal(M.quantity('1/2', 4), '2');
  assert.equal(M.quantity('1/3', 1.7), '0.567');
});

test('metric units switch to the size that reads best after scaling', () => {
  assert.deepEqual(M.scaleMeasure('300', 'g', 4), { quantity: '1.2', unit: 'kg' });
  assert.deepEqual(M.scaleMeasure('1.2', 'kg', 0.25), { quantity: '300', unit: 'g' });
  assert.deepEqual(M.scaleMeasure('400', 'ml', 5), { quantity: '2', unit: 'L' });
  assert.deepEqual(M.scaleMeasure('500', 'grams', 2), { quantity: '1', unit: 'kilogram' });
  assert.deepEqual(M.scaleMeasure('250', 'millilitres', 6), { quantity: '1.5', unit: 'litres' });
  assert.deepEqual(M.scaleMeasure('5', 'g', 0.5), { quantity: '2.5', unit: 'g' });
  assert.deepEqual(M.scaleMeasure('1500', 'g', 1), { quantity: '1500', unit: 'g' });
  assert.deepEqual(M.scaleMeasure('2', 'cups', 2), { quantity: '4', unit: 'cups' });
  assert.deepEqual(M.scaleMeasure('to taste', 'g', 2), { quantity: 'to taste', unit: 'g' });
});

test('a process grid is planned on its own, like the main grid', () => {
  const grid = M.processGrid();
  assert.equal(grid.title, '');
  assert.equal(grid.ingredients.length, 1);
  grid.ingredients = ['chilli', 'garlic'].map(name => ({ ...M.ingredient(), name }));
  grid.procedures = [{ ...M.procedure(), title: 'Pound', inputs: grid.ingredients.map(item => item.id) }];
  const { rows, masks } = M.plan(grid);
  assert.equal(rows.length, 2);
  assert.equal(masks[0].size, 2);
});

test('procedures can share a column when they cover different rows', () => {
  const recipe = M.blankRecipe();
  recipe.ingredients = ['brisket', 'onion', 'shallot', 'cinnamon'].map(name => ({ ...M.ingredient(), name }));
  const [brisket, onion, shallot, cinnamon] = recipe.ingredients.map(item => item.id);
  const roast = { ...M.procedure(), title: 'Roast', inputs: [brisket, onion] };
  const char = { ...M.procedure(), title: 'Char', inputs: [shallot, cinnamon], parallel: true };
  const simmer = { ...M.procedure(), title: 'Simmer', inputs: [roast.id, char.id] };
  recipe.procedures = [roast, char, simmer];
  assert.deepEqual(M.columns(recipe), [[0, 1], [2]]);
  assert.equal(M.validLayout(recipe), true);
  assert.equal(M.plan(recipe).masks[2].size, 4);
  char.inputs = [onion, shallot];
  assert.equal(M.validLayout(recipe), false, 'two procedures in one column cannot share a row');
  char.inputs = [shallot];
  simmer.parallel = true;
  assert.equal(M.validLayout(recipe), false, 'a procedure cannot use an output from its own column');
});

test('a placeholder column keeps its place without rows', () => {
  const recipe = M.blankRecipe();
  recipe.ingredients[0].name = 'Salt';
  recipe.procedures = [{ ...M.procedure(), placeholder: true }, { ...M.procedure(), title: 'Season', inputs: [recipe.ingredients[0].id] }];
  const { rows, masks } = M.plan(recipe);
  assert.equal(rows.length, 1);
  assert.equal(masks[0].size, 0);
});

test('a blank step column has no rows until a procedure goes into it', () => {
  const recipe = M.blankRecipe();
  recipe.ingredients[0].name = 'Salt';
  recipe.procedures = [M.blankStep()];
  const { rows, masks } = M.plan(recipe);
  assert.equal(rows.length, 1);
  assert.equal(masks[0].size, 0);
  assert.deepEqual(M.columns(recipe), [[0]]);
  assert.equal(M.validLayout(recipe), true);
});

test('numbered lines become a numbered list, separate from bullets', () => {
  assert.deepEqual(M.bullets('Prepare:\n1. Rinse bones\n2) Roast\n• Keep the juices'), [
    { list: false, text: 'Prepare:' },
    { list: true, items: ['Rinse bones', 'Roast'], ordered: true, start: 1 },
    { list: true, items: ['Keep the juices'] },
  ]);
  assert.deepEqual(M.bullets('3. Strain'), [{ list: true, items: ['Strain'], ordered: true, start: 3 }]);
  assert.deepEqual(M.bullets('1.5 kg bones'), [{ list: false, text: '1.5 kg bones' }]);
});

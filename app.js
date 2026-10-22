window.initRecipeGenerator = function () {
  const M = window.RecipeModel;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const storageKey = 'recipe-generator.library.v1';
  const embedded = $('recipe-data');
  const snapshot = embedded ? JSON.parse(embedded.textContent) : null;
  let library;
  try { library = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Storage may be unavailable for local files. */ }
  // Recipes bundled with the hosted site (recipes/library.json, set by main.js in production builds).
  const bundled = snapshot ? null : window.recipeCollection;
  if (!library?.recipes?.length) {
    if (bundled?.recipes?.length) library = { selectedId: bundled.selectedId, recipes: [] };
    else {
      const blank = snapshot || M.blankRecipe();
      library = { selectedId: blank.id, recipes: [blank] };
    }
  }
  function normalize(entry) {
    for (const field of ['prep', 'finish']) {
      if (!Array.isArray(entry[field])) entry[field] = [{ ...M.instruction(), text: entry[field] || '' }];
    }
    return entry;
  }
  // A shared recipe (bundled with the site or saved on GitHub) is identified by its id and a hash of its content.
  function versionToken(entry) {
    const text = JSON.stringify(entry);
    let hash = 5381;
    for (let index = 0; index < text.length; index++) hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
    return `bundled:${entry.id}:${hash.toString(36)}`;
  }
  function markImported(tokens) {
    library.importedSnapshots = [...(library.importedSnapshots || []), ...tokens].slice(-1000);
  }
  // Adds each version of a shared recipe once, so local edits stay until the shared copy changes. Returns the recipes it changed.
  function importRecipes(list) {
    const imported = [];
    for (const entry of list || []) {
      if (!entry?.id) continue;
      const token = versionToken(entry);
      if (library.importedSnapshots?.includes(token)) continue;
      const copy = normalize(structuredClone(entry));
      const existing = library.recipes.findIndex(item => item.id === entry.id);
      if (existing < 0) library.recipes.push(copy);
      else library.recipes[existing] = copy;
      markImported([token]);
      imported.push(copy);
    }
    return imported;
  }
  importRecipes(bundled?.recipes);
  if (snapshot) {
    const token = embedded.dataset.snapshot || snapshot.id;
    if (!library.importedSnapshots?.includes(token)) {
      const existing = library.recipes.findIndex(item => item.id === snapshot.id);
      if (existing < 0) library.recipes.push(snapshot);
      else library.recipes[existing] = snapshot;
      library.importedSnapshots = [...(library.importedSnapshots || []), token];
    }
    library.selectedId = snapshot.id;
  }
  library.recipes.forEach(normalize);
  let recipe = library.recipes.find(item => item.id === library.selectedId) || library.recipes[0];
  let servings = Number(recipe.baseServings) || 4;
  let units = 'main';
  let editing = true;
  let step = -1;
  let tick;
  let saveTimeout;
  let toastTimeout;
  let selectedProcedure;
  let exporting = false;
  let activeTextField;
  const crossedOff = new Set();

  function notify(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }
  function save() {
    clearTimeout(saveTimeout);
    library.selectedId = recipe.id;
    try {
      localStorage.setItem(storageKey, JSON.stringify(library));
      $('save-status').textContent = 'Saved in ' + new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch {
      $('save-status').textContent = 'Browser saving unavailable — use Save HTML';
    }
    renderLibrary();
  }
  // Undo history, per recipe and per session: snapshots of the recipe before each change.
  const histories = new Map();
  let lastEdit = { key: null, time: 0 };
  function history() {
    if (!histories.has(recipe.id)) histories.set(recipe.id, { past: [], future: [], baseline: JSON.stringify(recipe) });
    return histories.get(recipe.id);
  }
  function record(key) {
    const entry = history();
    const now = JSON.stringify(recipe);
    if (now === entry.baseline) return;
    // A burst of typing in one field counts as a single step.
    const sameBurst = key && key === lastEdit.key && Date.now() - lastEdit.time < 1500;
    if (!sameBurst) entry.past.push(entry.baseline);
    if (entry.past.length > 100) entry.past.shift();
    entry.baseline = now;
    entry.future = [];
    lastEdit = { key, time: Date.now() };
    updateUndo();
  }
  function travel(from, to) {
    const entry = history();
    if (!entry[from].length) return;
    entry[to].push(JSON.stringify(recipe));
    entry.baseline = entry[from].pop();
    recipe = JSON.parse(entry.baseline);
    library.recipes[library.recipes.findIndex(item => item.id === recipe.id)] = recipe;
    lastEdit = { key: null, time: 0 };
    stopCooking();
    renderEditor();
    renderCard();
    save();
  }
  function updateUndo() {
    $('undo').disabled = !history().past.length;
    $('redo').disabled = !history().future.length;
  }
  function changed(key) {
    record(key);
    $('save-status').textContent = 'Saving…';
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(save, 300);
    $('entry-table').querySelectorAll('[data-action="components"]').forEach(button => {
      const stage = findProcedure(button.dataset.id);
      if (!stage) return;
      button.nextElementSibling.innerHTML = stage.inputs.map(id => escape(componentName(id))).join('<br>');
    });
    $('entry-table').querySelectorAll('[data-procedure-reference]').forEach(element => {
      const stage = findProcedure(element.dataset.procedureReference);
      if (stage) element.textContent = procedureName(gridOf(stage.id), stage);
    });
    $('entry-table').querySelectorAll('[data-output-reference]').forEach(element => {
      const stage = findProcedure(element.dataset.outputReference);
      if (stage) element.textContent = [stage.outputQuantity, stage.outputUnit, componentName(stage.id), stage.outputDescription].filter(Boolean).join(' ');
    });
    renderCard();
  }
  function renderLibrary() {
    $('saved-recipes').innerHTML = library.recipes.map(item => `<option value="${escape(item.id)}"${item.id === recipe.id ? ' selected' : ''}>${escape(item.name || 'Untitled recipe')}</option>`).join('');
  }
  function input(kind, item, field, label, type = 'text', placeholder = '') {
    const numeric = type === 'number' ? ' min="0" step="any"' : '';
    const value = escape(item[field]);
    const attributes = `data-kind="${kind}" data-id="${escape(item.id || '')}" data-field="${field}" aria-label="${escape(label)}" placeholder="${escape(placeholder)}"`;
    return type === 'textarea' ? `<textarea rows="1" ${attributes}>${value}</textarea>` : `<input type="${type}" ${attributes}${numeric} value="${value}">`;
  }
  const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  const removeIcon = icon('M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7');
  const grip = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  function gripButton(kind, id, label) {
    return `<button class="drag-handle" data-kind="${kind}" data-id="${id}" aria-label="${escape(label)}: drag, or press the arrow keys" title="Drag to move">${grip}</button>`;
  }
  function removeButton(kind, id, label) {
    return `<button data-action="remove" data-kind="${kind}" data-id="${id}" aria-label="Remove ${escape(label)}" title="Remove ${escape(label)}">${removeIcon}</button>`;
  }
  function actionButtons(kind, item, index) {
    return gripButton(kind, item.id, 'Move ' + kind + ' ' + (index + 1)) + removeButton(kind, item.id, kind + ' ' + (index + 1));
  }
  function grids() {
    return [...recipe.prep, recipe, ...recipe.finish].filter(item => item === recipe || item.ingredients);
  }
  function gridById(id) {
    return grids().find(grid => grid.id === id) || recipe;
  }
  function gridOf(id) {
    return grids().find(grid => grid.ingredients.some(item => item.id === id) || grid.procedures.some(item => item.id === id));
  }
  function findProcedure(id) {
    return gridOf(id)?.procedures.find(item => item.id === id);
  }
  // Cooking stages are columns: procedures sharing a column start together.
  function stageList() {
    return grids().flatMap(grid => realColumns(grid).map(group => ({ grid, group, stages: group.map(index => grid.procedures[index]).filter(stage => !stage.blank) })));
  }
  function stageNumbers() {
    return new Map(stageList().flatMap((entry, number) => entry.stages.map(stage => [stage.id, number])));
  }
  // A column is a step; it may hold several procedures, or be a blank step waiting for one.
  function realColumns(grid) {
    return M.columns(grid).filter(group => group.some(index => !grid.procedures[index].blank && !grid.procedures[index].placeholder));
  }
  function columnNumber(grid, stage) {
    const index = grid.procedures.indexOf(stage);
    return M.columns(grid).findIndex(group => group.includes(index));
  }
  function procedureName(grid, stage) {
    return stage.title || 'Step ' + (columnNumber(grid, stage) + 1);
  }
  function componentName(id) {
    const grid = gridOf(id);
    if (!grid) return '';
    const ingredientIndex = grid.ingredients.findIndex(item => item.id === id);
    if (ingredientIndex >= 0) return grid.ingredients[ingredientIndex].name || 'Ingredient ' + (ingredientIndex + 1);
    const stageIndex = grid.procedures.findIndex(item => item.id === id);
    return grid.procedures[stageIndex].outputName || (grid.procedures[stageIndex].title || 'Procedure ' + (stageIndex + 1)) + ' output';
  }
  function entries(kind, grid = recipe) {
    if (kind === 'ingredient' || kind === 'procedure') return grid[kind + 's'];
    return recipe[{ note: 'notes', preparation: 'prep', finishing: 'finish' }[kind]];
  }
  function toolsNote(tools, centred = true) {
    const text = String(tools ?? '').trim();
    if (!text) return { className: '', top: '', bottom: '' };
    const note = escape(text);
    return { className: ' has-tools', top: centred ? `<small class="tools-space" aria-hidden="true">${note}</small>` : '', bottom: `<small class="tools-space" aria-hidden="true">${note}</small><small class="tools">${note}</small>` };
  }
  function toolsInput(kind, item, label) {
    return input(kind, item, 'tools', label + ' notes', 'text', 'Add notes');
  }
  function richText(text) {
    return M.bullets(text).map(block => block.list ? `<${block.ordered ? 'ol' : 'ul'} class="bullets${block.space ? ' spaced' : ''}"${block.ordered && block.start !== 1 ? ` start="${block.start}"` : ''}>${block.items.map(item => `<li>${escape(item)}</li>`).join('')}</${block.ordered ? 'ol' : 'ul'}>` : block.space ? `<div class="rich-text spaced">${escape(block.text)}</div>` : escape(block.text)).join('');
  }
  function yieldLabel(amount) {
    return recipe.yieldUnit?.trim() ? amount + ' ' + recipe.yieldUnit.trim() : amount;
  }
  function branchItems(option) {
    if (!option.items) option.items = [];
    return option.items;
  }
  // Every decision, including ones nested inside another decision's branches.
  function allDecisions(list = [...recipe.prep, ...recipe.finish]) {
    return list.flatMap(item => item.options ? [item, ...item.options.flatMap(option => allDecisions(branchItems(option)))] : []);
  }
  function findOption(id) {
    for (const decision of allDecisions()) {
      const option = decision.options.find(entry => entry.id === id);
      if (option) return { decision, option };
    }
    return {};
  }
  function findNested(id) {
    for (const decision of allDecisions()) for (const option of decision.options) {
      const list = branchItems(option);
      const item = list.find(entry => entry.id === id);
      if (item) return { list, item };
    }
    return {};
  }
  const filled = (...values) => values.some(value => String(value ?? '').trim());
  function decisionHasContent(decision) {
    return filled(decision.text) || decision.options.some(optionHasContent);
  }
  function optionHasContent(option) {
    return filled(option.answer, option.label, option.text, option.tools) || branchItems(option).some(nestedHasContent);
  }
  function nestedHasContent(item) {
    return item.options ? decisionHasContent(item) : filled(item.title, item.text, item.tools);
  }
  function nestedEditor(item, index) {
    const actions = `<div class="row-actions">${gripButton('nested', item.id, 'Move item ' + (index + 1))}${removeButton('nested', item.id, 'item ' + (index + 1))}</div>`;
    if (item.options) return `<div class="branch-item branch-decision"><div class="branch-head"><span class="decision-tag">Decision</span>${input('nested', item, 'text', 'Nested decision', 'textarea', 'Decision, e.g. Fridge or freezer?')}${actions}</div>${decisionBody(item, true)}</div>`;
    return `<div class="branch-item"><div class="branch-head">${input('nested', item, 'title', 'Instruction ' + (index + 1) + ' name', 'text', 'Step name')}${actions}</div>${input('nested', item, 'text', 'Instruction ' + (index + 1), 'textarea', 'Add instruction')}${toolsInput('nested', item, 'Instruction ' + (index + 1))}</div>`;
  }
  function nestedCard(item) {
    if (item.options) return `<div class="branch-item branch-decision">${decisionBody(item, false)}</div>`;
    const note = toolsNote(item.tools, false);
    return `<div class="branch-item${note.className}">${note.top}${filled(item.title) ? `<b>${escape(item.title)}</b> ` : ''}${richText(item.text)}${note.bottom}</div>`;
  }
  function optionEditor(decision, option, index) {
    const name = 'Option ' + (index + 1);
    return `<div><div class="option-head">${input('option', option, 'answer', name + ' answer', 'text', 'Answer, e.g. Yes')}${input('option', option, 'label', name + ' name', 'text', name + ', e.g. Serve now')}<div class="row-actions"><button data-action="remove-option" data-id="${option.id}" aria-label="Remove ${name.toLowerCase()}" title="Remove ${name.toLowerCase()}"${decision.options.length > 2 ? '' : ' disabled'}>${removeIcon}</button></div></div>${input('option', option, 'text', name + ' instructions', 'textarea', 'Instructions for this option. Start a line with - or 1. for a list')}${toolsInput('option', option, name)}${branchItems(option).map(nestedEditor).join('')}<div class="branch-add"><button data-action="add-branch-step" data-id="${option.id}" aria-label="Add an instruction under ${name.toLowerCase()}">+ Instruction</button><button data-action="add-branch-decision" data-id="${option.id}" aria-label="Add a decision under ${name.toLowerCase()}">+ Decision</button></div></div>`;
  }
  function optionCard(option) {
    const note = toolsNote(option.tools, false);
    return `<div class="${note.className.trim()}">${note.top}${filled(option.answer) ? `<span class="answer-pill">${escape(option.answer)} →</span>` : ''}${filled(option.label) ? `<b>${escape(option.label)}</b>` : ''}${richText(option.text)}${branchItems(option).filter(nestedHasContent).map(nestedCard).join('')}${note.bottom}</div>`;
  }
  // The question, then one column per branch with an OR badge on each divider; branches can nest further decisions.
  function decisionBody(decision, edit) {
    const options = edit ? decision.options : decision.options.filter(optionHasContent);
    const grid = options.length ? `<div class="decision-options" style="--options:${options.length}">${options.map((option, index) => edit ? optionEditor(decision, option, index) : optionCard(option)).join('')}</div>` : '';
    if (edit) return `${grid}<div class="decision-add instruction-add"><button data-action="add-option" data-id="${decision.id}">+ Option</button></div>`;
    return `${filled(decision.text) ? `<div class="decision-q"><span class="decision-tag">Decision · </span>${escape(decision.text)}</div>` : ''}${grid}`;
  }
  function decisionMarkup(kind, className, label, item, index, list, columns, edit) {
    if (!edit) return decisionHasContent(item) ? `<tr><td class="${className} decision" colspan="${columns}">${decisionBody(item, false)}</td></tr>` : '';
    return `<tr><td class="${className} decision" colspan="${columns}"><div class="instruction-row decision-head"><span class="decision-tag">Decision</span>${input(kind, item, 'text', label + ' ' + (index + 1) + ' decision', 'textarea', 'Decision, e.g. Serve now or store?')}<div class="row-actions">${actionButtons(kind, item, index, list.length)}</div></div>${decisionBody(item, true)}</td></tr>`;
  }
  function instructionRows(kind, className, label, columns, edit) {
    const list = entries(kind);
    let rows = list.map((item, index) => item.options ? decisionMarkup(kind, className, label, item, index, list, columns, edit) : item.ingredients ? processGridMarkup(kind, className, item, index, list, columns, edit) : !edit && !(item.title || '').trim() && !item.text.trim() && !(item.tools || '').trim() ? '' : (note => `<tr><td class="${className}${edit ? '' : note.className}" colspan="${columns}">${edit ? `<div class="instruction-row">${input(kind, item, 'title', label + ' ' + (index + 1) + ' name', 'text', 'Step name')}${input(kind, item, 'text', label + ' ' + (index + 1), 'textarea', kind === 'preparation' ? 'Add preparation steps' : 'Add finishing procedure')}<div class="row-actions">${actionButtons(kind, item, index, list.length)}</div>${toolsInput(kind, item, label + ' ' + (index + 1))}</div>` : `${note.top}${(item.title || '').trim() ? `<b>${escape(item.title)}</b> ` : ''}${escape(item.text)}${note.bottom}`}</td></tr>`)(toolsNote(item.tools))).join('');
    if (edit) rows += `<tr><td class="${className} instruction-add" colspan="${columns}"><button data-action="add-${kind}" aria-label="Add ${kind}">+ ${kind[0].toUpperCase() + kind.slice(1)}</button><button data-action="add-decision" data-kind="${kind}" aria-label="Add decision">+ Decision</button><button data-action="add-grid" data-kind="${kind}" aria-label="Add process grid">+ Process grid</button></td></tr>`;
    return rows;
  }
  function editorIngredient(item, span, grid) {
    if (item.preparation) {
      const stage = grid.procedures.find(entry => 'output-' + entry.id === item.id);
      return `<td class="editor-ingredient independent" colspan="${span}"><small>Independent preparation</small><p data-output-reference="${stage.id}">${escape([stage.outputQuantity, stage.outputUnit, componentName(stage.id), stage.outputDescription].filter(Boolean).join(' '))}</p></td>`;
    }
    const index = grid.ingredients.indexOf(item);
    const label = ' for ingredient ' + (index + 1);
    const insert = (position, edge) => `<div class="row-insert ${edge}"><button data-action="insert-ingredient" data-grid="${grid.id}" data-index="${position}" aria-label="Add an ingredient ${edge === 'top' ? 'before' : 'after'} ${escape(item.name || 'ingredient ' + (index + 1))}" title="Add an ingredient here">+</button></div>`;
    return `<td class="editor-ingredient" colspan="${span}">${index === 0 ? insert(0, 'top') : ''}${insert(index + 1, 'bottom')}<div class="entry-ingredient-grid">${input('ingredient', item, 'quantity', 'Quantity' + label, 'text', 'Qty')}${input('ingredient', item, 'unit', 'Unit' + label, 'text', 'Unit')}${input('ingredient', item, 'name', 'Item name' + label, 'text', 'Item name')}${input('ingredient', item, 'metricQuantity', 'Optional quantity' + label, 'text', 'Optional')}${input('ingredient', item, 'metricUnit', 'Optional unit' + label, 'text', 'Unit')}<div class="entry-description">${input('ingredient', item, 'description', 'Description' + label, 'textarea', 'Description / prep')}</div><div class="row-actions">${actionButtons('ingredient', item, index, grid.ingredients.length)}</div></div></td>`;
  }
  function edgeHandles(stage) {
    if (!stage.inputs.length) return '';
    return ['top', 'bottom'].map(edge => `<span class="edge-handle ${edge}" data-edge="${edge}" data-id="${stage.id}" title="Drag to add or remove rows"></span>`).join('');
  }
  function editorProcedure(stage, index, span, primary) {
    if (!primary) return `<td class="editor-op procedure-reference" rowspan="${span}">${edgeHandles(stage)}<b data-procedure-reference="${stage.id}">${escape(stage.title || 'Step ' + (index + 1))}</b><button data-action="focus-procedure" data-id="${stage.id}">Edit procedure</button></td>`;
    const label = ' for procedure ' + (index + 1);
    return `<td class="editor-op" rowspan="${span}">${edgeHandles(stage)}<div class="row-actions op-actions">${gripButton('stage', stage.id, 'Move ' + (stage.title || 'procedure ' + (index + 1)))}${removeButton('procedure', stage.id, stage.title || 'procedure ' + (index + 1))}</div><div class="entry-procedure-title">${input('procedure', stage, 'title', 'Procedure name' + label, 'textarea', 'Procedure name')}</div>${input('procedure', stage, 'instructions', 'Instructions' + label, 'textarea', 'Instructions. Start a line with - or 1. for a list')}${toolsInput('procedure', stage, 'Procedure ' + (index + 1))}<button class="component-button" data-action="components" data-id="${stage.id}" aria-label="Choose components${label}">${stage.inputs.length ? stage.inputs.length + ' component' + (stage.inputs.length === 1 ? '' : 's') + ' · edit' : 'Choose components'}</button><p class="component-list">${stage.inputs.map(id => escape(componentName(id))).join('<br>')}</p><details class="procedure-details"><summary>Timer & prepared output</summary><label class="timer-field"><span>Minutes</span>${input('procedure', stage, 'minutes', 'Timer minutes' + label, 'number')}</label><div class="output-fields">${input('procedure', stage, 'outputName', 'Output name' + label, 'text', 'Output name')}${input('procedure', stage, 'outputQuantity', 'Output quantity' + label, 'text', 'Quantity')}${input('procedure', stage, 'outputUnit', 'Output unit' + label, 'text', 'Unit')}${input('procedure', stage, 'outputDescription', 'Output description' + label, 'textarea', 'Output description')}</div></details></td>`;
  }
  function resizeTextarea(element) {
    if (bulletField(element)) element.classList.toggle('has-bullets', /^[ \t]*(?:•|\d+[.)])[ \t]+/m.test(element.value));
    element.style.height = 'auto';
    element.style.height = element.scrollHeight + 'px';
  }
  function renderEditor() {
    updateUndo();
    activeTextField = null;
    updateTextTools();
    $('entry-table').innerHTML = tableMarkup(true);
    $('credit-editor').innerHTML = input('recipe', recipe, 'credit', 'Source', 'textarea', 'Source (optional)');
    $('note-editor').innerHTML = recipe.notes.length ? `<div class="scroll"><table class="edit-table notes-editor" aria-label="Notes editor"><colgroup><col style="width:28%"><col style="width:54%"><col style="width:18%"></colgroup><thead><tr><th>Note title</th><th>Note</th><th>Order / remove</th></tr></thead><tbody>${recipe.notes.map((item, index) => `<tr><td>${input('note', item, 'title', 'Note title ' + (index + 1))}</td><td>${input('note', item, 'body', 'Note ' + (index + 1), 'textarea')}</td><td class="row-actions">${actionButtons('note', item, index, recipe.notes.length)}</td></tr>`).join('')}</tbody></table></div>` : '';
    $('editor').querySelectorAll('textarea').forEach(resizeTextarea);
  }
  function focusProcedure(id) {
    $('entry-table').querySelector(`[data-kind="procedure"][data-id="${id}"][data-field="title"]`)?.focus();
  }
  function measure(item, system) {
    const hasAlternate = String(item.metricQuantity).trim() !== '';
    const alternate = system === 'alternate' && hasAlternate;
    const amount = alternate ? item.metricQuantity : item.quantity;
    const unit = alternate ? item.metricUnit : item.unit;
    const scaled = M.scaleMeasure(amount, unit, servings / (Number(recipe.baseServings) || 4));
    return [scaled.quantity, scaled.unit].filter(Boolean).join(' ');
  }
  function ingredientMarkup(item, span) {
    const primary = measure(item, units);
    const secondary = String(item.metricQuantity).trim() !== '' ? measure(item, units === 'main' ? 'alternate' : 'main') : '';
    return `<td class="ing${item.preparation ? ' preparation' : ''}${crossedOff.has(item.id) ? ' off' : ''}" colspan="${span}" data-ingredient="${escape(item.id)}"${item.preparation ? '' : ` tabindex="0" role="button" aria-pressed="${crossedOff.has(item.id)}" aria-label="Mark ${escape(item.name || 'ingredient')} as used"`}><span class="ingredient-line"><span class="q">${escape(primary)}</span><span class="name">${escape(item.name || 'Unnamed ingredient')}</span></span>${secondary || item.description ? `<span class="detail-line"><span class="secondary-q">${escape(secondary)}</span><span class="note">${escape(item.description)}</span></span>` : ''}</td>`;
  }
  function procedureMarkup(stage, index, span, number) {
    const output = [measure({ quantity: stage.outputQuantity, unit: stage.outputUnit, metricQuantity: '' }, units), stage.outputName].filter(Boolean).join(' ') + (stage.outputDescription ? '\n' + stage.outputDescription : '');
    const detail = stage.instructions || (Number(stage.minutes) > 0 ? stage.minutes + ' min' : '');
    const components = stage.inputs.map(componentName).filter(Boolean).join(', ');
    const note = toolsNote(stage.tools);
    return `<td class="op${note.className}" rowspan="${span}" data-stage="${number}" tabindex="0" role="button" aria-label="Start procedure ${escape(stage.title || index + 1)}" title="${escape(components ? 'Uses: ' + components : 'Independent preparation')}"${components ? ` data-components="${escape(components)}"` : ''}>${note.top}<b>${escape(stage.title || 'Step ' + (index + 1))}</b>${detail ? `<span>${stage.instructions ? richText(detail) : escape(detail)}</span>` : ''}${output.trim() ? `<span class="output">${escape(output.trim())}</span>` : ''}${note.bottom}</td>`;
  }
  function gridMarkup(grid, columns, edit) {
    const { rows, masks } = M.plan(grid, edit);
    const groups = edit ? M.columns(grid) : realColumns(grid);
    const columnCount = groups.length;
    const offset = columns - 1 - (columnCount || (edit ? 1 : 0));
    const numbers = stageNumbers();
    let body = '';
    if (edit) body += `<tr class="entry-column-headings" data-grid-heading="${grid.id}"><th scope="col" colspan="${offset + 1}">Quantity · Item · Description</th>${columnCount ? groups.map((group, number) => {
      const head = grid.procedures[group[0]];
      if (head.placeholder) return `<th scope="col" data-column="${head.id}"></th>`;
      return `<th scope="col" data-column="${head.id}"><span>Step ${number + 1}</span><div class="row-actions">${gripButton('column', head.id, 'Move step ' + (number + 1))}<button class="add-parallel" data-action="add-parallel" data-kind="procedure" data-id="${head.id}" aria-label="Add a procedure to step ${number + 1}" title="Add a procedure to this step">+</button>${head.blank ? removeButton('procedure', head.id, 'step ' + (number + 1)) : ''}</div></th>`;
    }).join('') : '<th scope="col">Steps</th>'}</tr>`;
    rows.forEach((item, rowIndex) => {
      const owner = column => groups[column].find(index => masks[index].has(item.id));
      const first = groups.findIndex((group, column) => owner(column) !== undefined);
      const firstColumn = first < 0 ? columnCount : first;
      // In the editor the item cell stops at the item column, and every free spot under a procedure column is its own cell.
      body += '<tr data-row="' + escape(item.id) + '">' + (edit ? editorIngredient(item, offset + 1, grid) : ingredientMarkup(item, offset + firstColumn + 1));
      for (let column = edit ? 0 : firstColumn; column < columnCount; column++) {
        const index = owner(column);
        if (index === undefined) body += edit ? slotMarkup(grid, groups, column, item, owner) : '<td class="gap"></td>';
        else if (rowIndex === 0 || !masks[index].has(rows[rowIndex - 1].id)) {
          let span = 1;
          while (rowIndex + span < rows.length && masks[index].has(rows[rowIndex + span].id)) span++;
          const primary = rowIndex === rows.findIndex(row => masks[index].has(row.id));
          const stage = grid.procedures[index];
          body += edit ? editorProcedure(stage, column, span, primary) : procedureMarkup(stage, column, span, numbers.get(stage.id));
        }
      }
      if (edit && !columnCount && !rowIndex) body += `<td class="editor-op empty-column" rowspan="${rows.length}"><button data-action="add-step" data-grid="${grid.id}" aria-label="Add the first step">+ Step</button></td>`;
      body += '</tr>';
    });
    if (!rows.length && (edit || grid === recipe)) body += `<tr><td class="empty-card" colspan="${columns}">${edit ? 'Add an ingredient row to start ' + (grid === recipe ? 'your table' : 'this process grid') + '.' : 'Your recipe table is blank. Add ingredients and procedures in Edit table.'}</td></tr>`;
    return body;
  }
  // A new procedure takes over a blank step, or joins the procedures already in the step.
  function placeInStep(grid, group, stage) {
    const head = grid.procedures[group[0]];
    if (head.blank) grid.procedures.splice(group[0], 1, Object.assign(stage, { parallel: Boolean(head.parallel) }));
    else grid.procedures.splice(group.at(-1) + 1, 0, Object.assign(stage, { parallel: true }));
  }
  function slotMarkup(grid, groups, column, item, owner) {
    const classes = ['gap', 'slot'];
    if (column === 0 || owner(column - 1) === undefined) classes.push('open-left');
    if (column < groups.length - 1 && owner(column + 1) === undefined) classes.push('open-right');
    const source = item.preparation ? item.id.slice('output-'.length) : null;
    const sourceColumn = source && groups.findIndex(group => group.some(index => grid.procedures[index].id === source));
    const allowed = !grid.procedures[groups[column][0]].placeholder && (!source || sourceColumn < column);
    return `<td class="${classes.join(' ')}">${allowed ? `<button class="slot-add" data-action="add-at" data-grid="${grid.id}" data-slot-column="${column}" data-row="${escape(item.id)}" aria-label="Add a procedure for ${escape(item.name || 'this row')} in step ${column + 1}" title="Add a procedure here">+</button>` : ''}</td>`;
  }
  function processGridMarkup(kind, className, grid, index, list, columns, edit) {
    if (!edit) {
      if (!M.plan(grid).rows.length) return '';
      return (grid.title.trim() ? `<tr><td class="${className} grid-title" colspan="${columns}"><b>${escape(grid.title)}</b></td></tr>` : '') + gridMarkup(grid, columns, false);
    }
    return `<tr><td class="${className} grid-head" colspan="${columns}"><div class="instruction-row grid-head-row"><span class="decision-tag">Process grid</span>${input(kind, grid, 'title', 'Process grid ' + (index + 1) + ' name', 'text', 'Process grid name (optional)')}<div class="grid-add"><button data-action="add-ingredient" data-grid="${grid.id}" aria-label="Add ingredient to this process grid">+ Ingredient</button><button data-action="add-step" data-grid="${grid.id}" aria-label="Add a step to this process grid">+ Step</button></div><div class="row-actions">${actionButtons(kind, grid, index, list.length)}</div></div></td></tr>` + gridMarkup(grid, columns, true);
  }
  function tableMarkup(edit = false) {
    const procedureColumns = Math.max(...grids().map(grid => (edit ? M.columns(grid) : realColumns(grid)).length || (edit ? 1 : 0)));
    const columns = procedureColumns + 1;
    const columnWidth = edit ? 160 : 120;
    const width = Math.max(940, 360 + procedureColumns * columnWidth);
    let body = `<tr><th class="item-title" colspan="${columns}">${edit ? input('recipe', recipe, 'name', 'Recipe name', 'text', 'Recipe name').replace('<input ', '<input id="recipe-name" ') : escape(recipe.name || 'Untitled recipe')}</th></tr>`;
    if (edit) {
      body += `<tr><td class="entry-overview" colspan="${columns}">${input('recipe', recipe, 'description', 'Recipe description', 'textarea', 'Recipe description')}<div class="entry-meta"><label><span>Base yield</span>${input('recipe', recipe, 'baseServings', 'Base yield amount', 'number', '')}${input('recipe', recipe, 'yieldUnit', 'Base yield unit', 'text', 'portions')}</label>${[['active', 'Active time', 'text', 'e.g. 20 min'], ['total', 'Total time', 'text', 'e.g. 55 min'], ['vessel', 'Vessel / equipment', 'text', 'Vessel / equipment']].map(([field, label, type, placeholder]) => `<label><span>${label}</span>${input('recipe', recipe, field, label, type, placeholder)}</label>`).join('')}</div></td></tr>`;
    }
    body += instructionRows('preparation', 'prep', 'Initial preparation', columns, edit);
    body += gridMarkup(recipe, columns, edit);
    body += instructionRows('finishing', 'finish', 'Serving / finishing instructions', columns, edit);
    return `<table aria-label="${edit ? 'Editable recipe grid' : 'Recipe procedure grid'}"${edit ? ' class="entry-grid"' : ''} style="min-width:${width}px"><colgroup><col style="width:360px">${Array.from({ length: columns - 1 }, () => `<col style="width:${columnWidth}px">`).join('')}</colgroup><tbody>${body}</tbody></table>`;
  }
  function renderCard() {
    const notes = recipe.notes.filter(item => item.title || item.body);
    $('recipe-card').classList.toggle('monochrome', Boolean(recipe.monochrome));
    $('editor').classList.toggle('monochrome', Boolean(recipe.monochrome));
    $('monochrome-toggle').setAttribute('aria-pressed', Boolean(recipe.monochrome));
    $('recipe-card').innerHTML = `<h1>${escape(recipe.name || 'Untitled recipe')}</h1>${recipe.description ? `<p class="deck">${escape(recipe.description)}</p>` : ''}<p class="meta"><span>${recipe.yieldUnit?.trim() ? 'Makes' : 'Serves'} <b>${escape(yieldLabel(servings))}</b></span>${[['Active', recipe.active], ['Total', recipe.total], ['Vessel', recipe.vessel]].filter(([, value]) => value).map(([label, value]) => `<span>${label} <b>${escape(value)}</b></span>`).join('')}</p><div class="scroll">${tableMarkup()}</div>${notes.length ? `<section class="notes"><h2>Recipe notes</h2><div class="grid">${notes.map(item => `<div class="note-item">${item.title ? `<h3>${escape(item.title)}</h3>` : ''}<p>${escape(item.body)}</p></div>`).join('')}</div></section>` : ''}${recipe.credit ? `<p class="credit">${escape(recipe.credit)}</p>` : ''}`;
    $('serving-value').value = servings;
    $('servings-label').textContent = recipe.yieldUnit?.trim() ? 'Makes' : 'Serves';
    $('servings-unit').textContent = recipe.yieldUnit?.trim() || '';
    document.querySelectorAll('[data-servings]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.servings) === servings));
    $('start-cooking').disabled = !stageList().length;
    const allIngredients = grids().flatMap(grid => grid.ingredients);
    const allProcedures = grids().flatMap(grid => grid.procedures);
    const warnings = [];
    if (allIngredients.some(item => !item.name.trim() && [item.quantity, item.unit, item.description, item.metricQuantity, item.metricUnit].some(Boolean))) warnings.push('Some ingredients need an item name.');
    if (allProcedures.some(stage => !stage.title.trim())) warnings.push('Some procedures need a name.');
    if (units === 'alternate' && allIngredients.some(item => item.quantity && !item.metricQuantity)) warnings.push('Ingredients without an optional amount keep their main quantity and unit.');
    if (servings !== Number(recipe.baseServings) && [...allIngredients.map(item => item.quantity), ...allProcedures.map(stage => stage.outputQuantity)].some(value => value && M.number(value) === null)) warnings.push('Text quantities and ranges keep their original amounts when servings change.');
    $('preview-warnings').textContent = warnings.join('\n');
    $('preview-warnings').hidden = !warnings.length;
    document.title = recipe.name ? recipe.name + ' — Recipe builder' : 'Recipe builder';
    if (step >= 0) highlight();
  }
  function setView(edit) {
    editing = edit;
    document.body.classList.toggle('editing-table', edit);
    if (edit) stopCooking();
    $('editor').hidden = !edit;
    $('preview').hidden = edit;
    $('edit-tab').setAttribute('aria-pressed', edit);
    $('preview-tab').setAttribute('aria-pressed', !edit);
    if (!edit) activeTextField = null;
    updateTextTools();
    if (edit) $('editor').querySelectorAll('textarea').forEach(resizeTextarea);
    if (!edit) renderCard();
  }
  function openComponents(id) {
    const grid = gridOf(id);
    selectedProcedure = grid.procedures.find(item => item.id === id);
    const stageIndex = grid.procedures.indexOf(selectedProcedure);
    const groups = M.columns(grid);
    const column = groups.findIndex(group => group.includes(stageIndex));
    const { masks } = M.plan(grid, true);
    const taken = new Map();
    groups[column].filter(index => index !== stageIndex).forEach(index => masks[index].forEach(row => taken.set(row, procedureName(grid, grid.procedures[index]))));
    $('components-description').textContent = 'Choose what goes into ' + procedureName(grid, selectedProcedure) + '.' + (taken.size ? ' Greyed-out items are already used by another procedure in this column.' : '');
    function option(item, name, description, blockedBy) {
      const checked = selectedProcedure.inputs.includes(item.id);
      return `<label class="component-option${blockedBy && !checked ? ' blocked' : ''}"><input type="checkbox" value="${escape(item.id)}"${checked ? ' checked' : ''}${blockedBy && !checked ? ' disabled' : ''}><span>${escape(name)}${blockedBy ? `<small>Used by ${escape(blockedBy)} in this column</small>` : description ? `<small>${escape(description)}</small>` : ''}</span></label>`;
    }
    const ingredients = grid.ingredients.map((item, index) => option(item, item.name || 'Ingredient ' + (index + 1), [item.quantity, item.unit, item.description].filter(Boolean).join(' '), taken.get(item.id))).join('');
    const outputs = groups.slice(0, column).flat().map(index => grid.procedures[index]).filter(item => !item.placeholder).map(item => option(item, componentName(item.id), 'From ' + procedureName(grid, item) + (item.outputDescription ? ' · ' + item.outputDescription : ''), [...masks[grid.procedures.indexOf(item)]].map(row => taken.get(row)).find(Boolean))).join('');
    $('component-options').innerHTML = `<h3>Ingredients</h3>${ingredients || '<p>Add an ingredient first.</p>'}${outputs ? '<h3>Earlier procedure outputs</h3>' + outputs : ''}`;
    $('components-dialog').showModal();
  }
  function stopCooking() {
    clearInterval(tick);
    tick = null;
    step = -1;
    $('cooking-bar').classList.remove('live');
    $('recipe-card').classList.remove('dim');
    $('recipe-card').querySelectorAll('.hot').forEach(element => element.classList.remove('hot'));
  }
  function highlight() {
    const current = stageList()[step];
    const masks = current && M.plan(current.grid).masks;
    const rows = new Set(current ? current.group.flatMap(index => [...masks[index]]) : []);
    $('recipe-card').querySelectorAll('[data-stage]').forEach(element => element.classList.toggle('hot', Number(element.dataset.stage) === step));
    $('recipe-card').querySelectorAll('[data-row]').forEach(element => element.classList.toggle('hot', rows.has(element.dataset.row)));
  }
  function goTo(index) {
    const list = stageList();
    if (!list.length) return;
    clearInterval(tick);
    step = Math.max(0, Math.min(list.length - 1, index));
    const { grid, stages } = list[step];
    $('cooking-bar').classList.add('live');
    $('recipe-card').classList.add('dim');
    $('cooking-number').textContent = 'Step ' + (step + 1) + ' of ' + list.length;
    $('cooking-title').textContent = stages.map(stage => procedureName(grid, stage)).join(' + ');
    $('previous-stage').disabled = step === 0;
    $('next-stage').disabled = step === list.length - 1;
    $('cooking-clock').classList.remove('ring');
    const start = Date.now();
    const timers = stages.filter(stage => Number(stage.minutes) > 0).map(stage => ({ name: procedureName(grid, stage), end: start + Math.round(Number(stage.minutes) * 60) * 1000 }));
    if (timers.length) {
      const update = () => {
        const now = Date.now();
        $('cooking-clock').textContent = timers.map(timer => {
          const remaining = Math.max(0, Math.ceil((timer.end - now) / 1000));
          const time = remaining ? Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0') : 'Time';
          return timers.length > 1 ? timer.name + ' ' + time : time;
        }).join(' · ');
        $('cooking-clock').classList.toggle('ring', timers.some(timer => timer.end <= now));
        if (timers.every(timer => timer.end <= now)) clearInterval(tick);
      };
      update();
      tick = setInterval(update, 250);
    } else $('cooking-clock').textContent = 'No timer';
    highlight();
  }
  function filename(extension) {
    return (recipe.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'recipe') + '.' + extension;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function exportHTML() {
    save();
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('script, link[rel="modulepreload"], vite-error-overlay').forEach(element => element.remove());
    clone.querySelectorAll('dialog').forEach(dialog => dialog.removeAttribute('open'));
    clone.querySelector('#toast').hidden = true;
    clone.querySelector('#export-status').textContent = '';
    clone.querySelector('#saved-recipes').innerHTML = '';
    const body = clone.querySelector('body');
    function script(id, text, type) {
      const element = document.createElement('script');
      element.id = id;
      if (type) element.type = type;
      element.textContent = text;
      body.append(element);
    }
    script('recipe-data', JSON.stringify(recipe).replace(/</g, '\\u003c'), 'application/json');
    body.querySelector('#recipe-data').dataset.snapshot = M.id();
    script('capture-runtime', window.recipeCaptureSource);
    script('generator-runtime', window.recipeGeneratorSource);
    script('generator-start', "window.recipeCaptureSource=document.getElementById('capture-runtime').textContent;window.recipeGeneratorSource=document.getElementById('generator-runtime').textContent;window.initRecipeGenerator();");
    const html = '<!DOCTYPE html>\n' + clone.outerHTML.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, open, content, close) => open + content.replace(/<\/script/gi, '<\\/script') + close);
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), filename('html'));
    notify('Saved editable HTML with fonts and recipe data included.');
  }
  async function exportImage(format, copy = false) {
    if (exporting) return;
    exporting = true;
    const wasEditing = editing;
    let capture;
    const buttons = document.querySelectorAll('.export-bar button:not(#insert-degree), .export-options button');
    buttons.forEach(button => { button.disabled = true; });
    $('export-status').textContent = 'Preparing high-resolution ' + format.toUpperCase() + '…';
    try {
      save();
      setView(false);
      await document.fonts.ready;
      const card = $('recipe-card');
      const width = Math.max(1080, card.querySelector('table').scrollWidth) + 80;
      capture = card.cloneNode(true);
      capture.id = 'recipe-card';
      capture.classList.remove('dim');
      capture.classList.add('image-export');
      capture.querySelectorAll('.hot,.off').forEach(element => element.classList.remove('hot', 'off'));
      Object.assign(capture.style, { position: 'absolute', left: '-100000px', top: '0', width: width + 'px', maxWidth: 'none', padding: '40px', background: '#fff' });
      capture.querySelector('.scroll').style.overflow = 'visible';
      document.body.append(capture);
      const height = Math.ceil(capture.getBoundingClientRect().height);
      // Large recipes get a clear error instead of a silently cropped image.
      if (width * 3 > 32767 || height * 3 > 32767 || width * height * 9 > 100000000) throw new Error('This recipe is too large for a single 3× image. Use Print / PDF or Save HTML.');
      const canvas = await window.html2canvas(capture, { backgroundColor: '#fff', scale: 3, width, height, windowWidth: width, windowHeight: height, scrollX: 0, scrollY: 0, logging: false });
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.98));
      if (!blob) throw new Error('The browser could not create the image. Use Print / PDF or Save HTML.');
      if (copy) {
        $('export-status').textContent = 'Copying image · ' + canvas.width + ' × ' + canvas.height + ' px…';
        return blob;
      }
      download(blob, filename(format === 'jpeg' ? 'jpg' : format));
      $('export-status').textContent = format.toUpperCase() + ' exported · ' + canvas.width + ' × ' + canvas.height + ' px';
    } catch (error) {
      $('export-status').textContent = error.message;
    } finally {
      capture?.remove();
      if (wasEditing) setView(true);
      buttons.forEach(button => { button.disabled = false; });
      exporting = false;
    }
  }

  $('editor').addEventListener('focusin', event => {
    if (event.target.matches('.text-tool')) return;
    activeTextField = event.target.matches('input[type="text"], textarea') ? event.target : null;
    updateTextTools();
  });
  function updateTextTools() {
    document.querySelectorAll('.text-tool').forEach(button => { button.disabled = !activeTextField; });
  }
  function bulletField(element) {
    return Boolean(element?.matches('[data-field="instructions"], [data-kind="option"][data-field="text"], [data-kind="nested"][data-field="text"]'));
  }
  $('editor').addEventListener('keydown', event => {
    const field = event.target;
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !bulletField(field)) return;
    const { value, selectionStart, selectionEnd } = field;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const endIndex = value.indexOf('\n', selectionEnd);
    const line = value.slice(start, endIndex < 0 ? value.length : endIndex);
    const marker = line.match(/^\s*(?:[•*-]|(\d+)([.)]))\s+/);
    if (!marker) return;
    event.preventDefault();
    if (!line.slice(marker[0].length).trim()) field.setRangeText('', start, start + line.length, 'end');
    else field.setRangeText(marker[1] ? `\n${Number(marker[1]) + 1}${marker[2]} ` : '\n• ', selectionStart, selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.querySelectorAll('.text-tool').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
  document.querySelectorAll('.text-tool').forEach(button => button.addEventListener('click', () => {
    if (!activeTextField?.isConnected || !editing) return;
    const { selectionStart, selectionEnd, value } = activeTextField;
    const text = button.classList.contains('fraction') && /\d$/.test(value.slice(0, selectionStart)) ? ' ' + button.dataset.insert : button.dataset.insert;
    activeTextField.setRangeText(text, selectionStart, selectionEnd, 'end');
    activeTextField.focus();
    activeTextField.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  $('editor').addEventListener('input', event => {
    const { kind, id, field } = event.target.dataset;
    if (!kind || !field) return;
    const item = kind === 'recipe' ? recipe : kind === 'option' ? findOption(id).option : kind === 'nested' ? findNested(id).item : entries(kind, gridOf(id) || recipe).find(entry => entry.id === id);
    if (event.inputType?.startsWith('insert') && bulletField(event.target)) {
      const marker = /^[ \t]*[*-][ \t]+/gm;
      const value = event.target.value.replace(marker, '• ');
      if (value !== event.target.value) {
        const caret = event.target.value.slice(0, event.target.selectionStart).replace(marker, '• ').length;
        event.target.value = value;
        event.target.setSelectionRange(caret, caret);
      }
    }
    if (field === 'baseServings') {
      const count = M.number(event.target.value);
      if (count === null || count <= 0) {
        event.target.setCustomValidity('Enter a positive number of base servings.');
        $('save-status').textContent = 'Enter valid base servings';
        return;
      }
      event.target.setCustomValidity('');
      servings = count;
    }
    item[field] = event.target.value;
    if (event.target.tagName === 'TEXTAREA') resizeTextarea(event.target);
    changed(kind + ':' + id + ':' + field);
  });
  $('editor').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, kind, id } = button.dataset;
    const grid = button.dataset.grid ? gridById(button.dataset.grid) : (kind === 'ingredient' || kind === 'procedure') ? gridOf(id) : recipe;
    if (action === 'components') { openComponents(id); return; }
    if (action === 'focus-procedure') { focusProcedure(id); return; }
    if (action === 'add-ingredient') grid.ingredients.push(M.ingredient());
    if (action === 'add-step') grid.procedures.push(M.blankStep());
    let added;
    let inserted;
    if (action === 'insert-ingredient') {
      const index = Number(button.dataset.index);
      const [above, below] = [grid.ingredients[index - 1], grid.ingredients[index]];
      inserted = M.ingredient();
      grid.ingredients.splice(index, 0, inserted);
      // Inserting inside a merged procedure cell keeps the cell whole: the new item joins it.
      if (above && below) grid.procedures.forEach((stage, position) => {
        const mask = M.plan(grid, true).masks[position];
        if (mask.has(above.id) && mask.has(below.id) && !mask.has(inserted.id)) stage.inputs.push(inserted.id);
      });
    }
    if (action === 'add-at') {
      const group = M.columns(grid)[Number(button.dataset.slotColumn)];
      const row = button.dataset.row;
      added = { ...M.procedure(), inputs: [row.startsWith('output-') ? row.slice('output-'.length) : row] };
      placeInStep(grid, group, added);
      if (!M.validLayout(grid)) {
        grid.procedures.splice(grid.procedures.indexOf(added), 1);
        notify("A procedure can't go there.");
        return;
      }
    }
    if (action === 'add-parallel') {
      const group = M.columns(grid).find(indices => indices.includes(grid.procedures.findIndex(stage => stage.id === id)));
      added = M.procedure();
      placeInStep(grid, group, added);
    }
    if (action === 'add-note') recipe.notes.push({ id: M.id(), title: '', body: '' });
    if (action === 'add-preparation') recipe.prep.push(M.instruction());
    if (action === 'add-finishing') recipe.finish.push(M.instruction());
    if (action === 'add-decision') entries(kind).push(M.decision());
    if (action === 'add-grid') {
      // A new grid starts with as many blank steps as the widest grid, so its columns line up from the left.
      const created = M.processGrid();
      const steps = Math.max(...grids().map(other => M.columns(other).length));
      for (let count = 0; count < steps; count++) created.procedures.push(M.blankStep());
      entries(kind).push(created);
    }
    if (action === 'add-option') allDecisions().find(item => item.id === id).options.push(M.option());
    let nested;
    if (action === 'add-branch-step' || action === 'add-branch-decision') {
      nested = action === 'add-branch-step' ? M.instruction() : M.decision();
      branchItems(findOption(id).option).push(nested);
    }
    if (action === 'remove-option') {
      const { decision, option } = findOption(id);
      if (decision.options.length > 2) decision.options.splice(decision.options.indexOf(option), 1);
    }
    if (action === 'remove') {
      const list = kind === 'nested' ? findNested(id).list : entries(kind, grid);
      const index = list.findIndex(item => item.id === id);
      // Removing the first procedure of a shared column hands the column to the next one.
      if (kind === 'procedure' && !list[index].parallel && list[index + 1]?.parallel) list[index + 1].parallel = false;
      list.splice(index, 1);
      grid.procedures.forEach(stage => { stage.inputs = stage.inputs.filter(inputId => inputId !== id); });
      crossedOff.delete(id);
    }
    changed();
    renderEditor();
    if (action === 'insert-ingredient') {
      $('editor').querySelector(`[data-kind="ingredient"][data-id="${inserted.id}"][data-field="name"]`)?.focus();
    } else if (action === 'add-step') {
      $('entry-table').querySelector(`[data-column="${grid.procedures.at(-1).id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (action === 'add-parallel') {
      openComponents(added.id);
    } else if (action === 'add-at') {
      focusProcedure(added.id);
    } else if (action === 'add-decision' || action === 'add-grid') {
      const field = action === 'add-grid' ? 'title' : 'text';
      $('editor').querySelector(`[data-kind="${kind}"][data-id="${entries(kind).at(-1).id}"][data-field="${field}"]`)?.focus();
    } else if (nested) {
      $('editor').querySelector(`[data-kind="nested"][data-id="${nested.id}"][data-field="${nested.options ? 'text' : 'title'}"]`)?.focus();
    } else if (action === 'add-option') {
      const decision = allDecisions().find(item => item.id === id);
      $('editor').querySelector(`[data-kind="option"][data-id="${decision.options.at(-1).id}"][data-field="label"]`)?.focus();
    } else if (action.startsWith('add-')) {
      const addedKind = action.slice(4);
      const item = entries(addedKind, grid).at(-1);
      const field = addedKind === 'ingredient' ? 'name' : 'title';
      $('editor').querySelector(`[data-kind="${addedKind}"][data-id="${item.id}"][data-field="${field}"]`)?.focus();
    }
  });
  let drag = null;
  function rowAnchor(kind, id) {
    if (kind === 'nested') return $('editor').querySelector(`[data-kind="nested"][data-id="${id}"]`)?.closest('.branch-item');
    if (kind === 'ingredient') return $('entry-table').querySelector(`tr[data-row="${id}"]`);
    return $('editor').querySelector(`[data-kind="${kind}"][data-id="${id}"]`)?.closest('tr');
  }
  function procedureCells(id) {
    return [...$('entry-table').querySelectorAll(`[data-kind="procedure"][data-id="${id}"][data-field="title"], [data-procedure-reference="${id}"]`)].map(element => element.closest('td'));
  }
  function columnStages(grid) {
    return M.columns(grid).map(group => group.map(index => grid.procedures[index]));
  }
  function setColumns(grid, groups) {
    groups = groups.map(group => group.some(stage => !stage.blank && !stage.placeholder) ? group.filter(stage => !stage.blank) : group);
    grid.procedures.splice(0, grid.procedures.length, ...groups.filter(group => group.length).flatMap(group => group.map((stage, index) => Object.assign(stage, { parallel: index > 0 }))));
  }
  function placeColumns(grid, groups) {
    const current = columnStages(grid);
    setColumns(grid, groups);
    if (M.validLayout(grid)) return true;
    setColumns(grid, current);
    return false;
  }
  function procedureSnapshot(grid) {
    const saved = grid.procedures.map(stage => ({ stage, parallel: Boolean(stage.parallel), inputs: stage.inputs.slice() }));
    return () => grid.procedures.splice(0, grid.procedures.length, ...saved.map(entry => Object.assign(entry.stage, { parallel: entry.parallel, inputs: entry.inputs })));
  }
  function procedureSignature(grid) {
    return () => JSON.stringify(grid.procedures.map(stage => [stage.id, Boolean(stage.parallel), stage.inputs]));
  }
  // Rows: ingredients, preparation and finishing entries, notes.
  function listDrag(kind, id) {
    const list = kind === 'nested' ? findNested(id).list : entries(kind, kind === 'ingredient' ? gridOf(id) : recipe);
    const item = list.find(entry => entry.id === id);
    const original = list.slice();
    const cells = () => {
      if (kind === 'nested') return [rowAnchor(kind, id)].filter(Boolean);
      if (kind === 'ingredient') return [...$('entry-table').querySelectorAll(`tr[data-row="${id}"] > .editor-ingredient`)];
      const row = rowAnchor(kind, id);
      if (!row) return [];
      const rows = [row];
      // A process grid moves with its heading and ingredient rows, up to the next preparation or finishing row.
      if (item.ingredients) for (let next = row.nextElementSibling; next && !next.querySelector(':scope > td.prep, :scope > td.finish'); next = next.nextElementSibling) rows.push(next);
      return rows.flatMap(tr => [...tr.children]);
    };
    return {
      axis: 'y', cells, source: () => cells()[0],
      restore: () => list.splice(0, list.length, ...original),
      signature: () => list.map(entry => entry.id).join(),
      update() {
        const order = list.filter(entry => entry !== item);
        order.splice(order.filter(entry => {
          const box = rowAnchor(kind, entry.id)?.getBoundingClientRect();
          return box && drag.y > box.top + box.height / 2;
        }).length, 0, item);
        if (order.every((entry, index) => entry === list[index])) return false;
        list.splice(0, list.length, ...order);
        return true;
      },
      step(direction) {
        const index = list.indexOf(item);
        const other = index + direction;
        if (other < 0 || other >= list.length) return false;
        [list[index], list[other]] = [list[other], list[index]];
        return true;
      },
    };
  }
  // An ingredient row can move within its grid or into another process grid.
  function ingredientDrag(id) {
    const home = gridOf(id);
    const item = home.ingredients.find(entry => entry.id === id);
    const saved = grids().map(grid => ({ grid, ingredients: grid.ingredients.slice(), inputs: grid.procedures.map(stage => stage.inputs.slice()) }));
    const homeInputs = saved.find(entry => entry.grid === home).inputs;
    const within = listDrag('ingredient', id);
    return {
      ...within,
      restore: () => saved.forEach(entry => {
        entry.grid.ingredients.splice(0, entry.grid.ingredients.length, ...entry.ingredients);
        entry.grid.procedures.forEach((stage, index) => { stage.inputs = entry.inputs[index].slice(); });
      }),
      signature: () => grids().map(grid => grid.ingredients.map(entry => entry.id).join()).join('|'),
      update() {
        let target = { grid: grids()[0], index: 0 };
        for (const grid of grids()) {
          const heading = $('entry-table').querySelector(`[data-grid-heading="${grid.id}"]`)?.getBoundingClientRect();
          if (heading && heading.top + heading.height / 2 < drag.y) target = { grid, index: 0 };
          grid.ingredients.filter(entry => entry !== item).forEach((entry, index) => {
            const box = rowAnchor('ingredient', entry.id)?.getBoundingClientRect();
            if (box && box.top + box.height / 2 < drag.y) target = { grid, index: index + 1 };
          });
        }
        const current = gridOf(id);
        if (current === target.grid && current.ingredients.indexOf(item) === target.index) return false;
        current.ingredients.splice(current.ingredients.indexOf(item), 1);
        target.grid.ingredients.splice(target.index, 0, item);
        // Procedures only use items from their own grid, so the item keeps its links only while it stays home.
        home.procedures.forEach((stage, index) => { stage.inputs = target.grid === home ? homeInputs[index].slice() : homeInputs[index].filter(input => input !== id); });
        return true;
      },
    };
  }
  // A whole procedure column, by its header grip.
  function columnDrag(id) {
    const grid = gridOf(id);
    const stage = findProcedure(id);
    const groupOf = groups => groups.find(group => group.includes(stage));
    const anchor = group => $('entry-table').querySelector(`[data-column="${group[0].id}"]`);
    return {
      axis: 'x', restore: procedureSnapshot(grid), signature: procedureSignature(grid),
      cells: () => {
        const group = groupOf(columnStages(grid));
        return [anchor(group), ...group.flatMap(item => procedureCells(item.id))].filter(Boolean);
      },
      source: () => procedureCells(groupOf(columnStages(grid))[0].id)[0],
      update() {
        const groups = columnStages(grid);
        const group = groupOf(groups);
        const order = groups.filter(other => other !== group);
        order.splice(order.filter(other => {
          const box = anchor(other)?.getBoundingClientRect();
          return box && drag.x > box.left + box.width / 2;
        }).length, 0, group);
        if (order.every((other, index) => other === groups[index])) return false;
        return placeColumns(grid, order);
      },
      step(direction) {
        const groups = columnStages(grid);
        const index = groups.indexOf(groupOf(groups));
        const other = index + direction;
        if (other < 0 || other >= groups.length) return false;
        [groups[index], groups[other]] = [groups[other], groups[index]];
        return placeColumns(grid, groups);
      },
    };
  }
  // One procedure cell: drop it on a column to share it, or on a column's edge to give it a column of its own.
  function stageDrag(id) {
    const grid = gridOf(id);
    const stage = findProcedure(id);
    const before = columnStages(grid);
    const home = before.findIndex(group => group.includes(stage));
    // While the procedure is away, an empty placeholder keeps its old column so the others don't shift under the cursor.
    const placeholder = { ...M.procedure(), id: 'placeholder-' + M.id(), placeholder: true };
    const base = before.map(group => group.filter(other => other !== stage)).map(group => group.length ? group : [placeholder]);
    let layout = { join: home };
    const arrange = next => {
      const groups = base.map(group => group.slice());
      if (next.join === undefined) groups.splice(next.before, 0, [stage]);
      else if (groups[next.join][0] === placeholder) groups[next.join] = [stage];
      else groups[next.join].push(stage);
      return placeColumns(grid, groups);
    };
    return {
      axis: 'x', restore: procedureSnapshot(grid), signature: procedureSignature(grid),
      cells: () => procedureCells(id),
      source: () => procedureCells(id)[0],
      finish: () => setColumns(grid, columnStages(grid).map(group => group.filter(item => !item.placeholder))),
      update() {
        let next = null;
        base.forEach((group, index) => {
          const box = $('entry-table').querySelector(`[data-column="${group[0].id}"]`)?.getBoundingClientRect();
          if (next || !box || drag.x < box.left || drag.x > box.right) return;
          const quarter = box.width / 4;
          next = drag.x < box.left + quarter ? { before: index } : drag.x > box.right - quarter ? { before: index + 1 } : { join: index };
        });
        if (!next || JSON.stringify(next) === JSON.stringify(layout) || !arrange(next)) return false;
        layout = next;
        return true;
      },
      step(direction) {
        const groups = columnStages(grid);
        const index = groups.findIndex(group => group.includes(stage));
        // Alone in its column, it swaps with the neighbouring column; sharing one, it steps out into a new column beside it.
        if (groups[index].length === 1) {
          const other = index + direction;
          if (other < 0 || other >= groups.length) return false;
          [groups[index], groups[other]] = [groups[other], groups[index]];
        } else {
          groups[index] = groups[index].filter(item => item !== stage);
          groups.splice(direction < 0 ? index : index + 1, 0, [stage]);
        }
        return placeColumns(grid, groups);
      },
    };
  }
  // A procedure's top or bottom edge: drag to take in or let go of neighbouring rows.
  function edgeDrag(handle) {
    const { id, edge } = handle.dataset;
    const grid = gridOf(id);
    const stage = findProcedure(id);
    const original = stage.inputs.slice();
    const { rows, masks } = M.plan(grid, true);
    const ids = rows.map(row => row.id);
    const cell = handle.closest('td');
    const start = ids.indexOf(cell.closest('tr').dataset.row);
    const end = start + cell.rowSpan - 1;
    const index = grid.procedures.indexOf(stage);
    const groups = M.columns(grid);
    const columnOf = stageId => groups.findIndex(group => group.some(other => grid.procedures[other].id === stageId));
    const taken = new Set(groups[columnOf(id)].filter(other => other !== index).flatMap(other => [...masks[other]]));
    // Rows that come from an earlier procedure's output stay put; remove that output in the component picker instead.
    const locked = row => masks[index].has(row) && !original.includes(row);
    const addable = row => !taken.has(row) && (!row.startsWith('output-') || (columnOf(row.slice(7)) >= 0 && columnOf(row.slice(7)) < columnOf(id)));
    return {
      axis: 'y', resize: true, restore: procedureSnapshot(grid), signature: procedureSignature(grid),
      cells: () => procedureCells(id),
      update() {
        const passed = ids.filter(row => {
          const box = $('entry-table').querySelector(`tr[data-row="${row}"]`)?.getBoundingClientRect();
          return box && box.top + box.height / 2 < drag.y;
        }).length;
        let from = start;
        let to = end;
        if (edge === 'bottom') to = Math.max(start, passed - 1);
        else from = Math.min(end, passed);
        for (let row = end + 1; row <= to; row++) if (!addable(ids[row])) { to = row - 1; break; }
        for (let row = start - 1; row >= from; row--) if (!addable(ids[row])) { from = row + 1; break; }
        for (let row = end; row > to; row--) if (locked(ids[row])) { to = row; break; }
        for (let row = start; row < from; row++) if (locked(ids[row])) { from = row; break; }
        const inputs = new Set(original);
        ids.forEach((row, position) => {
          const wasIn = position >= start && position <= end;
          const isIn = position >= from && position <= to;
          if (wasIn && !isIn) inputs.delete(row);
          if (isIn && !wasIn) inputs.add(row.startsWith('output-') ? row.slice(7) : row);
        });
        const next = [...inputs];
        if (next.join() === stage.inputs.join()) return false;
        const previous = stage.inputs;
        stage.inputs = next;
        if (M.validLayout(grid)) return true;
        stage.inputs = previous;
        return false;
      },
    };
  }
  function dragConfig(kind, id) {
    return kind === 'column' ? columnDrag(id) : kind === 'stage' ? stageDrag(id) : kind === 'ingredient' ? ingredientDrag(id) : listDrag(kind, id);
  }
  function markDrag() {
    drag.cells().forEach(cell => cell?.classList.add(drag.resize ? 'edge-active' : 'drag-source'));
  }
  function placeGhost() {
    if (!drag.ghost) return;
    const { width, height } = drag.ghost.getBoundingClientRect();
    const left = Math.max(4, Math.min(drag.x - drag.offsetX, innerWidth - width - 4));
    const top = Math.max(4, Math.min(drag.y - drag.offsetY, innerHeight - height - 4));
    drag.ghost.style.transform = `translate(${left}px, ${top}px)`;
  }
  function dragUpdate() {
    placeGhost();
    if (!drag.update()) return;
    renderEditor();
    markDrag();
  }
  function dragAutoScroll() {
    const edge = 48;
    const box = $('entry-table').getBoundingClientRect();
    const dy = drag.y < edge ? -12 : drag.y > innerHeight - edge ? 12 : 0;
    const dx = drag.axis !== 'x' ? 0 : drag.x < box.left + edge ? -12 : drag.x > box.right - edge ? 12 : 0;
    if (dy) scrollBy(0, dy);
    if (dx) $('entry-table').scrollLeft += dx;
    if (dx || dy) dragUpdate();
  }
  function dragEnd(cancel) {
    clearInterval(drag.timer);
    drag.ghost?.remove();
    document.body.classList.remove('dragging', 'resizing');
    if (cancel) drag.restore();
    else drag.finish?.();
    const moved = drag.signature() !== drag.before;
    drag = null;
    renderEditor();
    if (moved) changed();
  }
  function startDrag(config, event) {
    drag = { ...config, x: event.clientX, y: event.clientY, before: config.signature() };
    renderEditor();
    if (!drag.resize) {
      const source = drag.source();
      const box = source.getBoundingClientRect();
      const width = Math.min(box.width, 560);
      const table = document.createElement('table');
      table.className = 'entry-grid';
      let clone = source.cloneNode(true);
      if (!/^T[DH]$/.test(clone.tagName)) {
        const cell = document.createElement('td');
        cell.append(clone);
        clone = cell;
      }
      clone.removeAttribute('rowspan');
      clone.removeAttribute('colspan');
      clone.querySelectorAll('.edge-handle').forEach(element => element.remove());
      [clone, ...clone.querySelectorAll('*')].forEach(element => [...element.attributes].filter(attribute => attribute.name !== 'data-kind' && attribute.name !== 'data-field' && (attribute.name === 'id' || attribute.name.startsWith('data-'))).forEach(attribute => element.removeAttribute(attribute.name)));
      table.insertRow().append(clone);
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost';
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.style.width = width + 'px';
      drag.ghost.append(table);
      $('editor').append(drag.ghost);
      drag.offsetX = Math.max(12, Math.min(event.clientX - box.left, width - 12));
      drag.offsetY = Math.max(12, Math.min(event.clientY - box.top, Math.min(box.height, 320) - 12));
    }
    document.body.classList.add(drag.resize ? 'resizing' : 'dragging');
    markDrag();
    placeGhost();
    drag.timer = setInterval(dragAutoScroll, 16);
  }
  $('editor').addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    const edge = event.target.closest('.edge-handle');
    const handle = event.target.closest('.drag-handle');
    if (!edge && !handle) return;
    event.preventDefault();
    startDrag(edge ? edgeDrag(edge) : dragConfig(handle.dataset.kind, handle.dataset.id), event);
  });
  $('editor').addEventListener('keydown', event => {
    const handle = event.target.closest?.('.drag-handle');
    if (!handle || drag) return;
    const { kind, id } = handle.dataset;
    const horizontal = kind === 'column' || kind === 'stage';
    const direction = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!direction || horizontal !== (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
    event.preventDefault();
    if (!dragConfig(kind, id).step(direction)) return;
    renderEditor();
    changed();
    $('editor').querySelector(`.drag-handle[data-kind="${kind}"][data-id="${id}"]`)?.focus();
  });
  window.addEventListener('pointermove', event => {
    if (!drag) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    dragUpdate();
  });
  window.addEventListener('pointerup', () => { if (drag) dragEnd(false); });
  window.addEventListener('pointercancel', () => { if (drag) dragEnd(true); });
  window.addEventListener('keydown', event => { if (drag && event.key === 'Escape') dragEnd(true); });
  $('cancel-components').addEventListener('click', () => $('components-dialog').close());
  $('components-dialog').addEventListener('close', () => focusProcedure(selectedProcedure.id));
  $('apply-components').addEventListener('click', () => {
    const previous = selectedProcedure.inputs;
    selectedProcedure.inputs = Array.from($('component-options').querySelectorAll('input:checked'), item => item.value);
    if (!M.validLayout(gridOf(selectedProcedure.id))) {
      selectedProcedure.inputs = previous;
      notify('Those items overlap another procedure in this column.');
    }
    $('components-dialog').close();
    changed();
    renderEditor();
  });
  $('editor').addEventListener('toggle', event => {
    if (event.target.tagName === 'DETAILS' && event.target.open) event.target.querySelectorAll('textarea').forEach(resizeTextarea);
  }, true);
  $('edit-tab').addEventListener('click', () => setView(true));
  $('preview-tab').addEventListener('click', () => setView(false));
  $('save-recipe').addEventListener('click', () => { save(); notify($('save-status').textContent); });
  $('new-recipe').addEventListener('click', () => {
    save();
    stopCooking();
    recipe = M.blankRecipe();
    library.recipes.push(recipe);
    servings = 4;
    units = 'main';
    crossedOff.clear();
    renderEditor();
    renderCard();
    setView(true);
    save();
    $('recipe-name').focus();
  });
  $('monochrome-toggle').addEventListener('click', () => {
    recipe.monochrome = !recipe.monochrome;
    changed();
  });
  $('delete-recipe').addEventListener('click', () => {
    if (!confirm(`Delete “${recipe.name || 'Untitled recipe'}”? This can't be undone.`)) return;
    stopCooking();
    const index = library.recipes.indexOf(recipe);
    library.recipes.splice(index, 1);
    if (!library.recipes.length) library.recipes.push(M.blankRecipe());
    recipe = library.recipes[Math.min(index, library.recipes.length - 1)];
    servings = Number(recipe.baseServings) || 4;
    crossedOff.clear();
    renderEditor();
    renderCard();
    save();
    notify('Recipe deleted.');
  });
  $('duplicate-recipe').addEventListener('click', () => {
    save();
    stopCooking();
    const copy = { ...structuredClone(recipe), id: M.id(), name: (recipe.name || 'Untitled recipe') + ' (copy)' };
    library.recipes.splice(library.recipes.indexOf(recipe) + 1, 0, copy);
    recipe = copy;
    crossedOff.clear();
    renderEditor();
    renderCard();
    save();
    notify('Duplicated as “' + recipe.name + '”.');
  });
  $('saved-recipes').addEventListener('change', event => {
    const selectedId = event.target.value;
    save();
    stopCooking();
    recipe = library.recipes.find(item => item.id === selectedId);
    servings = Number(recipe.baseServings) || 4;
    crossedOff.clear();
    renderEditor();
    renderCard();
    save();
  });
  document.querySelectorAll('[data-servings]').forEach(button => button.addEventListener('click', () => { servings = Number(button.dataset.servings); renderCard(); }));
  $('serving-value').addEventListener('change', event => {
    if (event.target.checkValidity() && Number(event.target.value) > 0) { servings = Number(event.target.value); renderCard(); }
    else event.target.reportValidity();
  });
  $('start-cooking').addEventListener('click', () => goTo(0));
  $('previous-stage').addEventListener('click', () => goTo(step - 1));
  $('next-stage').addEventListener('click', () => goTo(step + 1));
  $('stop-cooking').addEventListener('click', stopCooking);
  function cardAction(event) {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const stage = event.target.closest('[data-stage]');
    const ingredient = event.target.closest('[data-ingredient]:not(.preparation)');
    if (!stage && !ingredient) return;
    if (event.type === 'keydown') event.preventDefault();
    if (stage) goTo(Number(stage.dataset.stage));
    else {
      const id = ingredient.dataset.ingredient;
      if (crossedOff.has(id)) crossedOff.delete(id); else crossedOff.add(id);
      ingredient.classList.toggle('off', crossedOff.has(id));
      ingredient.setAttribute('aria-pressed', crossedOff.has(id));
    }
  }
  $('recipe-card').addEventListener('click', cardAction);
  $('recipe-card').addEventListener('keydown', cardAction);
  $('export-html').addEventListener('click', exportHTML);
  $('open-export').addEventListener('click', () => $('export-dialog').showModal());
  $('cancel-export').addEventListener('click', () => $('export-dialog').close());
  function copyImage() {
    $('export-dialog').close();
    if (!navigator.clipboard?.write || !window.ClipboardItem) {
      $('export-status').textContent = "This browser can't copy images. Use HQ PNG to download instead.";
      return;
    }
    // The clipboard write must start inside the click, so it receives the image while it's still rendering.
    const image = exportImage('png', true).then(blob => blob || Promise.reject(new Error('No image')));
    navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
      .then(() => { $('export-status').textContent = $('export-status').textContent.replace('Copying image', 'Image copied').replace('…', ' · paste it anywhere'); })
      .catch(() => { if (!/too large|could not/.test($('export-status').textContent)) $('export-status').textContent = "The image couldn't be copied. Use HQ PNG to download instead."; });
  }
  $('copy-png').addEventListener('click', copyImage);
  $('export-png').addEventListener('click', () => { $('export-dialog').close(); exportImage('png'); });
  $('export-jpeg').addEventListener('click', () => { $('export-dialog').close(); exportImage('jpeg'); });
  $('export-pdf').addEventListener('click', () => { $('export-dialog').close(); save(); stopCooking(); setView(false); window.print(); });
  $('undo').addEventListener('click', () => travel('past', 'future'));
  $('redo').addEventListener('click', () => travel('future', 'past'));
  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (!(event.metaKey || event.ctrlKey) || event.altKey || (key !== 'z' && key !== 'y') || drag) return;
    // Inside a text field the browser's own undo handles the text being typed.
    if (event.target.matches?.('input:not([type="checkbox"]), textarea, select')) return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) travel('future', 'past');
    else travel('past', 'future');
  });
  // Saving to GitHub: writes the library to the repository set by main.js (window.recipeGitHub), which redeploys the site.
  // Exported HTML files have no repository, so the button stays hidden there.
  const repo = window.recipeGitHub;
  const tokenKey = 'recipe-generator.github-token';
  const readToken = () => { try { return localStorage.getItem(tokenKey) || ''; } catch { return ''; } };
  const jakartaTime = time => new Date(time).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const toBase64 = text => { let binary = ''; new TextEncoder().encode(text).forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); };
  const fromBase64 = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, '')), character => character.charCodeAt(0)));
  const recipeName = item => item.name || 'Untitled recipe';
  // An untouched new recipe is not worth saving.
  const isEmpty = item => !filled(item.name, item.description) && !item.ingredients?.some(entry => filled(entry.name)) && !item.procedures?.some(entry => filled(entry.title, entry.instructions));
  async function github(token, path, options = {}) {
    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}${path}`, { ...options, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' } });
    } catch {
      throw new Error("Couldn't reach GitHub. Check your internet connection and try again.");
    }
    if (response.ok || (response.status === 404 && !options.method)) return response;
    const detail = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("GitHub didn't accept the token. It may be mistyped, expired or deleted.");
    if (response.status === 403 || response.status === 404) throw new Error(`The token can't write to ${repo.owner}/${repo.repo}. Check that it includes this repository and that Contents is set to Read and write.`);
    if (response.status === 409 || response.status === 422) throw new Error('The recipes on GitHub changed while saving. Try saving again.');
    throw new Error(`GitHub error ${response.status}${detail.message ? ': ' + detail.message : ''}.`);
  }
  async function readRemote(token) {
    const response = await github(token, `/contents/${repo.path}?ref=${encodeURIComponent(repo.branch)}`);
    if (response.status === 404) return { sha: null, data: { recipes: [] } };
    const file = await response.json();
    return { sha: file.sha, data: JSON.parse(fromBase64(file.content)) };
  }
  function markSynced(sha, recipes) {
    library.github = { ...library.github, sha, ...(recipes ? { savedAt: Date.now() } : {}) };
    if (recipes) markImported(recipes.map(versionToken));
    save();
  }
  // Brings in recipes that were saved to GitHub from another browser or device.
  async function pullFromGitHub() {
    const remote = await readRemote(readToken());
    const imported = importRecipes(remote.data.recipes);
    if (imported.length) {
      imported.forEach(item => histories.delete(item.id));
      recipe = library.recipes.find(item => item.id === recipe.id) || recipe;
      servings = Number(recipe.baseServings) || 4;
      renderEditor();
      renderCard();
      notify('Loaded the latest from GitHub: ' + imported.map(recipeName).join(', ') + '.');
    }
    if (remote.sha) markSynced(remote.sha);
    return imported;
  }
  function githubStatus(text) { $('github-status').textContent = text; }
  function githubBusy(busy) {
    ['github-connect-button', 'github-save', 'github-disconnect', 'github-token'].forEach(id => { $(id).disabled = busy; });
  }
  function renderGitHubDialog() {
    const connected = Boolean(readToken());
    $('github-connect').hidden = connected;
    $('github-connected').hidden = !connected;
    $('github-connect-button').hidden = connected;
    $('github-save').hidden = !connected;
    $('github-disconnect').hidden = !connected;
    $('github-last').textContent = library.github?.savedAt ? 'Last saved from this browser on ' + jakartaTime(library.github.savedAt) + '.' : 'Nothing saved from this browser yet.';
    $('github-token').value = '';
  }
  async function connectGitHub() {
    const token = $('github-token').value.trim();
    if (!token) { githubStatus('Paste a token first.'); $('github-token').focus(); return; }
    githubBusy(true);
    githubStatus('Checking the token…');
    try {
      await readRemote(token);
      try { localStorage.setItem(tokenKey, token); } catch { throw new Error("This browser can't store the token. Private windows often block it."); }
      renderGitHubDialog();
      githubStatus('Connected. Loading the latest recipes…');
      const imported = await pullFromGitHub();
      githubStatus(imported.length ? 'Connected, and loaded the latest recipes from GitHub.' : 'Connected.');
      $('github-save').focus();
    } catch (error) {
      githubStatus(error.message);
    } finally {
      githubBusy(false);
    }
  }
  async function saveToGitHub() {
    save();
    const token = readToken();
    githubBusy(true);
    githubStatus('Checking GitHub…');
    try {
      const remote = await readRemote(token);
      const recipes = library.recipes.filter(item => !isEmpty(item));
      if (!recipes.length) { githubStatus('There are no recipes with content to save.'); return; }
      const ids = new Set(recipes.map(item => item.id));
      const before = new Map((remote.data.recipes || []).map(item => [item.id, item]));
      const removed = [...before.values()].filter(item => !ids.has(item.id));
      const added = recipes.filter(item => !before.has(item.id));
      const updated = recipes.filter(item => before.has(item.id) && JSON.stringify(item) !== JSON.stringify(before.get(item.id)));
      if (!added.length && !updated.length && !removed.length && remote.sha) {
        markSynced(remote.sha, recipes);
        githubStatus('GitHub already has these recipes. Nothing to save.');
        return;
      }
      const warnings = [];
      if (library.github?.sha && remote.sha && remote.sha !== library.github.sha) warnings.push('The recipes on GitHub were changed from another browser after this one last loaded them. Saving replaces that version with the recipes in this browser.');
      if (removed.length) warnings.push('These recipes are on GitHub but not in this browser, so saving removes them from GitHub and the website: ' + removed.map(recipeName).join(', ') + '.');
      if (warnings.length && !confirm(warnings.join('\n\n') + '\n\nSave anyway?')) { githubStatus('Not saved.'); return; }
      githubStatus('Saving…');
      const summary = [['Add', added], ['Update', updated], ['Remove', removed]].filter(([, list]) => list.length).map(([verb, list]) => verb + ' ' + list.map(recipeName).join(', ')).join('; ');
      const data = { selectedId: ids.has(remote.data.selectedId) ? remote.data.selectedId : recipe.id, recipes };
      const response = await github(token, `/contents/${repo.path}`, { method: 'PUT', body: JSON.stringify({ message: summary || 'Update recipes', content: toBase64(JSON.stringify(data, null, 2) + '\n'), branch: repo.branch, ...(remote.sha ? { sha: remote.sha } : {}) }) });
      const result = await response.json();
      markSynced(result.content.sha, recipes);
      renderGitHubDialog();
      githubStatus('Saved. The website updates in about a minute.');
      notify('Saved to GitHub: ' + summary + '.');
    } catch (error) {
      githubStatus(error.message);
    } finally {
      githubBusy(false);
    }
  }
  $('open-github').hidden = !repo;
  if (repo) {
    document.querySelectorAll('.github-repo').forEach(element => { element.textContent = `${repo.owner}/${repo.repo}`; });
    document.querySelectorAll('.github-repo-name').forEach(element => { element.textContent = repo.repo; });
    document.querySelectorAll('.github-file').forEach(element => { element.textContent = repo.path; });
  }
  $('open-github').addEventListener('click', () => { renderGitHubDialog(); githubStatus(''); $('github-dialog').showModal(); });
  $('cancel-github').addEventListener('click', () => $('github-dialog').close());
  $('github-connect-button').addEventListener('click', connectGitHub);
  $('github-token').addEventListener('keydown', event => { if (event.key === 'Enter') connectGitHub(); });
  $('github-save').addEventListener('click', saveToGitHub);
  $('github-disconnect').addEventListener('click', () => {
    try { localStorage.removeItem(tokenKey); } catch { /* Nothing stored. */ }
    renderGitHubDialog();
    githubStatus('Disconnected. The token is removed from this browser. You can also delete it on GitHub.');
  });
  window.addEventListener('beforeunload', save);
  renderLibrary();
  renderEditor();
  renderCard();
  setView(true);
  save();
  if (repo && readToken() && !snapshot) pullFromGitHub().catch(error => notify(error.message));
};

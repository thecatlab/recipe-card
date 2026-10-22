(function () {
  function id() { return crypto.randomUUID(); }
  function ingredient() {
    return { id: id(), name: '', description: '', quantity: '', unit: '', metricQuantity: '', metricUnit: '' };
  }
  function procedure() {
    return { id: id(), title: '', instructions: '', inputs: [], minutes: '', outputName: '', outputDescription: '', outputQuantity: '', outputUnit: '', tools: '', parallel: false };
  }
  function instruction() { return { id: id(), title: '', text: '', tools: '' }; }
  // A decision branch: its answer ("Yes"), name, instructions, notes, and further instructions or decisions nested under it.
  function option() { return { id: id(), answer: '', label: '', text: '', tools: '', items: [] }; }
  // An empty step column: holds a column's place until a procedure goes into it.
  function blankStep() { return { ...procedure(), blank: true }; }
  function processGrid() { return { id: id(), title: '', ingredients: [ingredient()], procedures: [] }; }
  function decision() { return { id: id(), text: '', options: [option(), option()] }; }
  function blankRecipe() {
    return { id: id(), name: '', description: '', eyebrow: '', baseServings: 4, yieldUnit: '', active: '', total: '', vessel: '', prep: [instruction()], finish: [instruction()], credit: '', monochrome: false, ingredients: [ingredient()], procedures: [], notes: [] };
  }
  function number(value) {
    let text = String(value).trim();
    const fractions = { '⅛': '1/8', '¼': '1/4', '⅜': '3/8', '½': '1/2', '⅝': '5/8', '¾': '3/4', '⅞': '7/8', '⅓': '1/3', '⅔': '2/3' };
    text = text.replace(/[⅛¼⅜½⅝¾⅞⅓⅔]/g, match => ' ' + fractions[match]).trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    const match = text.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
    if (match && Number(match[3])) return Number(match[1] || 0) + Number(match[2]) / Number(match[3]);
    return null;
  }
  function decimal(value) {
    return String(Number(value.toFixed(Math.abs(value) < 1 ? 3 : 2)));
  }
  function quantity(value, factor = 1) {
    const parsed = number(value);
    if (parsed === null) return String(value).trim();
    const result = parsed * factor;
    if (/[\/⅛¼⅜½⅝¾⅞⅓⅔]/.test(String(value))) {
      const whole = Math.floor(result);
      if (Math.abs(result - whole) < 0.001) return String(Math.round(result));
      for (const denominator of [2, 3, 4, 8]) {
        const numerator = Math.round((result - whole) * denominator);
        if (numerator > 0 && numerator < denominator && Math.abs(result - whole - numerator / denominator) < 0.001) {
          return (whole ? whole + ' ' : '') + numerator + '/' + denominator;
        }
      }
    }
    return decimal(result);
  }
  const metricUnits = {
    mg: { dimension: 'mass', size: 0.001, names: ['mg', 'milligram', 'milligrams', 'milligramme', 'milligrammes'] },
    g: { dimension: 'mass', size: 1, names: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'] },
    kg: { dimension: 'mass', size: 1000, names: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes'] },
    ml: { dimension: 'volume', size: 1, names: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'] },
    l: { dimension: 'volume', size: 1000, names: ['l', 'ltr', 'litre', 'litres', 'liter', 'liters'] },
  };
  function unitLabel(key, written, amount) {
    const lower = written.trim().toLowerCase();
    if (!/gram|lit|kilo/.test(lower)) return { mg: 'mg', g: 'g', kg: 'kg', ml: written.includes('L') ? 'mL' : 'ml', l: 'L' }[key];
    const ending = /er/.test(lower) ? 'er' : 're';
    const name = { mg: 'milligram', g: 'gram', kg: 'kilogram', ml: 'millilit' + ending, l: 'lit' + ending }[key];
    return amount === 1 ? name : name + 's';
  }
  function scaleMeasure(value, unit = '', factor = 1) {
    const parsed = number(value);
    const written = String(unit ?? '');
    const key = Object.keys(metricUnits).find(name => metricUnits[name].names.includes(written.trim().toLowerCase().replace(/\.$/, '')));
    if (parsed === null || factor === 1 || !key) return { quantity: quantity(value, factor), unit: written };
    const base = parsed * factor * metricUnits[key].size;
    const choices = Object.keys(metricUnits).filter(name => metricUnits[name].dimension === metricUnits[key].dimension && (name !== 'mg' || key === 'mg')).sort((a, b) => metricUnits[b].size - metricUnits[a].size);
    const target = choices.find(name => Math.abs(base) / metricUnits[name].size >= 1) || choices.at(-1);
    if (target === key) return { quantity: quantity(value, factor), unit: written };
    const amount = Number(decimal(base / metricUnits[target].size));
    return { quantity: String(amount), unit: unitLabel(target, written, amount) };
  }
  function bullets(text) {
    const blocks = [];
    let gap = false;
    for (const line of String(text ?? '').split('\n')) {
      // "• item", "- item" or "* item" is a bullet; "1. item" or "1) item" is numbered.
      const match = line.match(/^\s*(?:[•*-]|(\d+)[.)])\s+(.*)$/);
      const last = blocks.at(-1);
      if (!line.trim()) {
        if (last && !last.list) last.lines.push('');
        gap = blocks.length > 0;
      } else if (match) {
        const ordered = match[1] !== undefined;
        if (last?.list && !gap && Boolean(last.ordered) === ordered) last.items.push(match[2]);
        else blocks.push({ list: true, items: [match[2]], ...(ordered && { ordered: true, start: Number(match[1]) }), ...(gap && { space: true }) });
        gap = false;
      } else {
        if (last && !last.list) last.lines.push(line);
        else blocks.push({ list: false, lines: [line], ...(gap && { space: true }) });
        gap = false;
      }
    }
    return blocks.map(({ lines, ...block }) => block.list ? block : { ...block, text: lines.join('\n').trim() });
  }
  function plan(recipe, includeEmpty = false) {
    const rows = includeEmpty ? recipe.ingredients.slice() : recipe.ingredients.filter(item => [item.name, item.description, item.quantity, item.unit, item.metricQuantity, item.metricUnit].some(value => String(value).trim()));
    const masks = [];
    const ingredientIds = new Set(rows.map(item => item.id));
    recipe.procedures.forEach((stage, index) => {
      if (stage.placeholder || stage.blank) { masks.push(new Set()); return; }
      const mask = new Set();
      stage.inputs.forEach(input => {
        if (ingredientIds.has(input)) mask.add(input);
        const previous = recipe.procedures.findIndex(item => item.id === input);
        if (previous >= 0 && previous < index) masks[previous].forEach(item => mask.add(item));
      });
      if (!mask.size) {
        const rowId = 'output-' + stage.id;
        rows.push({ id: rowId, name: stage.outputName || stage.title || 'Procedure ' + (index + 1), description: stage.outputDescription, quantity: stage.outputQuantity, unit: stage.outputUnit, metricQuantity: '', metricUnit: '', preparation: true });
        mask.add(rowId);
      }
      masks.push(mask);
    });
    return { rows, masks };
  }
  // Procedures sit in columns; a procedure marked `parallel` shares the column of the one before it.
  function columns(recipe) {
    const result = [];
    recipe.procedures.forEach((stage, index) => {
      if (index && stage.parallel) result.at(-1).push(index);
      else result.push([index]);
    });
    return result;
  }
  // A layout is valid when every procedure only uses outputs from earlier columns
  // and procedures sharing a column never cover the same row.
  function validLayout(recipe) {
    const columnOf = new Map();
    columns(recipe).forEach((column, number) => column.forEach(index => columnOf.set(recipe.procedures[index].id, number)));
    if (recipe.procedures.some(stage => stage.inputs.some(input => columnOf.has(input) && columnOf.get(input) >= columnOf.get(stage.id)))) return false;
    const { masks } = plan(recipe, true);
    return columns(recipe).every(column => {
      const seen = new Set();
      return column.every(index => [...masks[index]].every(row => !seen.has(row) && seen.add(row)));
    });
  }
  globalThis.RecipeModel = { id, ingredient, procedure, instruction, option, decision, blankStep, processGrid, blankRecipe, bullets, number, quantity, scaleMeasure, plan, columns, validLayout };
})();

---
name: recipe-card
description: Makes recipe cards in the style of The Stew recipe card generator, a merged grid where each procedure's cell spans the ingredients it uses, and returns them as a self-contained, editable HTML card (plus a PNG when a browser is available). Use whenever the user asks for a recipe, a recipe card, or a cooking procedure; wants a recipe from text, a photo, a link or notes turned into a card; or wants an existing card or recipe changed, scaled, translated or fixed. Also adds recipes to the recipe-card project's recipes/library.json.
---

# Recipe card

You write the recipe as a JSON **draft**; `scripts/card.mjs` (in this skill's folder) checks it against the card's layout rules and writes the card. The card is the real app: it opens on the finished card, and the user can edit it, scale servings, use cooking mode, and export PNG/JPEG/PDF from it, offline.

## Workflow

1. **Get the recipe.** Use what the user gave you (text, photo, link, an earlier card). If they only name a dish, write a dependable version yourself; ask only when something essential is unclear (for example, the yield they need for production). Write in the user's language; keep local ingredient names in the description where they help ("Shallots", description "Bawang merah").
2. **Plan the grid** before writing JSON (see *How the card works*): the groups of ingredients that are prepared separately, the order they come together, and what belongs above the grid (`prep`) and below it (`finish`).
3. **Write the draft** to a file, for example `rendang.json` in a working folder.
4. **Run the maker:**
   ```bash
   node <skill-folder>/scripts/card.mjs make rendang.json --out <output-folder> --png
   ```
   - Fix every `ERROR` and run again. Nothing is written until there are none.
   - Fix `WARNING`s too unless the layout is intended (a split cell almost always means the ingredient order is wrong).
   - The output starts with a text outline of each grid (rows and which rows each step covers). Read it and check that it matches your plan.
   - `--png` needs Playwright and Chromium; if they are missing the maker says so and still writes the HTML. Do not install anything just for the PNG unless the user asks.
5. **Look at the PNG** if one was made. Check that the cells merge the way you intended and that the text is readable, then fix and re-run if needed.
6. **Deliver the files.** Use `/mnt/user-data/outputs` as the output folder when it exists (Claude apps), otherwise the user's working folder. Tell the user in one or two lines: open the `.html` in a browser; **Edit table** changes it; **Export** saves PNG, JPEG or PDF; the servings buttons scale quantities.

Other commands:
- `node card.mjs check draft.json` validates and prints the outline without writing a card.
- `node card.mjs draft <file> [name]` prints an editable draft of an existing recipe, from an exported card (`.html`), a library file (`recipes/library.json`, pick the recipe by name) or a recipe JSON. Use it to change, scale or translate an existing card: edit the draft, then `make` it again. The draft keeps the recipe `id`, so the new card replaces the old one in the user's browser library.
- `--library recipes/library.json` (with `make`) also adds or replaces the recipe in that library file. In the recipe-card repository this puts the recipe on the website once committed and pushed. Do it only when the user asks for it.

## How the card works

The card is one table.

- **Rows** are the ingredients, listed down the left in your order: quantity + unit, name, and a description in small italics.
- **Procedures** are cells to the right of the ingredients. A procedure's cell is merged over the rows it uses: the ingredients in its `inputs`, plus all rows of any earlier procedure in its `inputs` (its output). Time runs left to right, one column per step.
- So a recipe is a tree. Early procedures each work on their own group of ingredients; later procedures combine those outputs; the last one usually spans every row. Example: *Boil* (water, salt) and *Bloom garlic* (garlic, oil, chili) side by side, then *Cook pasta* (Boil output + pasta), then *Toss* (Cook pasta + Bloom garlic + parsley) spanning everything.
- `"parallel": true` puts a procedure in the **same column** as the procedure listed just before it: separate work done at the same time. Procedures in one column must cover different rows and cannot use each other's outputs.
- **Order ingredients so every procedure's rows are adjacent.** List each group's ingredients together, in the order the groups first get used. If a procedure covers rows 1–3 and 5 but not 4, its cell splits in two (the maker warns about this).
- An ingredient can appear in several procedures over time (salt in *Rinse & Season*, then everything again in *Simmer*). A procedure can also list ingredients directly instead of an earlier output when that reads better.
- A procedure with no inputs gets its own row at the bottom, labelled with its output fields: use it for an independent preparation such as "Toasted rice powder". General setup such as "Preheat the oven" belongs in `prep`.

Around the grid:
- `prep`: rows above the grid (rinse, soak overnight, preheat, mise en place).
- `finish`: rows below it (strain, rest, plate, QC, storage).
- Both can hold **steps** (`title` + `text`), **decisions** (a question with two or more branches, such as "Immediately used?": *Yes → Immediate use* / *No → Store*, where each branch can hold more steps and decisions) and extra **process grids** for a sub-recipe or a later phase (a sambal, a final seasoning stage), each with its own ingredients and procedures.
- `notes`: short "Recipe notes" under the card (why something matters, substitutions, troubleshooting).

## Draft format

The main fields are below; `reference/format.md` lists every field and rule. `examples/beef-broth.json` (simple) and `examples/beef-soto.json` (parallel steps, decisions, a finishing process grid) are real cards in the house style; read one before writing your first draft.

```json
{
  "name": "Aglio e Olio",
  "description": "Garlic, olive oil and chili spaghetti in 15 minutes.",
  "baseServings": 2,
  "active": "15 min",
  "total": "20 min",
  "vessel": "Large pot, wide skillet",
  "prep": [{ "title": "Slice", "text": "garlic thinly; chop parsley." }],
  "ingredients": [
    { "key": "water", "quantity": "2", "unit": "L", "name": "Water" },
    { "key": "salt", "quantity": "20", "unit": "g", "name": "Salt", "metricQuantity": "1", "metricUnit": "tbsp" },
    { "key": "pasta", "quantity": "200", "unit": "g", "name": "Spaghetti" },
    { "key": "garlic", "quantity": "4", "unit": "cloves", "name": "Garlic", "description": "Thinly sliced" },
    { "key": "oil", "quantity": "60", "unit": "ml", "name": "Olive oil" },
    { "key": "chili", "quantity": "1/2", "unit": "tsp", "name": "Chili flakes" },
    { "key": "parsley", "quantity": "10", "unit": "g", "name": "Parsley", "description": "Chopped" }
  ],
  "procedures": [
    { "key": "boil", "title": "Boil", "instructions": "Bring to a rolling boil.", "inputs": ["water", "salt"] },
    { "key": "bloom", "title": "Bloom", "instructions": "Low heat until garlic is pale gold, 3-4 min.", "inputs": ["garlic", "oil", "chili"], "parallel": true, "tools": "Cold pan start" },
    { "key": "cook", "title": "Cook", "instructions": "1 min under package time. Reserve 120 ml pasta water.", "inputs": ["boil", "pasta"], "minutes": 9 },
    { "key": "toss", "title": "Toss", "instructions": "Pasta into the garlic oil with a splash of pasta water until glossy.", "inputs": ["cook", "bloom", "parsley"] }
  ],
  "finish": [
    { "text": "Serving now?", "options": [
      { "answer": "Yes", "label": "Plate", "text": "Twirl into warm bowls." },
      { "answer": "No", "label": "Hold", "text": "Do not hold; it turns gluey. Toss just before serving." }
    ] }
  ],
  "notes": [{ "title": "Pasta water", "body": "The starch emulsifies the oil into a sauce." }]
}
```

- `key`: a short id you choose for each ingredient and procedure; `inputs` list keys. Keys are unique across the whole recipe, and inputs only reach their own grid.
- `baseServings` is the yield the quantities make. With `yieldUnit` empty the card says "Serves 4"; with `"yieldUnit": "L"` it says "Makes 1 L".
- Quantities: plain numbers, decimals and fractions (`"1 1/2"`, `"½"`) scale with servings; `"to taste"`, `"handful"` and ranges (`"2-3"`) stay as written. `metricQuantity`/`metricUnit` is an optional second measure shown under the first (for example 1 tbsp next to 20 g).
- `minutes` sets the cooking-mode timer for that step; `tools` is a small italic note in the cell (equipment, a tip, a warning).

## House style

Match the user's existing cards (see `examples/`):
- Procedure titles are short verbs: *Roast*, *Parboil*, *Sear*, *Return, then Simmer*.
- Instructions are terse and concrete: temperatures in °C, times, doneness cues ("golden brown", "until fragrant, 30 secs"). Start lines with `- ` or `1. ` for a list; leave a blank line between paragraphs.
- Ingredient descriptions hold prep notes, alternatives and local names; keep them short.
- Use metric weights and volumes as the main quantity; put a spoon or piece count in the second measure when it helps.
- Use QC rows (`finish` steps) for measurable checks such as Brix, salt %, temperature or final volume when the user cooks to spec.
- Use decisions for real forks (serve now or store, too salty or flat) rather than long "if…" text.
- Do not invent precision you do not have. Say "to taste", or add a note.

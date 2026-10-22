# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev       # Vite dev server (index.html → main.js)
npm run build     # production build to dist/
npm test          # node --test tests/*.test.mjs (model logic and the recipe-card skill)
node --test --test-name-pattern="scaling" tests/model.test.mjs   # single test
npm run generator # regenerate recipe-generator.html headlessly (Vite dev server + Playwright, clicks Save HTML)
npm run skill     # regenerate, then package the recipe-card skill into dist-skill/ (zip for Claude apps)
npm run card -- make <draft.json> --out <dir> --png   # recipe-card skill maker
```

There is no linter or formatter configured.

## Recipe-card skill

`.claude/skills/recipe-card/` is a Claude skill that makes recipe cards from a JSON *draft* (ingredients and procedures named by `key`; `inputs` list keys). `scripts/card.mjs` converts the draft to the app's recipe format (`fromDraft`), reports layout problems with the same rules as `M.validLayout()` plus split-cell and unused-row warnings, and writes the card by putting the recipe into `recipe-generator.html`'s `recipe-data` script with `data-view="card"` (which makes `app.js` open on the card view). It loads `RecipeModel` from the template's embedded runtime, so it has no dependencies; `--png` drives the app's own HQ PNG export through Playwright when available. When changing the recipe data shape, update `fromDraft`/`toDraft`, the field lists in `card.mjs`, `SKILL.md` and `reference/format.md`, and the tests in `tests/skill.test.mjs`. The `examples/` drafts come from `recipes/library.json` via `card.mjs draft`.

## Architecture

A no-framework, browser-only recipe card generator. The original hand-made card it imitates is kept in `reference/the-stew.html` (typography, colors, merged grid); treat it as the visual reference, not as code to edit.

**Plain scripts, not ES modules.** `model.js` and `app.js` are IIFE/global scripts: `model.js` sets `globalThis.RecipeModel`, and `app.js` defines `window.initRecipeGenerator`. Keep them free of `import`/`export`. This is required because the exported HTML file inlines their raw source as ordinary `<script>` text (see below). The tests load `model.js` by side-effect import and read `globalThis.RecipeModel`.

- `model.js`: pure data and logic: recipe/ingredient/procedure factories, quantity parsing and scaling (fractions, Unicode fractions, free-text passthrough), `plan()`, `columns()` and `validLayout()`.
- `app.js`: all UI: editor table, card render, library/autosave (`localStorage` key `recipe-generator.library.v1`), cooking mode, and exports (HTML, print/PDF, PNG/JPEG via html2canvas).
- `main.js`: Vite entry only. Inlines the fonts as `@font-face` data URLs, injects html2canvas, and puts the raw source of `model.js` + `app.js` and html2canvas on `window.recipeGeneratorSource` / `window.recipeCaptureSource` (via `?raw`) so the app can re-embed itself, then calls `initRecipeGenerator()`. In production builds (the GitHub Pages site) it also sets `window.recipeCollection` from `recipes/library.json`; `app.js` adds each of those recipes to the visitor's library once per version (token `bundled:<id>:<hash>` in `importedSnapshots`). The dev server skips this so it never overwrites the local library. `main.js` also sets `window.recipeGitHub` (owner, repo, branch, path); with a fine-grained token stored under `recipe-generator.github-token`, "Save to GitHub" (`saveToGitHub` in `app.js`) commits the library to that file through the GitHub contents API, and the app pulls newer versions from it on load (`pullFromGitHub`). Saved versions are marked imported so the redeployed bundle doesn't overwrite later local edits. Exported HTML has no `recipeGitHub`, so the button stays hidden there.
- `index.html`: markup and all CSS (screen + print).

**The process grid model (`plan`).** The ingredient/procedure grid is called the *process grid*. A procedure's `inputs` are ingredient IDs and/or IDs of *earlier* procedures. `plan()` gives each procedure a mask: the set of ingredient rows its merged cell spans, taking in its ancestors' rows. A procedure with no ingredient inputs gets a synthetic `output-<id>` row (`preparation: true`) built from its output fields. Procedures are grouped into columns by `M.columns()`: a procedure with `parallel: true` shares the column of the one before it. `M.validLayout()` requires every procedure to use outputs only from earlier columns and procedures in one column to cover disjoint rows; every reorder, edge drag and component change is checked against it. In the UI a column is called a *step*. A procedure with `blank: true` (`M.blankStep()`, from **+ Step**) is an empty step column, and one with `placeholder: true` (used only while dragging a cell, to hold its old column) is temporary; both get an empty mask and no row. Blank steps are hidden on the card and in cooking mode (`realColumns()` in `app.js`), and a blank marker is dropped as soon as a real procedure shares its column (`placeInStep()`, `setColumns()`). Changes here affect both the editor and the card, and they are what the tests cover.

**Preparation and finishing rows.** `recipe.prep` and `recipe.finish` are lists of steps (`{ id, title, text, tools }`), decisions (`{ id, text, options: [{ id, answer, label, text, tools, items }] }`, where `items` nests further steps and decisions under that branch; `allDecisions()`, `findOption()` and `findNested()` in `app.js` walk the tree, and nested inputs use `data-kind="nested"`), or extra process grids (`{ id, title, ingredients, procedures }`, from `M.processGrid()`). Code tells them apart by whether `options` or `ingredients` is present. The recipe itself is the main process grid; `grids()` in `app.js` lists every grid in reading order, `gridOf(id)` finds the grid that holds an ingredient or procedure, and `stageList()` numbers columns across all grids as cooking stages (procedures in one column run together). Drag and drop lives in `app.js` as one engine (`startDrag`) with four modes: `listDrag` (rows), `columnDrag` (column header grip), `stageDrag` (procedure cell grip) and `edgeDrag` (procedure top/bottom edge); each previews by mutating the data and re-rendering the editor, and `restore()` undoes it on Escape. Ingredient and procedure IDs are unique across grids, and a procedure's `inputs` only reference its own grid. All grids share one table: the column count is the largest procedure count, and each grid's procedures are right-aligned. Option inputs use `data-kind="option"` and are looked up with `findOption()` in `app.js`. A decision always keeps at least two options.

**Undo.** `changed(key)` calls `record()`, which pushes the previous JSON snapshot of the recipe onto a per-recipe history (`histories`, session only). Edits with the same `key` within 1.5 s (typing in one field) merge into one step. `travel()` swaps the recipe object for a snapshot and re-renders. Any new mutation must go through `changed()` to be undoable.

**Self-replicating HTML export.** "Save HTML" (`exportHTML` in `app.js`) clones the live DOM, strips the scripts, and appends `recipe-data` (recipe JSON), `capture-runtime`, `generator-runtime` and `generator-start` scripts. The resulting file runs fully offline and can export itself again. On load, `initRecipeGenerator` imports an embedded `recipe-data` snapshot into the library once, tracked by `data-snapshot` token in `library.importedSnapshots`.

- `recipe-generator.html` (the standalone blank generator in the README) and the files in `output/` are **generated artifacts** of this export. Don't hand-edit them. After changing the source, regenerate `recipe-generator.html` with `npm run generator` (it does Save HTML on a blank recipe in a headless browser).
- Anything the exported page needs at runtime must live in the DOM, the CSS in `index.html`, or `model.js`/`app.js`. Vite-only features (imports, assets) don't survive the export.

## Conventions from the README

- Quantities: scaling applies only to numeric values (decimals, `a b/c`, Unicode fractions). Ranges and free text pass through unchanged. Output is decimal unless the input was a fraction (`M.quantity`). `M.scaleMeasure` only switches within metric mass (mg/g/kg) and volume (ml/L) when scaling; other units are never converted. The second quantity/unit pair (`metricQuantity`/`metricUnit`) is user-entered.
- Saved HTML stores base quantities. Servings scaling is display-only.
- Image/print exports omit editor controls, cooking highlights, and crossed-off states.
- Save times show in Jakarta time (`Asia/Jakarta`).
- Fonts are bundled locally in `fonts/` under SIL OFL. Keep the license texts with them (they are embedded in the font `<style>`).

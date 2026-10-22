# Recipe builder

A blank-table recipe generator using the original recipe card's typography, colors, and merged ingredient/procedure grid (the **process grid**). The original card is preserved in [reference/the-stew.html](reference/the-stew.html).

## Run locally

Open [recipe-generator.html](recipe-generator.html) directly in a browser for a standalone blank generator. It includes the fonts and all editing/export controls and works offline. To work on the project source instead:

```bash
npm install
npm run dev
```

`npm run build` creates the production build. `npm test` checks component dependencies and quantity scaling.

## Create a recipe

- Enter the recipe name and details directly in the header rows of **Edit table**.
- A recipe has three sections: preparation, the main process grid, and finishing.
- To reorder anything (ingredients, preparation and finishing steps, decisions, process grids, notes), drag its grip handle (⠿). The grip and delete button appear when you point at a cell; on touch screens they're always shown. A copy follows the cursor and the table rearranges live, so you see the result before releasing; press Escape to cancel. With a grip focused, the arrow keys move it one place. Ingredients can also be dragged into another process grid (drop just below a grid's column headings to put one first); an ingredient that changes grid leaves the procedures of its old grid, since procedures only use items from their own grid.
- The process grid's columns are **steps**. A step holds one or more procedures, as long as they use different rows (for example roasting the brisket and charring the shallots side by side). **+ Step** adds a blank step column; blank steps don't appear on the card. Point at any empty spot under a step and click its **+** to add a procedure right there, already using that row's item; or use **+** in a step's header to add an empty procedure to it. The component picker greys out items another procedure in that step already uses. Drag a step header's grip to reorder whole steps. Drag a procedure cell's grip onto another step to share it, or onto a step's left or right edge to give it a step of its own. A procedure can't move before a step whose output it uses.
- Drag the top or bottom edge of a procedure cell up or down to take in or let go of neighbouring item rows. Rows that come from an earlier procedure's output stay put (remove that output in the component picker), and rows used by another procedure in the same column can't be taken.
- Use **+ Preparation** above the process grid and **+ Finishing** below it to add separate instruction rows. Each row has an optional step name, shown in bold before its instructions on the card. Move them up/down or remove them with the row controls. Existing preparation and finishing text is retained as the first row in each section.
- Use **+ Process grid** in preparation or finishing to add a self-contained process grid there, for example an aromatics base or a garnish. It has its own optional name, ingredients, and procedures, with its own **+ Ingredient** and **+ Step** buttons; the toolbar buttons add to the main process grid. A new process grid starts with as many blank steps as the widest grid, so its columns line up with the others. Its amounts scale with the rest of the card, and cooking mode steps through every procedure in reading order: preparation grids, the main process grid, then finishing grids. Procedures can only use ingredients and outputs from their own grid.
- Use **+ Decision** in either section for a choice point, such as "Serve now or store?". Each option gets an optional answer (shown as a pill such as "Yes →"), a name, and its own instructions, shown side by side on the card with an **OR** badge on each divider and a "Decision ·" tag on the question. **+ Option** adds more; a decision keeps at least two. Inside each option, **+ Instruction** and **+ Decision** add further steps or a nested decision under that branch, so decisions can form a tree; nested items have their own grip and delete. Decisions use a lighter green than other rows.
- Every procedure, decision option, and preparation or finishing step has an optional **Notes** field, handy for listing the tools needed. It appears as a small footnote at the bottom centre of its cell on the card, at the same size as ingredient descriptions, without moving the cell's other text.
- Procedure instructions and decision options support one level of bullet points or numbered lists. Type `-` or `*` and a space at the start of a line to start a bullet, or `1.` / `1)` and a space for a numbered list (Enter continues with 2., 3., …). In Edit table, a field with bullets switches to left alignment. Enter continues the list, and Enter on an empty bullet ends it, so you can mix paragraphs and bullets in one field. A blank line between text and a list is kept as a gap on the card.
- **Base yield** takes an amount and an optional unit, such as portions, kg or L. With a unit, the card reads "Makes 1 L" instead of "Serves", and scaling a 1 L recipe to 15 L multiplies every numeric quantity by 15.
- Use **+ Ingredient** to add ingredient rows and fill their quantity, unit, item name, and description cells. An optional second quantity and unit are always visible beneath the main pair, beside the description. Either pair accepts any units; conversions are not guessed. Row controls sit beside the item name at the top-right of its cell. Point at the line between two items (or above the first) and click the **+** that appears to insert an item at exactly that spot; if both neighbours belong to the same procedure cell, the new item joins that procedure so the cell stays whole.
- Each procedure's components can be ingredients, outputs from earlier steps, or both (choose them with its **components · edit** button). The procedure cells merge across the selected ingredient rows, matching the finished card.
- Enter each procedure's name and instructions in its merged cell. Expand **Timer & prepared output** for a timer and output name, description, quantity, and unit. Independent preparations are supported. In cooking mode, each step is one stage, so procedures in the same step are highlighted together and their timers run side by side.
- Add optional notes and a source credit. Open **Recipe card** to see the merged grid, scale servings, cross off ingredients, and follow the cooking stages.

Recipes autosave to this browser. **Undo** and **Redo** (after Duplicate, or Ctrl/⌘ Z and Shift Ctrl/⌘ Z / Ctrl Y outside text fields) step back and forward through every change to the current recipe; a burst of typing in one field is one step. History lasts for the browser session and is kept per recipe. The icon buttons beside **Saved recipes** are New (+), Save, Delete (asks first; deleting the last recipe leaves a blank one), and Duplicate. New starts another blank table and Duplicate copies the current recipe; use **Saved recipes** to switch between recipes. The half-filled circle (top right) switches the recipe table and recipe card between their colours and monochrome; the choice is saved with the recipe and carries into exports. Storage is specific to the browser and site address, so export HTML for a portable backup.

The save status shows the latest save time in Jakarta time. Click a fraction button (1/2, 1/4, 3/4, 1/3, 2/3) or **°** beside **+ Ingredient** in Edit table to insert it. Fractions go in as plain text such as `1/2`, with a space added after a whole number so `1` becomes `1 1/2`. They are inserted at the cursor in the last active text field, including procedure instructions and recipe notes.

## Website and saving to GitHub

The site is published at https://thecatlab.github.io/recipe-card/. Every push to `main` runs the tests, builds the site and deploys it (`.github/workflows/pages.yml`). Visitors start with the recipes in [recipes/library.json](recipes/library.json); their own edits stay in their browser.

To save your recipes to the repository from the site (or from `npm run dev`):

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Repository access → Only select repositories → recipe-card** and **Contents → Read and write**.
2. Click the cloud button next to the undo/redo buttons, paste the token and choose **Connect**. The token is kept only in that browser; **Disconnect** removes it.
3. **Save recipes** commits every recipe in the browser to `recipes/library.json`. The website updates about a minute later.

While connected, the app also loads recipes saved from your other browsers or devices when it opens. If GitHub was changed somewhere else, or saving would remove recipes from it, the app asks first.

## Export

- **Save HTML:** downloads a self-contained, editable generator with the current recipe, fonts, and export code. Open the file in a browser to continue editing, save it again, or export images. HTML preserves base quantities; display scaling remains a preview setting.
- **Export → Print / PDF:** opens browser printing with an A4 landscape layout. Choose Save as PDF, enable background graphics, and turn off browser headers and footers. Long recipes can span pages; a very large number of procedure columns may need a larger paper size.
- **Export → Copy** (next to HQ PNG): renders the same 3× PNG and puts it on the clipboard, ready to paste into chats, documents or design tools. Clipboards only accept PNG, so there's no JPEG copy.
- **Export → HQ PNG / HQ JPEG:** downloads the full recipe card at 3× resolution, including horizontally scrolled columns. JPEG uses 98% quality and an opaque white background. Exports omit editor controls, cooking highlights, and crossed-off states. Browser canvas limits can prevent unusually large recipes from fitting in one image; use HTML or PDF in that case.

Numeric quantities support decimals, ordinary fractions, and common Unicode fractions. The card shows decimals (such as 0.75) unless you typed a fraction, in which case scaled amounts stay fractions where they can (1/2 becomes 1 1/4 at 2.5×). When scaling, metric units switch to the size that reads best: 300 g × 4 shows 1.2 kg, and 1.2 kg × 0.25 shows 300 g. This covers g/kg (and mg when you entered mg) and ml/L, in short or written-out forms. Other units, such as cups or tsp, are never converted. Free-text quantities and ranges remain unchanged when servings change.

Fonts are bundled locally under their included SIL Open Font Licenses in `fonts/`.

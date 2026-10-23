# Draft format reference

A draft is one JSON object. Every field is optional except `name` and at least one ingredient or procedure. Values can be strings or numbers; they are stored as text. Unknown fields are ignored with a warning, so a typo such as `"step"` instead of `"procedures"` is visible in the maker's output.

## Recipe

| Field | Meaning |
| --- | --- |
| `name` | Title of the card (required). |
| `description` | One-line deck under the title. |
| `baseServings` | Yield the quantities make (positive number, default 4). |
| `yieldUnit` | Empty: "Serves N". Set (for example `"L"`, `"portions"`, `"cookies"`): "Makes N unit". |
| `active`, `total` | Times shown in the meta line, as written ("20 min", "24 hr"). |
| `vessel` | Main equipment shown in the meta line. |
| `prep` | List of items above the grid (steps, decisions, process grids). |
| `ingredients`, `procedures` | The main process grid. |
| `finish` | List of items below the grid (steps, decisions, process grids). |
| `notes` | List of `{ "title", "body" }` (or plain strings) shown as "Recipe notes". |
| `credit` | Source line at the bottom of the card. |
| `monochrome` | `true` for a black-and-white card. |
| `id` | Keep the id that `card.mjs draft` gives you when editing an existing recipe; leave it out for a new one. |

## Ingredient

| Field | Meaning |
| --- | --- |
| `key` | Short unique id that procedures use in `inputs`. |
| `quantity`, `unit` | Main measure. Numbers, decimals, `a b/c` and Unicode fractions scale; anything else stays as written. Metric mass (mg/g/kg) and volume (ml/L) switch units when scaling crosses a threshold. |
| `name` | Required whenever the row has any content. |
| `description` | Small italic line: prep, alternatives, local name. |
| `metricQuantity`, `metricUnit` | Optional second measure, shown under the main one. |

A plain string (`"Salt"`) is accepted as an ingredient name, but it then has no key, so no procedure can use it.

## Procedure

| Field | Meaning |
| --- | --- |
| `key` | Short unique id, so later procedures can use this one's output. |
| `title` | Required. Short verb phrase. |
| `instructions` | Cell text. Lines starting `- `, `• ` or `1. ` become lists; a blank line starts a new paragraph. |
| `inputs` | Keys of ingredients and/or earlier procedures in the same grid. The cell spans every ingredient row they reach. |
| `parallel` | `true`: same column (step) as the procedure listed just before. Not allowed on the first procedure. |
| `minutes` | Cooking-mode timer (number). |
| `tools` | Small italic note at the bottom of the cell. |
| `outputName`, `outputQuantity`, `outputUnit`, `outputDescription` | Names what the procedure produces. Shown in the cell, and used as the row label when the procedure has no ingredient inputs. |

## Prep and finish items

The kind of an item is decided by its fields:

- **Step**: `{ "title": "Strain", "text": "using fine strainer or cheesecloth", "tools": "" }`. The title is bold and the text runs after it on the same line. A plain string is a step with only text.
- **Decision**: `{ "text": "Immediately used?", "options": [ ... ] }`, which needs at least two options. Each option is `{ "answer": "Yes", "label": "Immediate use", "text": "...", "tools": "...", "items": [ ... ] }`. `answer` shows as a pill ("Yes →"), `label` in bold, then the text. `items` nests further steps and decisions (not process grids) under that branch.
- **Process grid**: `{ "title": "Final adjustment", "ingredients": [ ... ], "procedures": [ ... ] }`. It is a separate grid with the same rules as the main one; its keys must still be unique in the whole recipe.

## Layout rules the maker enforces

Errors (no card is written):
- An input matches no key, points to itself, points to another grid, or points to a procedure listed later.
- Two parallel procedures in one column cover the same ingredient row, or one uses the other's output.
- A decision has fewer than two options; a procedure has no title; an ingredient row has content but no name; `baseServings` or `minutes` is not a number.

Warnings (a card is written, but check them):
- A procedure's rows are not adjacent, so its cell is split. Reorder the ingredients.
- An ingredient is used by no procedure, so its row has no step beside it.
- Unknown fields, a duplicate input, an empty decision option, or `parallel` on a first procedure.

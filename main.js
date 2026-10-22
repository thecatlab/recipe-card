import captureSource from 'html2canvas/dist/html2canvas.min.js?raw';
import modelSource from './model.js?raw';
import appSource from './app.js?raw';
import './model.js';
import './app.js';
import bricolage from './fonts/bricolage.woff2?inline';
import instrument from './fonts/instrument.woff2?inline';
import mono from './fonts/space-mono.woff2?inline';
import monoBold from './fonts/space-mono-bold.woff2?inline';
import bricolageLicense from './fonts/bricolagegrotesque-OFL.txt?raw';
import instrumentLicense from './fonts/instrumentsans-OFL.txt?raw';
import monoLicense from './fonts/spacemono-OFL.txt?raw';
import bundledRecipes from './recipes/library.json';

const fonts = document.createElement('style');
fonts.textContent = '/* Bundled font licenses\n' + [bricolageLicense, instrumentLicense, monoLicense].join('\n') + '\n*/\n' + [
  ['Bricolage Grotesque', '400 800', bricolage],
  ['Instrument Sans', '400 600', instrument],
  ['Space Mono', '400', mono],
  ['Space Mono', '700', monoBold],
].map(([family, weight, source]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('${source}') format('woff2')}`).join('\n');
document.head.append(fonts);
const capture = document.createElement('script');
capture.textContent = captureSource;
document.head.append(capture);
window.recipeGeneratorSource = modelSource + '\n' + appSource;
window.recipeCaptureSource = captureSource;
// The hosted site starts with the recipes in recipes/library.json. The dev server keeps
// only the local library, so it never overwrites recipes being edited there.
if (!import.meta.env.DEV) window.recipeCollection = bundledRecipes;
window.initRecipeGenerator();

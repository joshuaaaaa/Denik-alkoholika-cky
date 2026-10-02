// Zkopíruje webovou aplikaci do složky www/ pro Capacitor (Android).
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const OUT = 'www';
const ITEMS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'vendor'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const item of ITEMS) cpSync(item, `${OUT}/${item}`, { recursive: true });
// runtime Capacitoru vždy ve verzi odpovídající nainstalovanému balíčku
cpSync('node_modules/@capacitor/core/dist/capacitor.js', `${OUT}/vendor/capacitor.js`);
console.log('Web zkopírován do', OUT);

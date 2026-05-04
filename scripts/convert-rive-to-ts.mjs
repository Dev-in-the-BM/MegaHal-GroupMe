/**
 * Convert alice_brain.rive to alice_brain.ts
 * This script reads the .rive file and creates a .ts file that exports it as a string.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const riveFile = path.join(__dirname, '../src/engines/rivescript/alice_brain.rive');
const tsFile = path.join(__dirname, '../src/engines/rivescript/alice_brain.ts');

let content = fs.readFileSync(riveFile, 'utf-8');

// Escape backticks and ${ for template literal
content = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const output = `// Auto-generated from alice_brain.rive - DO NOT EDIT MANUALLY
const ALICE_BRAIN = \`${content}\`;
export default ALICE_BRAIN;
`;

fs.writeFileSync(tsFile, output);
console.log(`Created ${tsFile} (${fs.statSync(tsFile).size} bytes)`);

// Runs n8n's community package scanner (@n8n/scan-community-package) on this checkout before it's published.
// The scanner's CLI only scans a version that's already on npm, and n8n's Creator Portal reviews each new version
// with it, so this runs the same two checks locally: its rules on the node sources, and on the files `npm pack`
// would publish (run `npm run build` first).
//
// It isn't a dev dependency (its TypeScript 6 would replace this package's `tsc` in node_modules/.bin), so this
// installs the pinned version below into node_modules/.cache on first run. The version is pinned because this script
// imports a file from inside the package.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCANNER = '@n8n/scan-community-package@0.41.0';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scannerDir = path.join(root, 'node_modules', '.cache', 'n8n-scan', SCANNER.replace(/[@/]/g, '_'));
const scannerModule = path.join(scannerDir, 'node_modules', '@n8n', 'scan-community-package', 'scanner', 'scanner.mjs');
if (!fs.existsSync(scannerModule)) {
	fs.mkdirSync(scannerDir, { recursive: true });
	fs.writeFileSync(path.join(scannerDir, 'package.json'), '{"private":true}\n');
	execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', SCANNER], {
		cwd: scannerDir,
		stdio: 'inherit',
	});
	if (!fs.existsSync(scannerModule)) {
		throw new Error(`${scannerModule} not found after installing ${SCANNER}: its layout changed, update this script`);
	}
}
const { analyzePackage, SOURCE_FILE_PATTERNS } = await import(pathToFileURL(scannerModule).href);

if (!fs.existsSync(path.join(root, 'dist'))) {
	throw new Error(`No dist/ in ${root}: run npm run build first`);
}

const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docspring-n8n-scan-'));
try {
	const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: root })
		.toString()
		.trim()
		.split('\n')
		.pop();
	execFileSync('tar', ['-xzf', path.join(packDir, tarball), '-C', packDir]);

	const checks = [
		['source', await analyzePackage(root, SOURCE_FILE_PATTERNS)],
		['packed', await analyzePackage(path.join(packDir, 'package'), ['**/*.js', 'package.json'])],
	];
	let failed = false;
	for (const [name, result] of checks) {
		console.log(`${name}: ${result.passed ? 'passed' : `FAILED (${result.message})`}`);
		if (result.details) console.log(result.details);
		if (!result.passed) failed = true;
	}
	if (failed) process.exitCode = 1;
} finally {
	fs.rmSync(packDir, { recursive: true, force: true });
}

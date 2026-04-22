/**
 * Copyright (c) 2026 Salesforce, Inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 **/
const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
// Always emit to dist/; VSIX packaging + F5 both read from there. Sourcemaps
// are on in dev, off in production.
const destDir = 'dist';

const extensionConfig = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  metafile: true,
  format: 'cjs',
  platform: 'node',
  tsconfig: path.resolve(__dirname, 'tsconfig.json'),
  entryPoints: ['./src/extension.ts'],
  outfile: `${destDir}/extension.js`,
  external: ['vscode']
};

(async () => {
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const result = await build(extensionConfig);
    fs.writeFileSync(
      path.join(destDir, 'extension-esbuild-metafile.json'),
      JSON.stringify(result.metafile, null, 2)
    );
    console.log(`salesforcedx-vscode-manager: build complete (${destDir})`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
})();

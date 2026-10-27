module.exports = {
	root: true,
	env: { browser: true, es6: true, node: true },
	parser: '@typescript-eslint/parser',
	parserOptions: { sourceType: 'module', extraFileExtensions: ['.json'] },
	ignorePatterns: ['.eslintrc.js', '**/*.js', '**/node_modules/**', '**/dist/**'],
	overrides: [
		{
			files: ['package.json'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/community'],
			rules: { 'n8n-nodes-base/community-package-json-name-still-default': 'off' },
		},
		{
			files: ['./credentials/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/credentials'],
			rules: {
				// This rule wants a slug for n8n's own docs site. A community credential links to its own docs with a
				// full URL, as n8n's community node scanner expects.
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
			rules: {
				// These rules want inputs and outputs written as ['main']. n8n's community node scanner
				// (@n8n/scan-community-package), which verified nodes must pass, requires NodeConnectionTypes.Main.
				'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
				'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			},
		},
	],
};

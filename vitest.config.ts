import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests cover plain TypeScript (src/lib/leaco, and server loaders), so they run without
// the SvelteKit plugin; only the `$lib` alias is mirrored. `pnpm run test` is a different
// thing (the env/DB diagnostic in scripts/test.ts).
export default defineConfig({
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node'
	}
});

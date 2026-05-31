import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Run each test file in an isolated worker so module-level mock state
    // (vi.mock hoisting) does not bleed between files.
    isolate: true,
  },
  resolve: {
    // Allow vitest to find the real .ts source when the TypeScript code imports
    // with .js extensions (the standard ESM pattern for "moduleResolution: bundler").
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
  },
})

// The PalmOS SDK client has a single source of truth: the publishable
// `@getpalmos/agent` package at packages/agent/src/index.ts. This module re-exports
// that implementation so the dashboard, CLIs, and the published npm package can
// never drift apart. We import the package *source* (not its built dist) so the
// repo keeps running under tsx without a separate build step.
export * from '../../packages/agent/src/index.js'

# Publishing `@palmos/agent`

The `@palmos/agent` package skeleton exists in `packages/agent` and builds locally.

## Current MVP Decision

For submission, it is acceptable to present:

```bash
npm install @palmos/agent
```

as the intended developer surface, while using the repo-local CLI for the live demo until the package is published.

Repo-local command:

```bash
npm run palmos:external-agent -- --json
```

## Pre-Publish Checklist

1. Confirm package name availability.
2. Confirm package README has the final backend URL examples removed or generalized.
3. Build package:

```bash
npm run package:agent:build
```

4. Dry-run pack:

```bash
npm run package:agent:pack
```

5. Publish when ready:

```bash
npm publish --workspace @palmos/agent --access public
```

## Do Not Publish With

- real agent tokens
- live private keys
- local backend URLs as hardcoded defaults other than `http://127.0.0.1:4030`
- temporary demo-only copy that implies production custody is solved

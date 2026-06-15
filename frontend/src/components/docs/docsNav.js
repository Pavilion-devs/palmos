/**
 * Docs navigation model. Drives the left sidebar (grouped), the right
 * "On this page" TOC (active section's sub-anchors), prev/next, and scrollspy.
 * `id` values must match the section / sub-heading ids rendered in DocsContent.
 */
export const docGroups = [
  {
    label: 'Getting started',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        sub: [
          { id: 'the-problem', label: 'The problem' },
          { id: 'what-palmos-does', label: 'What PalmOS does' },
          { id: 'the-one-liner', label: 'The one-liner' },
        ],
      },
      { id: 'architecture', label: 'Architecture' },
    ],
  },
  {
    label: 'Concepts',
    items: [
      { id: 'concepts', label: 'Core concepts' },
      { id: 'governance', label: 'The governance flow' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      {
        id: 'byreal',
        label: 'Byreal integration',
        sub: [
          { id: 'byreal-capabilities', label: 'Capabilities' },
          { id: 'byreal-custody', label: 'Custody path' },
          { id: 'byreal-tools', label: 'Agent tools' },
        ],
      },
      {
        id: 'mantle',
        label: 'Mantle layer',
        sub: [
          { id: 'mantle-identity', label: 'ERC-8004 identity' },
          { id: 'mantle-log', label: 'Decision log' },
          { id: 'mantle-vault', label: 'Same-vault signing' },
        ],
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      { id: 'policy', label: 'Policy reference' },
      {
        id: 'connect',
        label: 'Connecting an agent',
        sub: [
          { id: 'connect-cli', label: 'CLI' },
          { id: 'connect-http', label: 'HTTP SDK' },
          { id: 'connect-mcp', label: 'MCP' },
        ],
      },
      { id: 'running', label: 'Running PalmOS' },
    ],
  },
  {
    label: 'Security',
    items: [
      { id: 'custody', label: 'Custody & security' },
      { id: 'verifiability', label: 'Verifiability' },
    ],
  },
]

/** Flat, ordered list of top-level sections — for prev/next + scrollspy. */
export const docSections = docGroups.flatMap((g) => g.items)

/** Map any anchor id (section or sub-heading) -> its top-level section id. */
export const anchorToSection = docSections.reduce((acc, item) => {
  acc[item.id] = item.id
  ;(item.sub ?? []).forEach((s) => {
    acc[s.id] = item.id
  })
  return acc
}, {})

/**
 * Verify the deployed PalmOS contracts' source on Mantle's canonical explorer (Mantlescan, which is
 * Etherscan-based) using the exact standard-json we compiled with — so viaIR + optimizer +
 * evmVersion match the on-chain bytecode. Reads addresses from <baseDir>/mantle/deployment.json.
 *
 * Mantlescan uses the Etherscan V2 unified API (one free key works across all chains via chainid).
 * Set a key and run:
 *   ETHERSCAN_API_KEY=<key> node --import tsx scripts/mantle-verify.ts
 * (get a free key at https://etherscan.io/myapikey — V2 covers Mantle, chainid 5003).
 *
 * Without a key it prints everything needed to verify by hand, so this never blocks deployment.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readMantleDeployment } from '../src/integrations/mantle/deploymentStore.js'

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api'
const CHAIN_ID = '5003'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
const outDir = fileURLToPath(new URL('../contracts/out/', import.meta.url))
const apiKey = (process.env.ETHERSCAN_API_KEY || process.env.MANTLE_ETHERSCAN_API_KEY || '').trim()

const deployment = await readMantleDeployment(baseDir)
if (!deployment?.identityRegistry || !deployment?.actionLog) {
  throw new Error('No deployment found. Run scripts/mantle-deploy.ts first.')
}

const standardInput = readFileSync(`${outDir}standard-input.json`, 'utf8')
const identityArtifact = JSON.parse(readFileSync(`${outDir}IdentityRegistry.json`, 'utf8'))
// solc reports "0.8.26+commit.8a97fa7a.Emscripten.clang"; Etherscan wants "v0.8.26+commit.8a97fa7a".
const compilerVersion = `v${String(identityArtifact.compiler).replace(/\.(Emscripten|clang).*$/g, '')}`

const targets = [
  { name: 'IdentityRegistry', address: deployment.identityRegistry, file: 'IdentityRegistry.sol' },
  { name: 'AgentActionLog', address: deployment.actionLog, file: 'AgentActionLog.sol' },
]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function submit(t: { name: string; address: string; file: string }): Promise<string | null> {
  const body = new URLSearchParams({
    chainid: CHAIN_ID,
    apikey: apiKey,
    module: 'contract',
    action: 'verifysourcecode',
    contractaddress: t.address,
    codeformat: 'solidity-standard-json-input',
    sourceCode: standardInput,
    // standard-json sources are keyed by bare filename (e.g. "IdentityRegistry.sol"), so the
    // fully-qualified contract name has no leading path segment.
    contractname: `${t.file}:${t.name}`,
    compilerversion: compilerVersion,
    constructorArguements: '',
  })
  try {
    const res = await fetch(`${ETHERSCAN_V2}?chainid=${CHAIN_ID}`, { method: 'POST', body })
    const json = (await res.json().catch(() => null)) as { status?: string; result?: string } | null
    if (json?.status === '1' && json.result) return json.result
    if (/already verified/i.test(json?.result ?? '')) return 'ALREADY_VERIFIED'
    console.log(`  ⚠️  ${t.name}: submit rejected — ${json?.result ?? `HTTP ${res.status}`}`)
    return null
  } catch (error) {
    console.log(`  ⚠️  ${t.name}: network error — ${(error as Error).message}`)
    return null
  }
}

async function poll(guid: string, name: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await wait(4000)
    const url = `${ETHERSCAN_V2}?chainid=${CHAIN_ID}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`
    let result = ''
    try {
      const json = (await (await fetch(url)).json().catch(() => null)) as
        | { status?: string; result?: string }
        | null
      result = json?.result ?? ''
    } catch {
      continue // transient network blip — keep polling
    }
    if (/pending/i.test(result)) continue
    console.log(`  ${/pass|verified/i.test(result) ? '✅' : '⚠️ '} ${name}: ${result}`)
    return
  }
  console.log(`  ⚠️  ${name}: still pending after polling — check the explorer.`)
}

function printManual(): void {
  console.log('\n--- Manual / no-key verification ---')
  console.log('Get a free key (covers Mantle via Etherscan V2): https://etherscan.io/myapikey')
  console.log('Then: ETHERSCAN_API_KEY=<key> node --import tsx scripts/mantle-verify.ts')
  console.log('Or verify by hand at https://sepolia.mantlescan.xyz/verifyContract :')
  console.log(`  Compiler:      ${compilerVersion}`)
  console.log(`  Type:          Solidity (Standard-Json-Input)`)
  console.log(`  Standard JSON: ${outDir}standard-input.json`)
  console.log(`  Settings:      viaIR=true, optimizer runs=200, evmVersion=paris, license=MIT`)
}

if (!apiKey) {
  console.log('No ETHERSCAN_API_KEY set — cannot auto-verify.')
  printManual()
  process.exit(0)
}

console.log(`Verifying on Mantlescan (Etherscan V2, chainid ${CHAIN_ID})`)
console.log(`Compiler: ${compilerVersion}  (viaIR, optimizer runs=200, evmVersion=paris)\n`)
let anyFailed = false
for (const t of targets) {
  console.log(`${t.name} @ ${t.address}`)
  const guid = await submit(t)
  if (!guid) {
    anyFailed = true
    continue
  }
  if (guid === 'ALREADY_VERIFIED') {
    console.log(`  ✅ ${t.name}: already verified`)
    continue
  }
  await poll(guid, t.name)
}
if (anyFailed) printManual()

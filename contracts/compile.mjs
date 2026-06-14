/**
 * Compile the PalmOS Mantle contracts with solc (standard JSON), emitting reusable artifacts.
 *
 * - evmVersion 'paris' (pre-PUSH0) for maximum L2 compatibility on Mantle Sepolia.
 * - Writes out/<Name>.json (abi + bytecode + metadata) consumed by the deploy/mint scripts,
 *   and out/standard-input.json for Blockscout standard-json verification.
 *
 * Run:  cd contracts && npm install && npm run compile
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, 'src')
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })

const sources = {}
for (const file of readdirSync(srcDir)) {
  if (file.endsWith('.sol')) {
    sources[file] = { content: readFileSync(join(srcDir, file), 'utf8') }
  }
}

const settings = {
  // viaIR avoids "stack too deep" in the AgentActionLog calldata decoder (many string params)
  // and is reproduced verbatim during Blockscout standard-json verification.
  viaIR: true,
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'paris',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'metadata'] } },
}
const input = { language: 'Solidity', sources, settings }

const output = JSON.parse(solc.compile(JSON.stringify(input)))

const fatal = (output.errors ?? []).filter((e) => e.severity === 'error')
if (fatal.length) {
  for (const e of output.errors) console.error(e.formattedMessage)
  process.exit(1)
}
for (const e of output.errors ?? []) console.warn(e.formattedMessage)

writeFileSync(join(outDir, 'standard-input.json'), JSON.stringify(input, null, 2))

const solcVersion = solc.version()
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [contractName, c] of Object.entries(contracts)) {
    const artifact = {
      contractName,
      sourceName: file,
      compiler: solcVersion,
      evmVersion: settings.evmVersion,
      optimizer: settings.optimizer,
      abi: c.abi,
      bytecode: '0x' + c.evm.bytecode.object,
      metadata: c.metadata,
    }
    writeFileSync(join(outDir, `${contractName}.json`), JSON.stringify(artifact, null, 2))
    console.log(
      `compiled ${contractName} (${c.evm.bytecode.object.length / 2} bytes) -> out/${contractName}.json`,
    )
  }
}
console.log('solc', solcVersion)

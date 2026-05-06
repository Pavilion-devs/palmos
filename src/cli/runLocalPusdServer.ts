import {
  readLocalPusdServerConfigFromEnv,
  startLocalPusdDemoServer,
} from '../integrations/pusd/demoServer.js'

const config = readLocalPusdServerConfigFromEnv()
const server = await startLocalPusdDemoServer(config)

console.log(
  JSON.stringify(
    {
      ok: true,
      rail: 'palmos-pusd',
      port: server.port,
      payToAddress: server.payToAddress,
    },
    null,
    2,
  ),
)

process.on('SIGINT', () => {
  void server.close().finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  void server.close().finally(() => process.exit(0))
})

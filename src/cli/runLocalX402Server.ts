import {
  readLocalX402ServerConfigFromEnv,
  startLocalX402DemoServer,
} from '../integrations/x402/demoServer.js'

const config = readLocalX402ServerConfigFromEnv()
const server = await startLocalX402DemoServer(config)

console.log(
  JSON.stringify(
    {
      ok: true,
      port: server.port,
      payToAddress: server.payToAddress,
      network: config.network,
      healthUrl: `http://127.0.0.1:${server.port}/health`,
      paidUrl: `http://127.0.0.1:${server.port}/api/premium/spot-price?base=BTC&quote=USD`,
    },
    null,
    2,
  ),
)

process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})

await new Promise(() => {})

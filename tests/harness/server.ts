import { type AppConfig, Sinopebase } from '~/core/app'
import { TEST_LOOPBACK_HOST } from './ports'

/** Bind the final listener atomically; never release a reserved port before startup. */
export async function startLoopbackApp(
  config: Omit<AppConfig, 'port' | 'host'>,
): Promise<{ app: Sinopebase; origin: string }> {
  const app = new Sinopebase({ ...config, port: 0, host: TEST_LOOPBACK_HOST })
  let port: number | undefined
  app.use(async (router) => {
    router.onStart(({ server }) => {
      port = server?.port
    })
  })
  await app.start()
  if (!port) {
    await app.stop()
    throw new Error('The test listener did not expose its OS-assigned port')
  }
  return { app, origin: `http://${TEST_LOOPBACK_HOST}:${port}` }
}

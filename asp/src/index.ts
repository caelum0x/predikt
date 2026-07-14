// Server entry point. Fails fast when required configuration is missing.

import { serve } from '@hono/node-server'
import { createApp } from './app'

if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.error(
    'OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in.'
  )
  process.exit(1)
}

const port = Number(process.env.PORT) || 8787
const app = createApp()

serve({ fetch: app.fetch, port }, (info) => {
  console.error(`Predikt Oracle ASP listening on http://localhost:${info.port}`)
})

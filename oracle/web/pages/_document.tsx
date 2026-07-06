import { Html, Head, Main, NextScript } from 'next/document'
import { ENV_CONFIG } from 'common/envs/constants'
import Script from 'next/script'
import type { DocumentContext, DocumentInitialProps } from 'next/document'

/**
 * Extract the nonce from the Content-Security-Policy request header.
 *
 * middleware.ts embeds a per-request nonce as `'nonce-<value>'` inside the
 * script-src directive (see web/middleware.ts for the full rationale). Next.js
 * render.js reads the same header at render time and stamps the nonce on every
 * inline script it generates. We additionally pass the nonce to <NextScript>
 * and the beforeInteractive init-theme <Script> so their attributes match.
 */
function nonceFromCsp(cspHeader: string | undefined): string | undefined {
  if (!cspHeader) return undefined
  const match = cspHeader.match(/'nonce-([^']+)'/)
  return match?.[1]
}

export default function Document({ nonce }: { nonce?: string }) {
  return (
    <Html lang="en" className="font-figtree font-normal">
      {/* Prevent flash of light theme before stylesheet loads. See use-theme.ts */}
      <style>
        {`@media (prefers-color-scheme: dark) {
            :root {
              color-scheme: dark;
              background-color: rgb(11 18 32);
              color: white;
            }
          }`}
      </style>
      <Head>
        <link rel="icon" href={ENV_CONFIG.faviconPath} />
        {/*
          init-theme.js is served from /public as a separate file and loaded
          with strategy="beforeInteractive". The nonce attribute ensures it
          passes the script-src 'nonce-{nonce}' CSP directive set by middleware.
          The file hash (sha256-tt2MQTlQNhzboeB5TwRz9Sfq9SZZhu8WPz3/ShVKLMc=)
          is documented here for reference but is NOT used — the nonce approach
          is used instead because nonces work for both inline and src-loaded
          scripts, and the nonce is already required for Next.js inline scripts.
        */}
        <Script
          src="/init-theme.js"
          strategy="beforeInteractive"
          nonce={nonce}
        />
      </Head>
      <body className="bg-canvas-0 text-ink-1000">
        <Main />
        <NextScript nonce={nonce} />
      </body>
    </Html>
  )
}

Document.getInitialProps = async (
  ctx: DocumentContext
): Promise<DocumentInitialProps & { nonce?: string }> => {
  const initialProps = await ctx.defaultGetInitialProps(ctx)
  const csp =
    ctx.req?.headers['content-security-policy'] ??
    ctx.req?.headers['content-security-policy-report-only']
  const nonce = nonceFromCsp(
    typeof csp === 'string' ? csp : csp?.[0]
  )
  return { ...initialProps, nonce }
}

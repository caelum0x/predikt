const API_DOCS_URL = 'https://docs.oracle.markets/api'

/** @type {import('next').NextConfig} */
module.exports = {
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  // eslint config moved - run `next lint` separately in CI
  modularizeImports: {
    '@heroicons/react/solid/?(((\\w*)?/?)*)': {
      transform: '@heroicons/react/solid/{{ matches.[1] }}/{{member}}',
    },
    '@heroicons/react/outline/?(((\\w*)?/?)*)': {
      transform: '@heroicons/react/outline/{{ matches.[1] }}/{{member}}',
    },

    lodash: {
      transform: 'lodash/{{member}}',
    },
  },
  transpilePackages: ['common'],
  experimental: {
    scrollRestoration: true,
  },
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      { hostname: 'oracle.markets' },
      { hostname: 'dev.oracle.markets' },
      { hostname: 'oaidalleapiprodscus.blob.core.windows.net' },
      { hostname: 'lh3.googleusercontent.com' },
      { hostname: 'i.imgur.com' },
      { hostname: 'firebasestorage.googleapis.com' },
      { hostname: 'storage.googleapis.com' },
      { hostname: 'picsum.photos' },
      { hostname: '*.giphy.com' },
    ],
  },
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  webpack: (config) => {
    // Find and remove the default SVG rule
    const fileLoaderRule = config.module.rules.find(
      (rule) => rule.test instanceof RegExp && rule.test.test('.svg')
    )

    if (fileLoaderRule) {
      fileLoaderRule.exclude = /\.svg$/
    }

    // Add SVGR loader for SVG files
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    })

    return config
  },
  async headers() {
    // NOTE: The Content-Security-Policy header is now set per-request by
    // web/middleware.ts, which generates a cryptographically-random nonce and
    // embeds it in script-src — eliminating the need for 'unsafe-inline' and
    // 'unsafe-eval' in script-src.
    //
    // The non-CSP security headers below are kept here as a belt-and-suspenders
    // fallback for any path the middleware might not cover (e.g. static asset
    // routes excluded from the middleware matcher). The middleware also sets
    // these headers on every matched request, so there is no double-send for
    // normal page routes.
    return [
      {
        // Every route EXCEPT /embed/* keeps the belt-and-suspenders
        // X-Frame-Options DENY. Embed widgets are meant to be framed on any
        // site, so they must not receive this header (see middleware.ts, which
        // sets "frame-ancestors *" for /embed and omits X-Frame-Options).
        source: '/((?!embed).*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
      {
        // Embed routes: same non-CSP security headers, minus X-Frame-Options.
        source: '/embed/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/community-guidelines/prize-faq',
        destination: '/community-guidelines/prize-drawings-faq',
        permanent: true,
      },
      {
        source: '/community-guidelines/prize-rules',
        destination: '/community-guidelines/prize-drawings-rules',
        permanent: true,
      },
      {
        source: '/supporter',
        destination: '/membership',
        permanent: true,
      },
      {
        source: '/politics',
        destination: '/election',
        permanent: true,
      },
      {
        source: '/elections',
        destination: '/election',
        permanent: true,
      },

      {
        source: '/api',
        destination: API_DOCS_URL,
        permanent: false,
      },
      {
        source: '/api/v0',
        destination: API_DOCS_URL,
        permanent: false,
      },
      {
        source: '/analytics',
        destination: '/stats',
        permanent: true,
      },
      {
        source: '/store',
        destination: '/shop',
        permanent: true,
      },
      // Aliases that should land on the jobs board (/jobs).
      ...[
        '/job-board',
        '/jobboard',
        '/jobs-board',
        '/jobsboard',
        '/career',
        '/careers',
      ].map((source) => ({
        source,
        destination: '/jobs',
        permanent: true,
      })),

      {
        source: '/versus',
        destination: '/VersusBot?tab=questions',
        permanent: false,
      },
      {
        source: '/privacy',
        destination: 'https://docs.oracle.markets/privacy-policy',
        permanent: true,
      },
      {
        source: '/terms',
        destination: 'https://docs.oracle.markets/terms',
        permanent: true,
      },
      {
        source: '/mana-only-terms',
        destination: 'https://docs.oracle.markets/terms',
        permanent: true,
      },
      {
        source: '/sweepstakes-rules',
        destination: 'https://docs.oracle.markets/sweepstakes-rules',
        permanent: true,
      },
      {
        source: '/umami',
        destination:
          'https://analytics.umami.is/share/ARwUIC9GWLNyowjq/Oracle%20Markets',
        permanent: false,
      },
      {
        source: '/this-month',
        destination: '/browse?f=closing-this-month&s=most-popular',
        permanent: true,
      },
      {
        source: '/search',
        destination: '/browse',
        permanent: true,
      },
      {
        source: '/browse/for-you',
        destination: '/browse?fy=1&f=open',
        permanent: true,
      },
      {
        source: '/find',
        destination: '/browse',
        permanent: true,
      },
      {
        source: '/groups',
        destination: '/browse?t=Topics',
        permanent: true,
      },
      {
        source: '/group/:slug*',
        destination: '/topic/:slug*',
        permanent: true,
      },
      {
        source: '/browse/:slug+',
        destination: '/topic/:slug+',
        permanent: false,
      },
      {
        source: '/old-posts/:slug*',
        destination: '/post/:slug*',
        permanent: true,
      },
      {
        source: '/questions',
        destination: '/browse',
        permanent: true,
      },
      {
        source: '/dashboard/:slug',
        destination: '/news/:slug',
        permanent: true,
      },
      {
        source: '/sports/world-cup',
        destination: '/sports/world-cup-2026',
        permanent: false,
      },
      {
        source: '/home/:newsSlug*',
        has: [
          {
            type: 'query',
            key: 'tab',
            value: '(?<tab>.*)',
          },
        ],
        permanent: false,
        destination: '/news/:tab',
      },
      {
        source: '/news/:newsSlug*',
        has: [
          {
            type: 'query',
            key: 'tab',
            value: '(?<tab>.*)',
          },
        ],
        permanent: false,
        destination: '/news/:tab',
      },
      {
        source: '/:username/portfolio',
        destination: '/:username',
        permanent: false,
      },
      {
        source: '/browse',
        has: [
          {
            type: 'query',
            key: 'topic',
            // Using a named capture group to capture the value of 'topic'
            value: '(?<topic>.*)',
          },
        ],
        permanent: true,
        destination: '/browse/:topic', // Using the captured value here
      },
      // NOTE: add any external redirects at common/envs/constants.ts and update native apps.
    ]
  },
}

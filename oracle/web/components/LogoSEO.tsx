import { JsonLd } from './JsonLd'

export function LogoSEO() {
  const orgData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Predikt',
    url: 'https://oracle.markets',
    logo: 'https://oracle.markets/logo.svg',
    description: 'Create your own prediction market. Unfold the future.',
    sameAs: ['https://twitter.com/Oracle'],
  }

  return <JsonLd data={orgData} id="organization" />
}

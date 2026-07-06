import { ImgHTMLAttributes } from 'react'

export const TurkeyLogoIcon = (props: ImgHTMLAttributes<HTMLImageElement>) => (
  <img
    src="/logo-turkey.png"
    alt="Predikt"
    width={24}
    height={24}
    {...props}
  />
)

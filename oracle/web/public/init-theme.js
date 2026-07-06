// run this in <head> as blocking to prevent flash of light theme when styles load in. See use-theme.ts
{
  const autoDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const localTheme = localStorage.getItem('theme')
  const theme = localTheme ? JSON.parse(localTheme) : 'dark'

  if (theme === 'dark' || (theme !== 'light' && autoDark)) {
    document.documentElement.classList.add('dark')
  }
}

const LANGS = ['es', 'en'];

export function demoLangFromSearch(search) {
  const lang = new URLSearchParams(search).get('lang');
  return LANGS.includes(lang) ? lang : null;
}

export function demoLoginPath(search) {
  const lang = demoLangFromSearch(search);
  return `/login?demo=1${LANGS.includes(lang) ? `&lang=${lang}` : ''}`;
}

// Decision showcase tabs
const decTabs = [...document.querySelectorAll('.dec-nav button')];
const decPanels = [...document.querySelectorAll('.dec-panel')];
decTabs.forEach(t => t.addEventListener('click', () => {
  decTabs.forEach(x => {
    x.classList.toggle('on', x === t);
    x.setAttribute('aria-selected', x === t);
  });
  decPanels.forEach(p => {
    const on = p.id === t.dataset.p;
    p.hidden = !on;
    p.classList.remove('show');
    if (on) { void p.offsetWidth; p.classList.add('show'); }
  });
}));

// Inglés como idioma base del HTML; data-es guarda la versión en español.
const nodes = [...document.querySelectorAll('[data-es], [data-es-html]')];
nodes.forEach(n => {
  if (n.dataset.esHtml !== undefined) n.dataset.enHtml = n.innerHTML;
  else n.dataset.en = n.textContent;
});
// Los aria-label también cambian de idioma; el inglés se guarda del DOM.
const labelNodes = [...document.querySelectorAll('[data-es-label]')];
labelNodes.forEach(n => { n.dataset.enLabel = n.getAttribute('aria-label'); });
const btnES = document.getElementById('lang-es');
const btnEN = document.getElementById('lang-en');
function setLang(lang) {
  nodes.forEach(n => {
    if (n.dataset.esHtml !== undefined) n.innerHTML = lang === 'es' ? n.dataset.esHtml : n.dataset.enHtml;
    else n.textContent = lang === 'es' ? n.dataset.es : n.dataset.en;
  });
  btnES.classList.toggle('on', lang === 'es');
  btnEN.classList.toggle('on', lang === 'en');
  btnES.setAttribute('aria-pressed', lang === 'es');
  btnEN.setAttribute('aria-pressed', lang === 'en');
  labelNodes.forEach(n => n.setAttribute('aria-label', lang === 'es' ? n.dataset.esLabel : n.dataset.enLabel));
  document.documentElement.lang = lang;
  document.title = lang === 'es'
    ? 'nutri. — registro nutricional con precisión de laboratorio'
    : 'nutri. — nutrition tracking with laboratory-grade precision';
}
btnES.addEventListener('click', () => setLang('es'));
btnEN.addEventListener('click', () => setLang('en'));

// Español solo si el visitante lo pide.
if ((navigator.language || '').toLowerCase().startsWith('es')) setLang('es');

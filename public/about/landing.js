// Animate macro bars on load
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.getElementById('day').classList.add('loaded');
}));

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

// ES/EN toggle: data-en holds English text; Spanish original saved on first switch.
const nodes = [...document.querySelectorAll('[data-en], [data-en-html]')];
nodes.forEach(n => {
  if (n.dataset.enHtml !== undefined) n.dataset.esHtml = n.innerHTML;
  else n.dataset.es = n.textContent;
});
const btnES = document.getElementById('lang-es');
const btnEN = document.getElementById('lang-en');
function setLang(lang) {
  nodes.forEach(n => {
    if (n.dataset.enHtml !== undefined) n.innerHTML = lang === 'en' ? n.dataset.enHtml : n.dataset.esHtml;
    else n.textContent = lang === 'en' ? n.dataset.en : n.dataset.es;
  });
  btnES.classList.toggle('on', lang === 'es');
  btnEN.classList.toggle('on', lang === 'en');
  btnES.setAttribute('aria-pressed', lang === 'es');
  btnEN.setAttribute('aria-pressed', lang === 'en');
  document.documentElement.lang = lang;
}
btnES.addEventListener('click', () => setLang('es'));
btnEN.addEventListener('click', () => setLang('en'));

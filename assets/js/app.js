/*
 * FORMEDIL PIEMONTE – applicazione del sito
 * Tutti i contenuti arrivano dal Google Sheet tramite la Web App Apps Script.
 * Sicurezza: i dati sono inseriti nella pagina SOLO come testo (textContent),
 * mai come HTML; i link sono accettati solo se http(s), mailto o tel.
 */
(function () {
  'use strict';

  var API = (window.FORMEDIL_CONFIG && window.FORMEDIL_CONFIG.API_URL) || '';
  var LS_KEY = 'formedil_contenuti_v2';
  var PAGINA_CORSI = 30;
  var D = null;                       // contenuti
  var statoCorsi = { prov: 'ALL', cat: 'ALL', tipo: 'ALL', stato: 'ALL', q: '', limite: PAGINA_CORSI };
  var main = document.getElementById('contenuto');

  /* ------------------------------------------------------------------ utilità */
  function T(k, def) { return (D && D.testi && D.testi[k]) || def || ''; }

  function urlSicuro(u) {
    u = String(u || '').trim();
    return /^(https?:\/\/|mailto:|tel:)[^\s<>"']+$/i.test(u) ? u : '';
  }

  /** Crea un elemento. attrs: class, href, html vietato. Figli: stringhe (testo) o nodi. */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'href') { var s = (String(v).charAt(0) === '#') ? v : urlSicuro(v); if (s) el.setAttribute('href', s); }
      else if (k === 'src') el.setAttribute('src', v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.substring(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) aggiungi(el, arguments[i]);
    return el;
  }
  function aggiungi(el, c) {
    if (c === null || c === undefined || c === false || c === '') return;
    if (Array.isArray(c)) { c.forEach(function (x) { aggiungi(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function icona(nome, extra) {
    var n = String(nome || '').replace(/[^a-z0-9-]/gi, '');
    return h('i', { class: (n.indexOf('fa-facebook') === 0 ? 'fa-brands ' : 'fa-solid ') + n + (extra ? ' ' + extra : ''), 'aria-hidden': 'true' });
  }
  function svuota(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function dataIT(s) { var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; }
  function normalizza(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  /** Immagine da Drive con caricamento alternativo se il link pubblico non è disponibile. */
  function immagine(obj, attrs) {
    if (!obj || (!obj.url && !obj.id)) return null;
    var img = h('img', Object.assign({ loading: 'lazy', alt: (obj.alt || '') }, attrs || {}));
    var tentato = false;
    function alternativo() {
      if (tentato || !obj.id) { img.style.display = 'none'; return; }
      tentato = true;
      var k = 'formedil_img_' + obj.id;
      try { var s = sessionStorage.getItem(k); if (s) { img.src = s; return; } } catch (e) {}
      fetch(API + '?azione=immagine&id=' + encodeURIComponent(obj.id))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok && /^data:image\//.test(j.data)) { img.src = j.data; try { sessionStorage.setItem(k, j.data); } catch (e) {} }
          else img.style.display = 'none';
        })
        .catch(function () { img.style.display = 'none'; });
    }
    img.addEventListener('error', alternativo);
    if (obj.url) img.src = obj.url; else alternativo();
    return img;
  }

  function banner(pagina, titolo, sottotitolo) {
    var img = D.immagini && D.immagini['banner_' + pagina.replace(/-/g, '_')];
    var b = h('div', { class: 'page-banner' + (img ? ' has-img' : '') },
      h('div', { class: 'page-banner-inner' },
        h('div', { class: 'breadcrumb' }, h('a', { href: '#/', text: T('generale_home', 'Home') }), ' › ', h('span', { text: titolo })),
        h('h1', { text: titolo }),
        sottotitolo ? h('p', { text: sottotitolo }) : null));
    if (img && img.url) b.style.backgroundImage = 'url("' + img.url.replace(/["\\]/g, '') + '")';
    return b;
  }

  function intestazioneSezione(titolo, sottotitolo, ico) {
    return h('div', { class: 'section-header' },
      h('h2', null, ico ? [icona(ico), ' '] : null, titolo),
      sottotitolo ? h('p', { text: sottotitolo }) : null,
      h('div', { class: 'line' }));
  }

  /* ------------------------------------------------------------------ dati */
  function leggiCacheLocale() {
    try { var s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function scriviCacheLocale(d) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) { /* memoria piena o non disponibile */ }
  }

  function caricaDati() {
    var locale = leggiCacheLocale();
    if (locale && locale.ok) { D = locale; avvia(); }
    if (!/^https:\/\//.test(API)) { if (!D) errore('Configurazione mancante: impostare API_URL in assets/js/config.js'); return; }
    fetch(API + '?azione=contenuti', { method: 'GET', redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error('Risposta non valida');
        var cambiato = !D || D.generato !== j.generato;
        D = j;
        scriviCacheLocale(j);
        if (cambiato) avvia();
      })
      .catch(function () { if (!D) errore(); });
  }

  function errore(msg) {
    svuota(main);
    main.appendChild(h('div', { class: 'alert-box', role: 'alert' },
      h('p', { text: msg || 'Al momento non è possibile caricare i contenuti. Riprovare tra qualche minuto.' }),
      h('p', null, h('button', { class: 'btn btn-outline', type: 'button', onclick: function () { location.reload(); } }, 'Riprova'))));
  }

  var avviato = false;
  function avvia() {
    document.title = T('sito_titolo', document.title);
    var md = document.querySelector('meta[name="description"]');
    if (md && T('sito_descrizione')) md.setAttribute('content', T('sito_descrizione'));
    disegnaIntestazione();
    disegnaFooter();
    disegnaPagina();
    if (!avviato) { window.addEventListener('hashchange', function () { disegnaPagina(true); }); avviato = true; }
  }

  /* ------------------------------------------------------------------ intestazione e menu */
  function disegnaIntestazione() {
    var box = document.getElementById('logoBox');
    svuota(box);
    var l1 = D.immagini && D.immagini.logo_formedil, l2 = D.immagini && D.immagini.logo_sal;
    if (l1) box.appendChild(immagine(l1, { loading: 'eager' })); else box.appendChild(h('span', { class: 'logo-text', text: 'FORMEDIL Piemonte' }));
    if (l2) { box.appendChild(h('div', { class: 'logo-divider' })); box.appendChild(immagine(l2, { loading: 'eager' })); }
    document.getElementById('menuBtnLabel').textContent = T('menu_pulsante', 'Menu');
    var nav = document.getElementById('mainNav');
    svuota(nav);
    (D.menu || []).forEach(function (m) {
      nav.appendChild(h('li', null, h('a', { href: '#/' + (m.id === 'home' ? '' : m.id), 'data-pagina': m.id }, icona(m.icona), ' ', m.etichetta)));
    });
  }

  function evidenziaMenu(pagina) {
    Array.prototype.forEach.call(document.querySelectorAll('#mainNav a'), function (a) {
      var attivo = a.getAttribute('data-pagina') === pagina;
      a.classList.toggle('active', attivo);
      if (attivo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function chiudiMenu() {
    document.getElementById('mainNav').classList.remove('mobile-open');
    var b = document.getElementById('menuBtn');
    b.setAttribute('aria-expanded', 'false');
    b.querySelector('i').className = 'fa-solid fa-bars';
  }

  document.getElementById('menuBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var nav = document.getElementById('mainNav');
    var aperto = nav.classList.toggle('mobile-open');
    this.setAttribute('aria-expanded', aperto ? 'true' : 'false');
    this.querySelector('i').className = aperto ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
  });
  document.addEventListener('click', function (e) {
    var nav = document.getElementById('mainNav');
    if (nav.classList.contains('mobile-open') && !nav.contains(e.target)) chiudiMenu();
  });

  /* ------------------------------------------------------------------ instradamento */
  function rotta() {
    var hsh = location.hash.replace(/^#\/?/, '');
    var parti = hsh.split('?');
    var seg = parti[0].split('/').filter(Boolean);
    var q = {};
    (parti[1] || '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
    return { pagina: seg[0] || 'home', id: seg[1] ? decodeURIComponent(seg[1]) : '', q: q };
  }

  function disegnaPagina(daNavigazione) {
    var r = rotta();
    chiudiMenu();
    chiudiModali(true);
    svuota(main);
    var pagine = { 'home': pHome, 'chi-siamo': pChiSiamo, 'corsi': pCorsi, 'richiesta': pCorsi, 'scuole': pScuole, 'lavoro': pLavoro, 'news': pNews };
    var legali = D.legali || {};
    if (pagine[r.pagina]) pagine[r.pagina](r);
    else if (legali[r.pagina]) pLegale(r.pagina);
    else pNonTrovata();
    evidenziaMenu(r.pagina === 'richiesta' ? 'corsi' : r.pagina);
    if (r.pagina === 'news' && r.id) apriNews(r.id);
    if (r.pagina === 'richiesta') apriModulo();
    if (daNavigazione) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  }

  /* ------------------------------------------------------------------ HOME */
  function pHome() {
    var heroImg = D.immagini && D.immagini.hero_home;
    var hero = h('section', { class: 'hero' + (heroImg ? ' has-img' : '') },
      h('h1', { text: T('home_hero_titolo') }),
      h('p', { text: T('home_hero_testo') }),
      h('div', { class: 'btn-group' },
        T('home_hero_btn1') ? h('a', { class: 'btn btn-gold', href: '#/' + (T('home_hero_btn1_pagina') || 'corsi') }, icona('fa-graduation-cap'), ' ', T('home_hero_btn1')) : null,
        T('home_hero_btn2') ? h('a', { class: 'btn btn-white', href: '#/' + (T('home_hero_btn2_pagina') || 'lavoro') }, icona('fa-briefcase'), ' ', T('home_hero_btn2')) : null));
    if (heroImg && heroImg.url) hero.style.backgroundImage = 'url("' + heroImg.url.replace(/["\\]/g, '') + '")';
    main.appendChild(hero);

    // notizie in evidenza
    var max = (D.impostazioni && D.impostazioni.newsHome) || 3;
    var evid = (D.news || []).filter(function (n) { return n.inEvidenza; }).slice(0, max);
    if (max > 0) {
      var g = h('div', { class: 'featured-grid' });
      if (!evid.length) g.appendChild(h('p', { class: 'empty', text: T('home_news_vuoto') }));
      evid.forEach(function (n) { g.appendChild(cardNews(n, true)); });
      main.appendChild(h('section', { class: 'featured-news-wrap' },
        intestazioneSezione(T('home_news_titolo'), T('home_news_sottotitolo'), 'fa-star'), g));
    }

    // prossimi corsi
    var nCorsi = (D.impostazioni && D.impostazioni.corsiHome) || 0;
    var prossimi = (D.corsi || []).filter(function (c) { return c.tipo === 'EDIZIONE'; }).slice(0, nCorsi);
    if (nCorsi > 0 && prossimi.length) {
      var lista = h('div');
      prossimi.forEach(function (c) { lista.appendChild(cardCorso(c)); });
      main.appendChild(h('section', { class: 'section-wrap' },
        intestazioneSezione(T('home_corsi_titolo'), T('home_corsi_sottotitolo'), 'fa-calendar-alt'),
        lista,
        h('div', { class: 'more-wrap' }, h('a', { class: 'btn btn-outline', href: '#/corsi' }, T('home_corsi_vedi_tutti'), ' ', icona('fa-arrow-right')))));
    }

    // accessi rapidi
    var qa = h('div', { class: 'quick-access-grid' });
    (D.homeCard || []).forEach(function (c) {
      qa.appendChild(h('a', { class: 'quick-card', href: '#/' + (c.pagina === 'home' ? '' : c.pagina) },
        icona(c.icona), h('h3', { text: c.titolo }), h('p', { text: c.testo })));
    });
    main.appendChild(h('section', { class: 'section-wrap', style: 'padding-top:1rem' }, qa));
  }

  /* ------------------------------------------------------------------ CHI SIAMO */
  function pChiSiamo() {
    var a = D.anagrafica || {};
    main.appendChild(banner('chi-siamo', T('chisiamo_titolo'), T('chisiamo_sottotitolo')));
    var w = h('div', { class: 'section-wrap' });
    w.appendChild(h('div', { class: 'governance-highlight' },
      h('span', { class: 'eyebrow', text: T('chisiamo_gov_etichetta') }),
      h('h2', { text: T('chisiamo_gov_titolo') }),
      h('div', { class: 'gov-grid' },
        a.president ? h('div', { class: 'gov-box' }, h('p', { class: 'role', text: T('chisiamo_presidente_ruolo') }), h('h3', { text: a.president }), h('p', { class: 'note', text: T('chisiamo_presidente_nota') })) : null,
        a.vice_president ? h('div', { class: 'gov-box alt' }, h('p', { class: 'role', text: T('chisiamo_vice_ruolo') }), h('h3', { text: a.vice_president }), h('p', { class: 'note', text: T('chisiamo_vice_nota') })) : null)));
    var g = h('div', { class: 'grid-3' });
    (D.chiSiamo || []).forEach(function (b) {
      g.appendChild(h('article', { class: 'card' }, h('span', { class: 'eyebrow', text: b.categoria }), h('h3', { text: b.titolo }),
        b.sottotitolo ? h('p', { class: 'claim', text: b.sottotitolo }) : null, h('p', { class: 'body', text: b.testo })));
    });
    w.appendChild(g);
    if ((D.numeri || []).length) {
      var ng = h('div', { class: 'numbers-grid' });
      D.numeri.forEach(function (n) {
        ng.appendChild(h('div', { class: 'number-tile' }, h('div', { class: 'val', text: n.valore }), n.unita ? h('div', { class: 'unit', text: n.unita }) : null,
          h('div', { class: 'lbl', text: n.etichetta }), n.descrizione ? h('div', { class: 'desc', text: n.descrizione }) : null));
      });
      w.appendChild(h('div', { style: 'margin-top:3rem' }, intestazioneSezione(T('chisiamo_numeri_titolo')), ng));
    }
    if ((D.ambiti || []).length) {
      var ag = h('div', { class: 'grid-3' });
      D.ambiti.forEach(function (x) {
        ag.appendChild(h('article', { class: 'card ambito' }, h('h3', { text: x.titolo }),
          h('dl', null, x.finalita ? [h('dt', { text: 'Finalità' }), h('dd', { text: x.finalita })] : null,
            x.destinatari ? [h('dt', { text: 'Destinatari' }), h('dd', { text: x.destinatari })] : null,
            x.metodologie ? [h('dt', { text: 'Strutture e metodologie' }), h('dd', { text: x.metodologie })] : null)));
      });
      w.appendChild(h('div', { style: 'margin-top:3rem' }, intestazioneSezione(T('chisiamo_ambiti_titolo')), ag));
    }
    main.appendChild(w);
  }

  /* ------------------------------------------------------------------ CORSI */
  function nomeScuola(id) { var s = (D.scuole || []).filter(function (x) { return x.id === id; })[0]; return s || {}; }

  function classeStato(s) {
    s = normalizza(s);
    if (!s) return '';
    if (/complet|chius|esaur/.test(s)) return 'status-chiuso';
    if (/ultimi/.test(s)) return 'status-ultimi';
    if (/aperte|disponib|aperto/.test(s)) return 'status-aperto';
    return 'status-neutro';
  }

  function cardCorso(c) {
    var sc = nomeScuola(c.scuola);
    var assente = T('corsi_dato_assente', 'Vedi sito della Scuola');
    var gratuito = /gratuit/i.test(c.costo || '');
    var dataTxt = c.dataInizio ? (c.dataFine && c.dataFine !== c.dataInizio ? c.dataInizio + ' – ' + c.dataFine : c.dataInizio) : T('corsi_data_su_richiesta', 'Date su richiesta');
    var durata = c.durataOre ? c.durataOre + ' ore' + (c.durataNote ? ' (' + c.durataNote + ')' : '') : assente;
    var cls = classeStato(c.stato);
    return h('article', { class: 'course-card' + (c.tipo === 'CATALOGO' ? ' catalogo' : '') },
      h('div', null,
        h('div', null,
          c.tipo === 'CATALOGO' ? h('span', { class: 'badge-tag badge-grey', text: T('corsi_tipo_catalogo', 'Catalogo') }) : null,
          gratuito ? h('span', { class: 'badge-tag badge-green' }, icona('fa-tag'), ' Gratuito') : null,
          c.categoria ? h('span', { class: 'badge-tag badge-gold', text: c.categoria }) : null),
        h('h3', { text: c.titolo }),
        h('p', { class: 'where' }, icona('fa-map-marker-alt'), ' ', h('strong', { text: sc.provincia || '' }), ' · ', sc.nomeBreve || '')),
      h('div', { class: 'course-facts' },
        h('span', null, icona('fa-calendar-alt'), ' ', h('strong', { text: T('corsi_etichetta_inizio', 'Inizio') + ': ' }), dataTxt),
        c.orario ? h('span', null, icona('fa-clock'), ' ', c.orario) : null,
        h('span', null, icona('fa-hourglass-half'), ' ', h('strong', { text: T('corsi_etichetta_durata', 'Durata') + ': ' }), durata),
        h('span', null, icona('fa-euro-sign'), ' ', h('strong', { text: T('corsi_etichetta_costo', 'Costo') + ': ' }), c.costo || assente),
        c.sede ? h('span', null, icona('fa-building'), ' ', h('strong', { text: T('corsi_etichetta_sede', 'Sede') + ': ' }), c.sede) : null,
        c.modalita ? h('span', null, icona('fa-laptop'), ' ', c.modalita) : null),
      h('div', { class: 'course-action-group' },
        cls ? h('span', { class: 'badge-status ' + cls, text: c.stato }) : null,
        c.link ? h('a', { class: 'btn btn-gold btn-sm', href: c.link, target: '_blank', rel: 'noopener noreferrer' },
          T('corsi_btn_scheda', 'Scheda'), ' ', icona('fa-external-link-alt')) : null));
  }

  function pCorsi(r) {
    if (r && r.q) {
      if (r.q.scuola) statoCorsi.prov = r.q.scuola;
      if (r.q.categoria) statoCorsi.cat = r.q.categoria;
    }
    statoCorsi.limite = PAGINA_CORSI;
    main.appendChild(banner('corsi', T('corsi_titolo'), T('corsi_sottotitolo')));
    var w = h('div', { class: 'section-wrap' });
    w.appendChild(h('div', { class: 'cta-box' },
      h('div', null, h('h3', { text: T('corsi_cta_titolo') }), h('p', { text: T('corsi_cta_testo') })),
      h('button', { class: 'btn btn-gold', type: 'button', onclick: function () { apriModulo(); } }, icona('fa-envelope'), ' ', T('corsi_cta_btn'))));

    var corsi = D.corsi || [];
    var opt = function (v, t, sel) { return h('option', { value: v, selected: sel ? 'selected' : null, text: t }); };
    var selProv = h('select', { 'aria-label': T('corsi_filtro_provincia') }, opt('ALL', T('corsi_filtro_provincia'), statoCorsi.prov === 'ALL'),
      (D.scuole || []).map(function (s) { return opt(s.id, s.provincia + ' – ' + s.nomeBreve, statoCorsi.prov === s.id); }));
    var categorie = corsi.map(function (c) { return c.categoria; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var selCat = h('select', { 'aria-label': T('corsi_filtro_categoria') }, opt('ALL', T('corsi_filtro_categoria'), statoCorsi.cat === 'ALL'),
      categorie.map(function (c) { return opt(c, c, statoCorsi.cat === c); }));
    var selTipo = h('select', { 'aria-label': T('corsi_filtro_tipo') }, opt('ALL', T('corsi_filtro_tipo'), statoCorsi.tipo === 'ALL'),
      opt('EDIZIONE', T('corsi_tipo_edizione'), statoCorsi.tipo === 'EDIZIONE'), opt('CATALOGO', T('corsi_tipo_catalogo'), statoCorsi.tipo === 'CATALOGO'));
    var stati = corsi.map(function (c) { return c.stato; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var selStato = h('select', { 'aria-label': T('corsi_filtro_stato') }, opt('ALL', T('corsi_filtro_stato'), statoCorsi.stato === 'ALL'),
      stati.map(function (s) { return opt(s, s, statoCorsi.stato === s); }));
    var cerca = h('input', { type: 'search', placeholder: T('corsi_cerca_placeholder'), 'aria-label': T('corsi_cerca_placeholder'), value: statoCorsi.q });
    w.appendChild(h('div', { class: 'filter-bar', role: 'search' }, cerca, selProv, selCat, selTipo, selStato));
    var info = h('div', { class: 'results-info', 'aria-live': 'polite' });
    var lista = h('div');
    var altro = h('div', { class: 'more-wrap' });
    w.appendChild(info); w.appendChild(lista); w.appendChild(altro);
    w.appendChild(h('p', { class: 'note-dati' }, T('corsi_avviso'), ' ',
      D.impostazioni && D.impostazioni.ultimaScansione ? T('corsi_aggiornato') + ' ' + D.impostazioni.ultimaScansione + '.' : ''));
    main.appendChild(w);

    function aggiorna() {
      statoCorsi.prov = selProv.value; statoCorsi.cat = selCat.value; statoCorsi.tipo = selTipo.value;
      statoCorsi.stato = selStato.value; statoCorsi.q = cerca.value;
      var parole = normalizza(statoCorsi.q).split(/\s+/).filter(Boolean);
      var f = corsi.filter(function (c) {
        if (statoCorsi.prov !== 'ALL' && c.scuola !== statoCorsi.prov) return false;
        if (statoCorsi.cat !== 'ALL' && c.categoria !== statoCorsi.cat) return false;
        if (statoCorsi.tipo !== 'ALL' && c.tipo !== statoCorsi.tipo) return false;
        if (statoCorsi.stato !== 'ALL' && c.stato !== statoCorsi.stato) return false;
        if (parole.length) {
          var testo = normalizza([c.titolo, c.categoria, c.sede, nomeScuola(c.scuola).nomeBreve, nomeScuola(c.scuola).provincia].join(' '));
          for (var i = 0; i < parole.length; i++) if (testo.indexOf(parole[i]) < 0) return false;
        }
        return true;
      });
      svuota(lista); svuota(info); svuota(altro);
      info.appendChild(h('span', { text: f.length + ' ' + T('corsi_risultati', 'corsi trovati') }));
      if (!f.length) lista.appendChild(h('p', { class: 'empty', text: T('corsi_vuoto') }));
      f.slice(0, statoCorsi.limite).forEach(function (c) { lista.appendChild(cardCorso(c)); });
      if (f.length > statoCorsi.limite) {
        altro.appendChild(h('button', { class: 'btn btn-outline', type: 'button', onclick: function () { statoCorsi.limite += PAGINA_CORSI; aggiorna(); } },
          T('corsi_mostra_altri', 'Mostra altri') + ' (' + (f.length - statoCorsi.limite) + ')'));
      }
    }
    [selProv, selCat, selTipo, selStato].forEach(function (s) { s.addEventListener('change', function () { statoCorsi.limite = PAGINA_CORSI; aggiorna(); }); });
    var timer;
    cerca.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { statoCorsi.limite = PAGINA_CORSI; aggiorna(); }, 200); });
    aggiorna();
  }

  /* ------------------------------------------------------------------ SCUOLE */
  function pScuole() {
    main.appendChild(banner('scuole', T('scuole_titolo'), T('scuole_sottotitolo')));
    var g = h('div', { class: 'grid-3' });
    (D.scuole || []).forEach(function (s) {
      var logo = s.logo ? immagine(Object.assign({ alt: s.denominazione }, s.logo), { class: 'school-logo-img' }) : null;
      var tel = String(s.telefono || '').replace(/[^\d+]/g, '');
      var emails = String(s.email || '').split(/[\s\/;,]+/).filter(function (x) { return /@/.test(x); });
      g.appendChild(h('article', { class: 'card school-card' },
        h('div', null,
          h('div', { class: 'school-logo-container' }, logo || icona('fa-building')),
          h('span', { class: 'prov', text: s.provincia }),
          h('h3', { text: s.denominazione }),
          s.sede ? h('p', { class: 'addr' }, icona('fa-map-pin'), ' ', s.sede) : null,
          h('div', { class: 'people' },
            s.presidente ? h('p', null, h('strong', { text: T('scuole_presidente', 'Presidente') + ': ' }), s.presidente) : null,
            s.vicepresidente ? h('p', null, h('strong', { text: T('scuole_vicepresidente', 'Vicepresidente') + ': ' }), s.vicepresidente) : null,
            s.direttore ? h('p', null, h('strong', { text: T('scuole_direttore', 'Direttore') + ': ' }), s.direttore) : null),
          h('div', { class: 'contacts' },
            s.telefono ? h('a', { href: tel ? 'tel:' + tel : null }, icona('fa-phone'), ' ', s.telefono) : null,
            emails.map(function (e) { return h('a', { href: 'mailto:' + e }, icona('fa-envelope'), ' ', e); }))),
        h('div', { class: 'school-actions' },
          s.sito ? h('a', { class: 'btn btn-outline btn-sm', href: s.sito, target: '_blank', rel: 'noopener noreferrer' }, T('scuole_btn_sito'), ' ', icona('fa-arrow-right')) : null,
          h('a', { class: 'btn btn-gold btn-sm', href: '#/corsi?scuola=' + encodeURIComponent(s.id) }, icona('fa-graduation-cap'), ' ', T('scuole_btn_corsi')))));
    });
    main.appendChild(h('div', { class: 'section-wrap' }, g));
  }

  /* ------------------------------------------------------------------ SERVIZI AL LAVORO */
  function pLavoro() {
    main.appendChild(banner('lavoro', T('lavoro_titolo'), T('lavoro_sottotitolo')));
    var w = h('div', { class: 'section-wrap' });
    var logoSal = D.immagini && D.immagini.logo_sal;
    w.appendChild(h('div', { class: 'sal-hero-box' },
      h('div', { class: 'sal-badges-row' },
        h('span', { class: 'badge-regione' }, icona('fa-check-circle'), ' ', T('lavoro_badge_regione')),
        logoSal ? immagine(logoSal, { class: 'sal-logo' }) : null,
        h('span', { class: 'sal-free-badge' }, icona('fa-shield-alt'), ' ', T('lavoro_nota_gratuita'))),
      T('lavoro_intro') ? h('div', { class: 'sal-desc-content', text: T('lavoro_intro') }) : null,
      T('lavoro_mission') ? h('div', { class: 'sal-mission-callout' }, h('h4', null, icona('fa-bullseye'), ' ', T('lavoro_mission_titolo')), h('p', { text: T('lavoro_mission') })) : null));
    w.appendChild(intestazioneSezione(T('lavoro_sportelli_titolo'), T('lavoro_sportelli_sottotitolo')));
    var g = h('div', { class: 'sportelli-grid' });
    (D.sportelli || []).forEach(function (sp) {
      var tel = String(sp.telefono || '').replace(/[^\d+]/g, '');
      g.appendChild(h('article', { class: 'sportello-card' },
        h('div', null,
          h('div', { class: 'sportello-name', text: sp.ente }),
          sp.indirizzo ? h('div', { class: 'info-item' }, icona('fa-map-marker-alt'), h('span', { text: sp.indirizzo })) : null,
          sp.email ? h('div', { class: 'info-item' }, icona('fa-envelope'), h('a', { href: 'mailto:' + sp.email, text: sp.email })) : null,
          sp.telefono ? h('div', { class: 'info-item' }, icona('fa-phone'), h('a', { href: tel ? 'tel:' + tel : null, text: sp.telefono })) : null,
          sp.servizi ? h('div', { class: 'info-item' }, icona('fa-list-check'), h('span', { text: T('lavoro_servizi', 'Servizi') + ': ' + sp.servizi })) : null,
          sp.orari ? h('div', { class: 'info-item' }, icona('fa-clock'), h('span', { text: T('lavoro_orari', 'Orari') + ': ' + sp.orari })) : null,
          sp.accesso ? h('div', { class: 'info-item' }, icona('fa-door-open'), h('span', { text: T('lavoro_accesso', 'Accesso') + ': ' + sp.accesso })) : null),
        sp.sito ? h('a', { class: 'btn btn-outline btn-sm sportello-btn', href: sp.sito, target: '_blank', rel: 'noopener noreferrer' }, T('lavoro_btn_sportello'), ' ', icona('fa-external-link-alt')) : null));
    });
    w.appendChild(g);
    if ((D.programmi || []).length) {
      var pg = h('div', { class: 'grid-3' });
      D.programmi.forEach(function (p) {
        pg.appendChild(h('article', { class: 'card' }, h('h3', { text: p.titolo }), h('p', { class: 'body', text: p.descrizione }),
          h('dl', { class: 'ambito' }, p.destinatari ? [h('dt', { text: 'Destinatari' }), h('dd', { text: p.destinatari })] : null,
            p.servizi ? [h('dt', { text: 'Servizi' }), h('dd', { text: p.servizi })] : null,
            p.finanziamento ? [h('dt', { text: 'Finanziamento' }), h('dd', { text: p.finanziamento })] : null),
          p.ctaLink && p.ctaTesto ? h('p', { style: 'margin-top:1rem' }, h('a', { class: 'btn btn-gold btn-sm', href: p.ctaLink, target: '_blank', rel: 'noopener noreferrer', text: p.ctaTesto })) : null));
      });
      w.appendChild(h('div', { style: 'margin-top:3rem' }, intestazioneSezione(T('lavoro_programmi_titolo')), pg));
    }
    main.appendChild(w);
  }

  /* ------------------------------------------------------------------ NEWS */
  function cardNews(n, evidenza) {
    return h('button', { class: 'news-card', type: 'button', onclick: function () { location.hash = '#/news/' + encodeURIComponent(n.id); } },
      n.immagine ? immagine(Object.assign({ alt: n.titolo }, n.immagine), { class: 'news-card-thumb' }) : null,
      h('div', { class: 'news-card-content' },
        h('div', null,
          h('div', { class: 'news-meta' },
            evidenza ? h('span', { class: 'badge-evidenza' }, icona('fa-bolt'), ' ', T('home_badge_evidenza')) : h('span', { class: 'cat', text: n.categoria }),
            h('span', { class: 'date', text: n.data })),
          h('h3', { text: n.titolo }),
          h('p', { text: n.sommario })),
        h('span', { class: 'news-click-prompt' }, evidenza ? T('home_news_leggi') : T('news_apri'), ' ', icona('fa-arrow-right'))));
  }

  function pNews() {
    main.appendChild(banner('news', T('news_titolo'), T('news_sottotitolo')));
    var g = h('div', { class: 'grid-3' });
    if (!(D.news || []).length) g.appendChild(h('p', { class: 'empty', text: T('news_vuoto') }));
    (D.news || []).forEach(function (n) { g.appendChild(cardNews(n, false)); });
    main.appendChild(h('div', { class: 'section-wrap' }, g));
  }

  function apriNews(id) {
    var n = (D.news || []).filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    var b = document.getElementById('newsModalBody');
    svuota(b);
    b.appendChild(h('div', { class: 'news-meta' }, h('span', { class: 'cat', text: n.categoria }), h('span', { class: 'date', text: n.data })));
    b.appendChild(h('h2', { id: 'newsModalTitle', text: n.titolo }));
    if (n.immagine) {
      var img = immagine(Object.assign({ alt: n.didascalia || n.titolo }, n.immagine), { class: 'modal-cover-img', loading: 'eager' });
      b.appendChild(img);
      if (n.didascalia) b.appendChild(h('p', { class: 'modal-img-caption', text: n.didascalia }));
    }
    if (n.sommario) b.appendChild(h('div', { class: 'modal-summary', text: n.sommario }));
    b.appendChild(h('div', { class: 'modal-body', text: n.testo || '' }));
    if (n.allegato) b.appendChild(h('a', { class: 'btn btn-gold', href: n.allegato, target: '_blank', rel: 'noopener noreferrer', style: 'width:100%' }, icona('fa-file-pdf'), ' ', T('news_allegato_btn')));
    apriModale('newsModal', function () { if (/^#\/news\//.test(location.hash)) history.replaceState(null, '', '#/news'); });
  }

  /* ------------------------------------------------------------------ PAGINE LEGALI */
  function pLegale(pagina) {
    var L = D.legali[pagina];
    main.appendChild(banner(pagina, L.titolo || pagina, ''));
    var box = h('div', { class: 'legal' });
    L.sezioni.forEach(function (s) {
      if (s.titolo) box.appendChild(h('h2', { text: s.titolo }));
      box.appendChild(h('p', { text: s.testo }));
    });
    main.appendChild(h('div', { class: 'section-wrap' }, box));
    document.title = (L.titolo || pagina) + ' | FORMEDIL Piemonte';
  }

  function pNonTrovata() {
    main.appendChild(h('div', { class: 'alert-box' }, h('h2', { text: T('generale_pagina_non_trovata', 'Pagina non trovata') }),
      h('p', { style: 'margin-top:1rem' }, h('a', { class: 'btn btn-outline', href: '#/', text: T('generale_torna_home', 'Torna alla Home') }))));
  }

  /* ------------------------------------------------------------------ MODALI */
  var focusPrecedente = null, alChiudere = null;
  function apriModale(id, cb) {
    focusPrecedente = document.activeElement;
    alChiudere = cb || null;
    var m = document.getElementById(id);
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    var f = m.querySelector('input:not([name=sito_web]), select, textarea, .modal-close-btn');
    if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function chiudiModali(silenzioso) {
    var aperta = false;
    Array.prototype.forEach.call(document.querySelectorAll('.modal-overlay.open'), function (m) { m.classList.remove('open'); aperta = true; });
    document.body.style.overflow = '';
    if (aperta && !silenzioso) {
      if (alChiudere) alChiudere();
      if (focusPrecedente && focusPrecedente.focus) focusPrecedente.focus();
    }
    alChiudere = null;
  }
  Array.prototype.forEach.call(document.querySelectorAll('.modal-overlay'), function (m) {
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) chiudiModali(); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') chiudiModali(); });

  /* ------------------------------------------------------------------ MODULO RICHIESTA CORSO */
  function apriModulo(precompila) {
    var b = document.getElementById('formModalBody');
    svuota(b);
    var aperturaMs = Date.now();
    var campo = function (id, etichetta, el, obbligatorio) {
      el.id = id; if (obbligatorio) el.required = true;
      return h('div', { class: 'form-row' }, h('label', { for: id }, etichetta, obbligatorio ? ' *' : ''), el);
    };
    var nome = h('input', { type: 'text', maxlength: '100', autocomplete: 'name' });
    var email = h('input', { type: 'email', maxlength: '254', autocomplete: 'email' });
    var tel = h('input', { type: 'tel', maxlength: '30', autocomplete: 'tel' });
    var prov = h('select', null, h('option', { value: '', text: T('modulo_provincia_scegli') }),
      (D.scuole || []).map(function (s) { return h('option', { value: s.id, text: s.provincia + ' – ' + s.nomeBreve }); }));
    if (statoCorsi.prov && statoCorsi.prov !== 'ALL') prov.value = statoCorsi.prov;
    var corso = h('input', { type: 'text', maxlength: '200', value: (precompila && precompila.corso) || '' });
    var msg = h('textarea', { maxlength: '2000', rows: '4', placeholder: T('modulo_messaggio_placeholder') });
    var privacy = h('input', { type: 'checkbox', id: 'fPrivacy', required: true });
    var trappola = h('input', { type: 'text', name: 'sito_web', tabindex: '-1', autocomplete: 'off' });
    var invia = h('button', { class: 'btn btn-gold', type: 'submit', style: 'width:100%' }, icona('fa-paper-plane'), ' ', T('modulo_invia', 'Invia'));
    var esito = h('div', { class: 'form-feedback', role: 'status', 'aria-live': 'polite' });
    var informativa = D.legali && D.legali['informativa-modulo'];

    var form = h('form', { novalidate: true },
      campo('fNome', T('modulo_nome'), nome, true),
      h('div', { class: 'form-grid' }, campo('fEmail', T('modulo_email'), email, true), campo('fTel', T('modulo_telefono'), tel, false)),
      campo('fProv', T('modulo_provincia'), prov, true),
      campo('fCorso', T('modulo_corso'), corso, false),
      campo('fMsg', T('modulo_messaggio'), msg, false),
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', null, 'Lasciare vuoto', trappola)),
      informativa ? h('details', { class: 'form-info' }, h('summary', { text: T('modulo_privacy_link', 'Informativa') }),
        informativa.sezioni.map(function (s) { return h('p', { text: s.testo }); }),
        D.legali.privacy ? h('p', null, h('a', { href: '#/privacy', text: (D.legali.privacy.titolo || 'Privacy') })) : null) : null,
      h('div', { class: 'form-row form-check' }, privacy, h('label', { for: 'fPrivacy', text: T('modulo_privacy_testo') + ' *' })),
      h('p', { class: 'form-note', text: T('modulo_nota_dati') }),
      invia, esito);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      esito.className = 'form-feedback'; esito.textContent = '';
      var valido = nome.value.trim().length >= 3 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.value.trim()) && prov.value &&
                   (corso.value.trim() || msg.value.trim()) && privacy.checked;
      if (!valido) { esito.className = 'form-feedback ko'; esito.textContent = T('modulo_errore_validazione'); return; }
      invia.disabled = true;
      var testoPulsante = invia.lastChild.textContent;
      invia.lastChild.textContent = ' ' + T('modulo_invio_in_corso', 'Invio...');
      fetch(API, {
        method: 'POST', redirect: 'follow',
        body: JSON.stringify({ azione: 'richiesta', nome: nome.value, email: email.value, telefono: tel.value, provincia: prov.value,
                               corso: corso.value, messaggio: msg.value, privacy: privacy.checked, sito_web: trappola.value,
                               tempo: Date.now() - aperturaMs })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) {
          esito.className = 'form-feedback ok'; esito.textContent = j.messaggio || T('modulo_ok');
          form.reset();
          setTimeout(function () { if (document.getElementById('formModal').classList.contains('open')) chiudiModali(); }, 5000);
        } else { esito.className = 'form-feedback ko'; esito.textContent = (j && j.errore) || T('modulo_errore'); }
      }).catch(function () {
        esito.className = 'form-feedback ko'; esito.textContent = T('modulo_errore');
      }).then(function () { invia.disabled = false; invia.lastChild.textContent = testoPulsante; });
    });

    b.appendChild(h('h2', { id: 'formModalTitle', text: T('modulo_titolo') }));
    b.appendChild(h('p', { class: 'form-note', text: T('modulo_intro') }));
    b.appendChild(form);
    apriModale('formModal', function () { if (location.hash.indexOf('#/richiesta') === 0) history.replaceState(null, '', '#/corsi'); });
  }

  /* ------------------------------------------------------------------ FOOTER */
  function disegnaFooter() {
    var a = D.anagrafica || {};
    var f = document.getElementById('footer');
    svuota(f);
    var contatti = [];
    if (a.phone) contatti.push(h('a', { href: 'tel:' + String(a.phone).replace(/[^\d+]/g, '') }, icona('fa-phone'), ' ', a.phone));
    if (a.email) contatti.push(h('a', { href: 'mailto:' + a.email }, icona('fa-envelope'), ' ', a.email));
    if (a.pec) contatti.push(h('span', null, 'PEC: ', a.pec));
    var link = [];
    ['privacy', 'cookie', 'note-legali'].forEach(function (p) {
      if (D.legali && D.legali[p]) link.push(h('a', { href: '#/' + p, text: T('footer_' + p.replace('-', '_'), p) }));
    });
    if (a.facebook_url) link.push(h('a', { href: a.facebook_url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Facebook' }, icona('fa-facebook'), ' Facebook'));
    f.appendChild(h('h3', { text: T('footer_titolo', 'FORMEDIL PIEMONTE') }));
    f.appendChild(h('p', null, a.legal_address || '', a.tax_code ? ' | ' + T('footer_cf', 'C.F.') + ' ' + a.tax_code : ''));
    if (contatti.length) f.appendChild(h('div', { class: 'footer-links' }, contatti));
    f.appendChild(h('p', { text: T('footer_copyright', '© FORMEDIL Piemonte') + ' ' + new Date().getFullYear() + ' • ' + T('footer_sottotitolo') }));
    if (link.length) f.appendChild(h('div', { class: 'footer-links' }, link));
  }

  /* ------------------------------------------------------------------ AVVIO */
  caricaDati();
})();

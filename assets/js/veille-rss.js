/**
 * Veille RSS — cybersécurité & IA
 * Fonctionnalités :
 *   - 9 flux RSS (FR + EN) via rss2json + fallback AllOrigins
 *   - Cache localStorage (TTL 30 min)
 *   - Auto-refresh toutes les 30 min + compte à rebours
 *   - Recherche en temps réel par mot-clé
 *   - Badge "Nouveau" pour les articles < 24 h
 *   - Compteur d'articles par filtre
 * Sécurité : tout le contenu RSS est inséré via textContent ou
 *   des attributs strictement validés — aucun innerHTML avec
 *   du contenu externe non échappé.
 */
(function () {
  'use strict';

  /* ── Configuration ──────────────────────────────────────── */
  var RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json';
  var CACHE_KEY    = 'veille_rss_cache';
  var CACHE_TTL_MS = 30 * 60 * 1000;
  var REFRESH_MS   = 30 * 60 * 1000;
  var MAX_ARTICLES = 60;

  var FEEDS = [
    { rss: 'https://feeds.feedburner.com/TheHackersNews',                          source: 'The Hacker News' },
    { rss: 'https://www.bleepingcomputer.com/feed/',                               source: 'BleepingComputer' },
    { rss: 'https://krebsonsecurity.com/feed/',                                    source: 'Krebs on Security' },
    { rss: 'https://nakedsecurity.sophos.com/feed/',                               source: 'Sophos – Naked Security' },
    { rss: 'https://securelist.com/feed/',                                         source: 'Kaspersky Securelist' },
    { rss: 'https://www.cert.ssi.gouv.fr/feed/',                                   source: 'CERT-FR (ANSSI)' },
    { rss: 'https://www.zataz.com/feed/',                                          source: 'ZATAZ' },
    { rss: 'https://www.zdnet.fr/feeds/rss/actualites/',                           source: 'ZDNet France' },
    { rss: 'https://www.lemondeinformatique.fr/rss/informatique-generale_all.xml', source: 'Le Monde Informatique' }
  ];

  /* ── Patterns de catégorisation ─────────────────────────── */
  var CAT_PATTERNS = [
    { cat: 'hacking-ia',     re: /\b(ai|a\.i\.|artificial intelligence|machine learning|deep\s*learning|llm|gpt|chatgpt|openai|anthropic|claude|gemini|generative|deepfake|neural|copilot|prompt inject|jailbreak|adversarial|model poisoning)\b/i },
    { cat: 'ia',             re: /\b(intelligence artificielle|automatisation|automation|automat|robot|nlp|nlg|computer vision)\b/i },
    { cat: 'cloud',          re: /\b(aws|azure|gcp|cloud|saas|paas|iaas|kubernetes|k8s|container|serverless|terraform)\b/i },
    { cat: 'virtualisation', re: /\b(vmware|hyper-v|virtualisation|virtuali[sz]ation|docker|hypervisor|vsphere|proxmox|kvm)\b/i },
    { cat: 'reseau',         re: /\b(network|r[eé]seau|wifi|wi-fi|vpn|dns|firewall|pare-feu|routing|routage|tcp|sd-wan|zero.?trust|bgp|vlan)\b/i }
  ];

  var CAT_LABELS = {
    'hacking-ia':   'Cybersécurité & IA',
    securite:       'Cybersécurité',
    reseau:         'Réseau',
    virtualisation: 'Virtualisation',
    cloud:          'Cloud',
    ia:             'IA & Automatisation'
  };

  /* ── Utilitaires texte ──────────────────────────────────── */
  function stripHtml(html) {
    if (!html) return '';
    var d = document.createElement('div');
    /* DOMParser — le navigateur parse mais n'exécute pas les scripts */
    d.innerHTML = String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
    return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function summarize(text, max) {
    max = max || 320;
    if (!text) return 'Résumé indisponible — voir l\'article source.';
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var last = cut.lastIndexOf(' ');
    return (last > max * 0.6 ? cut.slice(0, last) : cut) + '…';
  }

  function categorize(title, desc) {
    var blob = (title + ' ' + desc).toLowerCase();
    for (var i = 0; i < CAT_PATTERNS.length; i++) {
      if (CAT_PATTERNS[i].re.test(blob)) return CAT_PATTERNS[i].cat;
    }
    return 'securite';
  }

  /* ── Dates ──────────────────────────────────────────────── */
  function parseDate(item) {
    var d = new Date(item.pubDate || '');
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function formatDate(item) {
    var d = new Date(item.pubDate || '');
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function isNew(item) {
    var ts = parseDate(item);
    return ts > 0 && (Date.now() - ts) < 24 * 60 * 60 * 1000;
  }

  function safeHref(url) {
    if (!url || typeof url !== 'string') return null;
    var u = url.trim();
    return /^https?:\/\//i.test(u) ? u : null;
  }

  /* ── Cache localStorage ─────────────────────────────────── */
  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.ts || !obj.items) return null;
      if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
      return obj.items;
    } catch (e) { return null; }
  }

  function saveCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: items })); }
    catch (e) { /* quota dépassé */ }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  /* ── Fetch via rss2json ─────────────────────────────────── */
  function fetchViaRss2json(entry) {
    var url = RSS2JSON_URL + '?rss_url=' + encodeURIComponent(entry.rss) + '&count=20';
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.status !== 'ok' || !data.items) throw new Error(data.message || 'Flux invalide');
        return data.items.map(function (item) {
          return {
            title:       String(item.title || 'Sans titre'),
            link:        safeHref(item.link),
            pubDate:     String(item.pubDate || ''),
            description: String(item.description || item.content || ''),
            source:      entry.source
          };
        });
      });
  }

  /* ── Fallback : AllOrigins + DOMParser ──────────────────── */
  function fetchViaAllOrigins(entry) {
    var proxy = 'https://api.allorigins.win/get?url=' + encodeURIComponent(entry.rss);
    return fetch(proxy)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var parser = new DOMParser();
        var xml = parser.parseFromString(data.contents, 'text/xml');
        var items = Array.from(xml.querySelectorAll('item'));
        if (!items.length) throw new Error('Aucun item XML');
        return items.slice(0, 20).map(function (el) {
          var g = function (tag) { var n = el.querySelector(tag); return n ? (n.textContent || '').trim() : ''; };
          return {
            title:       g('title') || 'Sans titre',
            link:        safeHref(g('link')),
            pubDate:     g('pubDate'),
            description: g('description'),
            source:      entry.source
          };
        });
      });
  }

  function fetchFeed(entry) {
    return fetchViaRss2json(entry).catch(function () { return fetchViaAllOrigins(entry); });
  }

  /* ── Fusion & déduplication ─────────────────────────────── */
  function mergeAndDedupe(arrays) {
    var seen = {}, out = [];
    arrays.forEach(function (items) {
      items.forEach(function (it) {
        var key = it.link || it.title;
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(it);
      });
    });
    out.sort(function (a, b) { return parseDate(b) - parseDate(a); });
    return out.slice(0, MAX_ARTICLES);
  }

  /* ── Construction DOM sécurisée d'un article ────────────── */
  function buildArticleElement(item) {
    var plain   = stripHtml(item.description);
    var summary = summarize(plain, 340);
    var cat     = categorize(item.title, plain);

    var article = document.createElement('article');
    article.className = 'veille-article';
    article.setAttribute('data-category', cat);
    article.setAttribute('data-search', (item.title + ' ' + plain + ' ' + item.source).toLowerCase());

    /* En-tête */
    var header = document.createElement('div');
    header.className = 'article-header';

    var titleEl = document.createElement('h3');
    titleEl.className = 'article-title';
    if (item.link) {
      var a = document.createElement('a');
      a.href   = item.link;
      a.target = '_blank';
      a.rel    = 'noopener noreferrer';
      a.textContent = item.title;
      titleEl.appendChild(a);
    } else {
      titleEl.textContent = item.title;
    }
    if (isNew(item)) {
      var badge = document.createElement('span');
      badge.className = 'badge bg-danger ms-2';
      badge.style.fontSize    = '.7rem';
      badge.style.verticalAlign = 'middle';
      badge.textContent = 'Nouveau';
      titleEl.appendChild(badge);
    }

    var dateEl = document.createElement('span');
    dateEl.className = 'article-date';
    var calIcon = document.createElement('i');
    calIcon.className = 'bi bi-calendar me-1';
    dateEl.appendChild(calIcon);
    dateEl.appendChild(document.createTextNode(' ' + formatDate(item)));

    header.appendChild(titleEl);
    header.appendChild(dateEl);

    /* Source */
    var sourceEl = document.createElement('div');
    sourceEl.className = 'article-source';
    var rssIcon = document.createElement('i');
    rssIcon.className = 'bi bi-rss me-1';
    sourceEl.appendChild(rssIcon);
    sourceEl.appendChild(document.createTextNode('Source : ' + item.source));

    /* Résumé */
    var descEl = document.createElement('p');
    descEl.className = 'article-description';
    descEl.textContent = summary;

    /* Tags */
    var tagsEl = document.createElement('div');
    tagsEl.className = 'article-tags';
    var tagCat = document.createElement('span');
    tagCat.className = 'article-tag';
    tagCat.textContent = CAT_LABELS[cat] || cat;
    var tagRss = document.createElement('span');
    tagRss.className = 'article-tag';
    tagRss.textContent = 'Flux RSS';
    tagsEl.appendChild(tagCat);
    tagsEl.appendChild(tagRss);

    /* Lien */
    var linkEl = document.createElement('a');
    linkEl.className = 'article-link';
    linkEl.target = '_blank';
    linkEl.rel    = 'noopener noreferrer';
    if (item.link) {
      linkEl.href = item.link;
    } else {
      linkEl.href = '#';
      linkEl.setAttribute('aria-disabled', 'true');
    }
    linkEl.appendChild(document.createTextNode('Lire l\'article source '));
    var extIcon = document.createElement('i');
    extIcon.className = 'bi bi-box-arrow-up-right';
    linkEl.appendChild(extIcon);

    article.appendChild(header);
    article.appendChild(sourceEl);
    article.appendChild(descEl);
    article.appendChild(tagsEl);
    article.appendChild(linkEl);

    return article;
  }

  function renderArticles(container, items) {
    container.innerHTML = '';
    var frag = document.createDocumentFragment();
    items.forEach(function (item) { frag.appendChild(buildArticleElement(item)); });
    container.appendChild(frag);
  }

  /* ── Compteurs sur les boutons de filtre ────────────────── */
  function updateFilterCounts() {
    var articles = document.querySelectorAll('#rss-articles-container .veille-article');
    var counts   = { all: 0 };
    articles.forEach(function (a) {
      var cat = a.getAttribute('data-category') || 'securite';
      counts.all++;
      counts[cat] = (counts[cat] || 0) + 1;
    });
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
      var f     = btn.getAttribute('data-filter');
      var base  = btn.getAttribute('data-label') || btn.textContent.replace(/\s*\(\d+\)\s*$/, '').trim();
      btn.setAttribute('data-label', base);
      var cnt = counts[f];
      btn.textContent = base + (cnt ? ' (' + cnt + ')' : '');
    });
  }

  /* ── Filtres + Recherche ────────────────────────────────── */
  var currentFilter = 'all';
  var currentSearch = '';

  function applyFilters() {
    document.querySelectorAll('#rss-articles-container .veille-article').forEach(function (article) {
      var cat      = article.getAttribute('data-category') || '';
      var srchData = article.getAttribute('data-search') || '';
      var okCat    = currentFilter === 'all' || cat === currentFilter;
      var okSrch   = !currentSearch || srchData.indexOf(currentSearch) !== -1;
      article.style.display = (okCat && okSrch) ? '' : 'none';
    });
  }

  function bindFilters() {
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        applyFilters();
      });
    });
    var searchInput = document.getElementById('veille-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        currentSearch = this.value.trim().toLowerCase();
        applyFilters();
      });
    }
  }

  /* ── Compte à rebours ───────────────────────────────────── */
  var countdownInterval = null;

  function startCountdown(timerEl) {
    if (countdownInterval) clearInterval(countdownInterval);
    var deadline = Date.now() + REFRESH_MS;
    countdownInterval = setInterval(function () {
      var rem = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      var m   = Math.floor(rem / 60);
      var s   = rem % 60;
      timerEl.textContent = 'Prochain rafraîchissement dans ' + m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  /* ── Chargement ─────────────────────────────────────────── */
  function load(container, statusEl, timerEl, forceRefresh) {
    if (!forceRefresh) {
      var cached = loadCache();
      if (cached && cached.length) {
        renderArticles(container, cached);
        updateFilterCounts();
        bindFilters();
        setStatus(statusEl, 'info',
          'bi-database',
          cached.length + ' articles (cache — dernière mise à jour < 30 min)');
        if (timerEl) startCountdown(timerEl);
        return;
      }
    }

    setStatus(statusEl, 'loading', null, null);

    Promise.allSettled(FEEDS.map(fetchFeed))
      .then(function (results) {
        var arrays = [], failed = 0;
        results.forEach(function (res) {
          if (res.status === 'fulfilled' && res.value && res.value.length) arrays.push(res.value);
          else failed++;
        });
        var merged = mergeAndDedupe(arrays);
        if (!merged.length) {
          showError(container, 'Aucun article reçu des flux.');
          setStatus(statusEl, 'empty', null, null);
          return;
        }
        saveCache(merged);
        renderArticles(container, merged);
        updateFilterCounts();
        bindFilters();
        setStatus(statusEl, 'ok', 'bi-check-circle',
          merged.length + ' articles · ' + (FEEDS.length - failed) + '/' + FEEDS.length + ' flux actifs'
          + (failed ? ' · ' + failed + ' flux indisponible(s)' : ''));
        if (timerEl) startCountdown(timerEl);
      })
      .catch(function (e) {
        console.error(e);
        showError(container, 'Impossible de récupérer les flux RSS. ' + (e.message || ''));
        setStatus(statusEl, 'empty', null, null);
      });
  }

  /* ── Helpers statut ─────────────────────────────────────── */
  function setStatus(el, type, icon, msg) {
    if (!el) return;
    el.innerHTML = '';
    if (type === 'loading') {
      var spinner = document.createElement('div');
      spinner.className = 'd-flex align-items-center gap-2 text-muted';
      var sp = document.createElement('span');
      sp.className = 'spinner-border spinner-border-sm';
      sp.setAttribute('role', 'status');
      spinner.appendChild(sp);
      spinner.appendChild(document.createTextNode(' Chargement des flux RSS…'));
      el.appendChild(spinner);
      return;
    }
    if (type === 'empty') return;
    var span = document.createElement('span');
    span.className = type === 'ok' ? 'text-success' : 'text-info';
    if (icon) {
      var i = document.createElement('i');
      i.className = 'bi ' + icon + ' me-1';
      span.appendChild(i);
    }
    span.appendChild(document.createTextNode(msg || ''));
    el.appendChild(span);
  }

  function showError(container, msg) {
    container.innerHTML = '';
    var alert = document.createElement('div');
    alert.className = 'alert alert-warning border-0 shadow-sm';
    alert.setAttribute('role', 'alert');

    var h4 = document.createElement('h4');
    h4.className = 'alert-heading';
    var icon = document.createElement('i');
    icon.className = 'bi bi-exclamation-triangle me-2';
    h4.appendChild(icon);
    h4.appendChild(document.createTextNode('Chargement des flux'));

    var p1 = document.createElement('p');
    p1.textContent = msg;

    var p2 = document.createElement('p');
    p2.className = 'mb-0 small';
    p2.textContent = 'Conseil : ouvrez la page via un serveur HTTP (GitHub Pages, Live Server…). Les appels API sont bloqués en file://.';

    alert.appendChild(h4);
    alert.appendChild(p1);
    alert.appendChild(p2);
    container.appendChild(alert);
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    var container  = document.getElementById('rss-articles-container');
    var statusEl   = document.getElementById('rss-status');
    var timerEl    = document.getElementById('rss-timer');
    var refreshBtn = document.getElementById('rss-refresh-btn');
    if (!container) return;

    load(container, statusEl, timerEl, false);

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        clearCache();
        currentFilter = 'all';
        currentSearch = '';
        var searchInput = document.getElementById('veille-search');
        if (searchInput) searchInput.value = '';
        document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        var allBtn = document.querySelector('.filter-btn[data-filter="all"]');
        if (allBtn) allBtn.classList.add('active');
        load(container, statusEl, timerEl, true);
      });
    }

    /* Auto-refresh */
    setTimeout(function tick() {
      clearCache();
      load(container, statusEl, timerEl, true);
      setTimeout(tick, REFRESH_MS);
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

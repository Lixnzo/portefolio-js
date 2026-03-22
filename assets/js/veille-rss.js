/**
 * Veille RSS — cybersécurité & IA
 * Agrège des flux publics via rss2json (nécessite une page servie en HTTP/HTTPS pour les appels API).
 */
(function () {
  'use strict';

  var RSS2JSON = 'https://api.rss2json.com/v1/api.json';

  var FEEDS = [
    { rss: 'https://feeds.feedburner.com/TheHackersNews', source: 'The Hacker News' },
    { rss: 'https://www.bleepingcomputer.com/feed/', source: 'BleepingComputer' },
    { rss: 'https://krebsonsecurity.com/feed/', source: 'Krebs on Security' },
    { rss: 'https://www.darkreading.com/rss.xml', source: 'Dark Reading' }
  ];

  var AI_PATTERN = /\b(ai|a\.i\.|artificial intelligence|machine learning|deep\s*learning|llm|gpt|chatgpt|openai|anthropic|claude|gemini|generative|deepfake|neural|copilot|prompt|jailbreak|adversarial)\b/i;
  var CLOUD_PATTERN = /\b(aws|azure|gcp|cloud|saas|kubernetes|k8s|container)\b/i;
  var NET_PATTERN = /\b(network|wifi|vpn|dns|firewall|routing|tcp\/ip|sd-wan|zero trust)\b/i;
  var VIRT_PATTERN = /\b(vmware|hyper-v|virtuali[sz]ation|docker|hypervisor|vsphere)\b/i;

  function stripHtml(html) {
    if (!html) return '';
    var d = document.createElement('div');
    d.innerHTML = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    var t = d.textContent || d.innerText || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  function summarize(text, maxLen) {
    maxLen = maxLen || 320;
    if (!text) return 'Résumé indisponible — voir l’article source.';
    if (text.length <= maxLen) return text;
    var cut = text.slice(0, maxLen);
    var last = cut.lastIndexOf(' ');
    if (last > maxLen * 0.6) cut = cut.slice(0, last);
    return cut + '…';
  }

  function categorize(title, desc) {
    var blob = (title + ' ' + desc).toLowerCase();
    if (AI_PATTERN.test(blob)) return 'hacking-ia';
    if (CLOUD_PATTERN.test(blob)) return 'cloud';
    if (VIRT_PATTERN.test(blob)) return 'virtualisation';
    if (NET_PATTERN.test(blob)) return 'reseau';
    if (/\b(ai|automation|automated)\b/i.test(blob)) return 'ia';
    return 'securite';
  }

  function parseDate(item) {
    var raw = item.pubDate || item.published || '';
    var d = new Date(raw);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function formatDate(item) {
    var raw = item.pubDate || item.published || '';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function safeHref(url) {
    if (!url || typeof url !== 'string') return '#';
    var u = url.trim();
    if (/^https?:\/\//i.test(u)) return u;
    return '#';
  }

  function fetchFeed(entry) {
    var url = RSS2JSON + '?rss_url=' + encodeURIComponent(entry.rss);
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.status !== 'ok' || !data.items) throw new Error(data.message || 'Flux invalide');
        return data.items.map(function (item) {
          return {
            title: item.title || 'Sans titre',
            link: safeHref(item.link),
            pubDate: item.pubDate,
            description: item.description || item.content || '',
            author: item.author,
            source: entry.source
          };
        });
      });
  }

  function mergeAndDedupe(arrays) {
    var seen = {};
    var out = [];
    arrays.forEach(function (items) {
      items.forEach(function (it) {
        var key = it.link || it.title;
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(it);
      });
    });
    out.sort(function (a, b) {
      return parseDate(b) - parseDate(a);
    });
    return out.slice(0, 48);
  }

  function tagLabel(cat) {
    var map = {
      'hacking-ia': 'Cybersécurité & IA',
      securite: 'Cybersécurité',
      reseau: 'Réseau',
      virtualisation: 'Virtualisation',
      cloud: 'Cloud',
      ia: 'IA & automatisation'
    };
    return map[cat] || cat;
  }

  function renderArticles(container, items) {
    container.innerHTML = '';
    items.forEach(function (item) {
      var plain = stripHtml(item.description);
      var summary = summarize(plain, 340);
      var cat = categorize(item.title, plain);
      var article = document.createElement('article');
      article.className = 'veille-article';
      article.setAttribute('data-category', cat);
      var href = item.link;
      var linkAttr = href === '#' ? '#' : href.replace(/"/g, '&quot;');
      article.innerHTML =
        '<div class="article-header">' +
        '<h3 class="article-title"><a href="' +
        linkAttr +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(item.title) +
        '</a></h3>' +
        '<span class="article-date"><i class="bi bi-calendar"></i> ' +
        formatDate(item) +
        '</span></div>' +
        '<div class="article-source"><i class="bi bi-rss"></i> Source : ' +
        escapeHtml(item.source) +
        '</div>' +
        '<p class="article-description">' +
        escapeHtml(summary) +
        '</p>' +
        '<div class="article-tags">' +
        '<span class="article-tag">' +
        escapeHtml(tagLabel(cat)) +
        '</span>' +
        '<span class="article-tag">Flux RSS</span>' +
        '</div>' +
        '<a href="' +
        linkAttr +
        '" class="article-link" target="_blank" rel="noopener noreferrer">Lire l’article source <i class="bi bi-box-arrow-up-right"></i></a>';
      container.appendChild(article);
    });
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    if (!s || s === '#') return '#';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/'/g, '&#39;');
  }

  function showError(container, msg) {
    container.innerHTML =
      '<div class="alert alert-warning border-0 shadow-sm" role="alert">' +
      '<h4 class="alert-heading"><i class="bi bi-exclamation-triangle me-2"></i>Chargement des flux</h4>' +
      '<p>' +
      escapeHtml(msg) +
      '</p>' +
      '<p class="mb-0 small">Astuce : ouvrez le site via un serveur local ou GitHub Pages (les appels API peuvent être bloqués en <code>file://</code>). Vous pouvez aussi réessayer plus tard (limite de l’API rss2json).</p>' +
      '</div>';
  }

  function bindFilters() {
    var filterButtons = document.querySelectorAll('.filter-btn');
    var getArticles = function () {
      return document.querySelectorAll('#rss-articles-container .veille-article');
    };
    filterButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        filterButtons.forEach(function (btn) {
          btn.classList.remove('active');
        });
        button.classList.add('active');
        var filter = button.getAttribute('data-filter');
        getArticles().forEach(function (article) {
          if (filter === 'all' || article.getAttribute('data-category') === filter) {
            article.style.display = 'block';
            article.style.opacity = '1';
            article.style.transform = 'translateY(0)';
          } else {
            article.style.opacity = '0';
            article.style.transform = 'translateY(-20px)';
            setTimeout(function () {
              article.style.display = 'none';
            }, 300);
          }
        });
      });
    });
  }

  function init() {
    var container = document.getElementById('rss-articles-container');
    var statusEl = document.getElementById('rss-status');
    if (!container) return;

    if (statusEl) {
      statusEl.innerHTML =
        '<div class="d-flex align-items-center gap-2 text-muted"><span class="spinner-border spinner-border-sm" role="status"></span> Chargement des flux RSS…</div>';
    }

    Promise.allSettled(FEEDS.map(function (f) {
      return fetchFeed(f);
    }))
      .then(function (results) {
        var arrays = [];
        var failed = 0;
        results.forEach(function (res) {
          if (res.status === 'fulfilled' && res.value && res.value.length) {
            arrays.push(res.value);
          } else {
            failed += 1;
          }
        });
        var merged = mergeAndDedupe(arrays);
        if (merged.length === 0) {
          showError(container, 'Aucun article reçu des flux.');
          if (statusEl) statusEl.textContent = '';
          return;
        }
        renderArticles(container, merged);
        if (statusEl) {
          var extra = failed ? ' · ' + failed + ' flux indisponible(s)' : '';
          statusEl.innerHTML =
            '<span class="text-success"><i class="bi bi-check-circle me-1"></i>' +
            merged.length +
            ' articles agrégés · Résumés extraits des descriptions des flux' +
            extra +
            '</span>';
        }
        bindFilters();
      })
      .catch(function (e) {
        console.error(e);
        showError(
          container,
          'Impossible de récupérer les flux RSS pour le moment. ' + (e.message || '')
        );
        if (statusEl) statusEl.textContent = '';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

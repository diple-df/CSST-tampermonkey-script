// ==UserScript==
// @name         DuckDuckGo Tab Customizer
// @namespace    https://github.com/ddg-customizer
// @version      1.2.0
// @description  Скрывай, перенаправляй и добавляй кнопки поиска DuckDuckGo. Поддержка {query} для подстановки запроса.
// @author       Custom
// @match        https://duckduckgo.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── КОНФИГУРАЦИЯ ПО УМОЛЧАНИЮ ────────────────────────────────────────────

    const DEFAULT_CONFIG = {
        tabs: {
            web:      { hidden: false, label: 'Веб',         redirectUrl: null },
            images:   { hidden: false, label: 'Изображения', redirectUrl: null },
            videos:   { hidden: false, label: 'Видео',       redirectUrl: null },
            maps:     { hidden: false, label: 'Карты',       redirectUrl: null },
            news:     { hidden: false, label: 'Новости',     redirectUrl: null },
            shopping: { hidden: false, label: 'Товары',      redirectUrl: null },
        },
        customTabs: [],
    };

    const PRESETS = {
        images: [
            { name: 'Google Картинки',  url: 'https://www.google.com/search?q={query}&tbm=isch' },
            { name: 'Яндекс Картинки', url: 'https://yandex.ru/images/search?text={query}' },
            { name: 'Bing Картинки',    url: 'https://www.bing.com/images/search?q={query}' },
            { name: 'Pinterest',        url: 'https://www.pinterest.com/search/pins/?q={query}' },
        ],
        maps: [
            { name: 'Google Карты',  url: 'https://www.google.com/maps/search/{query}' },
            { name: 'Яндекс Карты', url: 'https://yandex.ru/maps/?text={query}' },
            { name: '2GIS',          url: 'https://2gis.ru/search/{query}' },
            { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query={query}' },
        ],
        videos: [
            { name: 'YouTube',       url: 'https://www.youtube.com/results?search_query={query}' },
            { name: 'Rutube',        url: 'https://rutube.ru/search/?query={query}' },
            { name: 'Яндекс Видео', url: 'https://yandex.ru/video/search?text={query}' },
            { name: 'Vimeo',         url: 'https://vimeo.com/search?q={query}' },
            { name: 'Dailymotion',   url: 'https://www.dailymotion.com/search/{query}' },
        ],
        shopping: [
            { name: 'Яндекс Маркет', url: 'https://market.yandex.ru/search?text={query}' },
            { name: 'Wildberries',   url: 'https://www.wildberries.ru/catalog/0/search.aspx?search={query}' },
            { name: 'Ozon',          url: 'https://www.ozon.ru/search/?text={query}' },
            { name: 'AliExpress RU', url: 'https://aliexpress.ru/wholesale?SearchText={query}' },
            { name: 'Google Shopping', url: 'https://www.google.com/search?q={query}&tbm=shop' },
        ],
        news: [
            { name: 'Google Новости', url: 'https://news.google.com/search?q={query}&hl=ru' },
            { name: 'Яндекс Новости', url: 'https://yandex.ru/news/search?text={query}' },
            { name: 'Bing News',      url: 'https://www.bing.com/news/search?q={query}' },
        ],
    };

    // ─── ХРАНИЛИЩЕ НАСТРОЕК ───────────────────────────────────────────────────

    function loadConfig() {
        try {
            const raw = GM_getValue('ddg_tab_cfg', null);
            if (!raw) return deepClone(DEFAULT_CONFIG);
            const parsed = JSON.parse(raw);
            if (!parsed.customTabs) parsed.customTabs = [];
            Object.keys(DEFAULT_CONFIG.tabs).forEach(k => {
                if (!parsed.tabs[k]) parsed.tabs[k] = deepClone(DEFAULT_CONFIG.tabs[k]);
            });
            return parsed;
        } catch (e) {
            return deepClone(DEFAULT_CONFIG);
        }
    }

    function saveConfig(cfg) { GM_setValue('ddg_tab_cfg', JSON.stringify(cfg)); }
    function deepClone(obj)  { return JSON.parse(JSON.stringify(obj)); }

    // ─── ОПРЕДЕЛЕНИЕ ТЁМНОЙ ТЕМЫ ──────────────────────────────────────────────

    function isDarkTheme() {
        // DDG выставляет data-theme на <html>
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'dark')  return true;
        if (theme === 'light') return false;

        // Запасной вариант: яркость фона страницы
        const bg = getComputedStyle(document.body).backgroundColor;
        const m  = bg.match(/\d+/g);
        if (m && m.length >= 3) {
            const lum = (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000;
            return lum < 100;
        }
        return false;
    }

    // ─── ОПРЕДЕЛЕНИЕ ТИПА ВКЛАДКИ ПО HREF ────────────────────────────────────

    function identifyTab(href) {
        if (!href) return null;
        try {
            const url  = new URL(href, 'https://duckduckgo.com');
            const p    = url.searchParams;
            const ia   = p.get('ia');
            const iax  = p.get('iax');
            const iaxm = p.get('iaxm');
            if (iaxm === 'maps' || ia === 'maps')       return 'maps';
            if (iax === 'images' || ia === 'images')    return 'images';
            if (iax === 'videos' || ia === 'videos')    return 'videos';
            if (ia === 'news')                          return 'news';
            if (ia === 'shopping')                      return 'shopping';
            if (ia === 'web')                           return 'web';
            if (p.has('q') && !ia && !iax && !iaxm)    return 'web';
        } catch (_) {}
        return null;
    }

    function getQuery() {
        return new URLSearchParams(window.location.search).get('q') || '';
    }

    // ─── ПОИСК БЛОКА НАВИГАЦИИ ────────────────────────────────────────────────

    function findNavLinks() {
        return [...document.querySelectorAll('a[href]')].filter(a => {
            const h = a.getAttribute('href') || '';
            return h.includes('q=') && (h.includes('ia=') || h.includes('iax=') || h.includes('iaxm='));
        });
    }

    function findNavContainer(navLinks) {
        if (!navLinks.length) return null;
        let parent = navLinks[0].parentElement;
        for (let depth = 0; depth < 6 && parent; depth++) {
            if (parent.querySelectorAll('a[href*="ia="]').length >= 2) return parent;
            parent = parent.parentElement;
        }
        return navLinks[0].parentElement;
    }

    // Ищем кнопку/ссылку duck.ai по всей странице
    function findDuckAiElement() {
        for (const el of document.querySelectorAll('a[href], button')) {
            const href = (el.getAttribute('href') || '').toLowerCase();
            const text = el.textContent.trim().toLowerCase();
            if (
                href.includes('duck.ai') ||
                href.includes('/chat') ||
                href.includes('ia=chat') ||
                text.includes('duck.ai') ||
                text === 'ai chat'
            ) return el;
        }
        return null;
    }

    // ─── ПРИМЕНЕНИЕ КОНФИГУРАЦИИ ──────────────────────────────────────────────

    let isApplying = false;

    function applyConfig() {
        if (isApplying) return;
        isApplying = true;
        try { _applyConfig(); } finally { isApplying = false; }
    }

    function _applyConfig() {
        const cfg   = loadConfig();
        const links = findNavLinks();
        if (!links.length) return;

        const seen = new Set();

        links.forEach(link => {
            const key = identifyTab(link.getAttribute('href'));
            if (!key || seen.has(key)) return;
            seen.add(key);

            const tabCfg = cfg.tabs[key];
            if (!tabCfg) return;

            if (tabCfg.hidden) {
                link.style.setProperty('display', 'none', 'important');
                // Скрываем wrapper-элемент, если он содержит только эту одну ссылку,
                // иначе он продолжает занимать место в flex-контейнере
                const p = link.parentElement;
                if (p && p !== document.body && p !== document.documentElement) {
                    const navSiblings = [...p.children].filter(c =>
                        c.tagName === 'A' && (c.getAttribute('href') || '').includes('q=')
                    );
                    if (navSiblings.length <= 1) {
                        p.style.setProperty('display', 'none', 'important');
                        p.setAttribute('data-ddg-wr-hidden', '1');
                    }
                }
                return;
            }
            link.style.removeProperty('display');
            // Восстанавливаем wrapper, если прятали его
            const wp = link.parentElement;
            if (wp && wp.getAttribute('data-ddg-wr-hidden')) {
                wp.style.removeProperty('display');
                wp.removeAttribute('data-ddg-wr-hidden');
            }

            const defaultLabel = DEFAULT_CONFIG.tabs[key]?.label || key;
            if (tabCfg.label && tabCfg.label !== defaultLabel) {
                setLinkText(link, tabCfg.label);
            }

            if (tabCfg.redirectUrl && link.getAttribute('data-ddg-redirect') !== tabCfg.redirectUrl) {
                const clone = link.cloneNode(true);
                clone.setAttribute('data-ddg-redirect', tabCfg.redirectUrl);

                const q = getQuery();
                const resolvedUrl = tabCfg.redirectUrl.replace(/\{query\}/g, encodeURIComponent(q));
                clone.href = resolvedUrl;

                clone.addEventListener('click', function (e) {
                    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        window.location.href = resolvedUrl;
                    }
                }, true);

                link.parentNode.replaceChild(clone, link);
            }
        });

        const container = findNavContainer(findNavLinks());
        renderCustomTabs(cfg, container);
        renderGearButton(container);
    }

    function setLinkText(link, text) {
        const inner = link.querySelector('span') || link.querySelector('div');
        if (inner) {
            inner.textContent = text;
        } else {
            const node = [...link.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
            if (node) node.textContent = text;
        }
    }

    function renderCustomTabs(cfg, container) {
        if (!container) return;
        container.querySelectorAll('[data-ddg-custom]').forEach(el => el.remove());
        if (!cfg.customTabs?.length) return;

        const ref = container.querySelector('a[href*="ia="]');
        if (!ref) return;

        cfg.customTabs.forEach(tab => {
            const a = document.createElement('a');
            a.className = ref.className;
            a.textContent = tab.label;
            a.setAttribute('data-ddg-custom', tab.id);
            a.style.cursor = 'pointer';

            const q = getQuery();
            const resolvedUrl = tab.url.replace(/\{query\}/g, encodeURIComponent(q));
            a.href = resolvedUrl;

            a.addEventListener('click', function (e) {
                if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    window.location.href = resolvedUrl;
                }
            }, true);

            container.appendChild(a);
        });
    }

    // ─── КНОПКА НАСТРОЕК В СТРОКЕ НАВИГАЦИИ ──────────────────────────────────

    function renderGearButton(container) {
        if (document.getElementById('ddgc-gear-btn')) return;

        const btn = document.createElement('button');
        btn.id    = 'ddgc-gear-btn';
        btn.title = 'Настроить вкладки DuckDuckGo';
        btn.innerHTML = `<span class="ddgc-ham"><span></span><span></span><span></span></span>`;
        btn.onclick = openPanel;

        // Ищем duck.ai по всему документу и вставляем левее него на том же уровне
        const duckAi = findDuckAiElement();
        if (duckAi && duckAi.parentElement) {
            duckAi.parentElement.insertBefore(btn, duckAi);
        } else if (container) {
            container.appendChild(btn);
        }
    }

    // ─── ПАНЕЛЬ НАСТРОЕК ──────────────────────────────────────────────────────

    function openPanel() {
        if (document.getElementById('ddgc-panel')) return;

        const cfg = loadConfig();

        const panel = document.createElement('div');
        panel.id = 'ddgc-panel';
        if (isDarkTheme()) panel.classList.add('ddgc-dark');
        panel.innerHTML = buildPanelHTML();
        document.body.appendChild(panel);

        renderTabRows(cfg);
        renderCustomRows(cfg);
        bindPanelEvents(cfg);
    }

    function buildPanelHTML() {
        return `
        <div class="ddgc-backdrop"></div>
        <div class="ddgc-modal">
            <div class="ddgc-head">
                <div class="ddgc-head-inner">
                    <span class="ddgc-head-icon"><span></span><span></span><span></span></span>
                    <span class="ddgc-title">Tab Customizer</span>
                </div>
                <button class="ddgc-close" id="ddgc-close">✕</button>
            </div>
            <div class="ddgc-body">
                <div class="ddgc-section-title">Стандартные вкладки DDG</div>
                <div id="ddgc-tab-rows"></div>
                <div class="ddgc-section-title" style="margin-top:20px">
                    Кастомные кнопки
                    <span class="ddgc-hint">· {query} подставляет запрос</span>
                </div>
                <div id="ddgc-custom-rows"></div>
                <button class="ddgc-btn ddgc-btn-add" id="ddgc-add-custom">+ Добавить кнопку</button>
            </div>
            <div class="ddgc-foot">
                <button class="ddgc-btn ddgc-btn-reset" id="ddgc-reset">Сбросить</button>
                <button class="ddgc-btn" id="ddgc-cancel">Отмена</button>
                <button class="ddgc-btn ddgc-btn-save" id="ddgc-save">Сохранить</button>
            </div>
        </div>`;
    }

    function renderTabRows(cfg) {
        const container = document.getElementById('ddgc-tab-rows');
        container.innerHTML = '';

        Object.entries(cfg.tabs).forEach(([key, tab]) => {
            const presets   = PRESETS[key] || [];
            const presetsEl = presets.length ? `
                <div class="ddgc-field">
                    <label>Быстрый выбор сервиса</label>
                    <select class="ddgc-preset" data-key="${key}">
                        <option value="">— предустановка —</option>
                        ${presets.map(p => `<option value="${escHtml(p.url)}">${escHtml(p.name)}</option>`).join('')}
                        <option value="__default__">↩ Оригинальная вкладка DDG</option>
                    </select>
                </div>` : '';

            const row = document.createElement('div');
            row.className = 'ddgc-tab-row';
            row.innerHTML = `
                <div class="ddgc-tab-header">
                    <span class="ddgc-tab-name">${escHtml(key)}</span>
                    <label class="ddgc-hide-label">
                        <input type="checkbox" class="ddgc-hide-cb" data-key="${key}" ${tab.hidden ? 'checked' : ''}>
                        Скрыть
                    </label>
                </div>
                <div class="ddgc-tab-fields">
                    <div class="ddgc-field">
                        <label>Подпись кнопки</label>
                        <input type="text" class="ddgc-label-inp" data-key="${key}" value="${escHtml(tab.label || '')}" placeholder="Название">
                    </div>
                    ${presetsEl}
                    <div class="ddgc-field">
                        <label>URL редиректа <span class="ddgc-hint">· пусто = оригинал</span></label>
                        <input type="text" class="ddgc-url-inp" data-key="${key}" value="${escHtml(tab.redirectUrl || '')}" placeholder="https://example.com/search?q={query}">
                    </div>
                </div>`;
            container.appendChild(row);
        });

        container.querySelectorAll('.ddgc-preset').forEach(sel => {
            sel.addEventListener('change', () => {
                const inp = container.querySelector(`.ddgc-url-inp[data-key="${sel.dataset.key}"]`);
                if (sel.value === '__default__') inp.value = '';
                else if (sel.value)              inp.value = sel.value;
                sel.value = '';
            });
        });
    }

    let _customCounter = 1;

    function renderCustomRows(cfg) {
        const container = document.getElementById('ddgc-custom-rows');
        container.innerHTML = '';
        (cfg.customTabs || []).forEach(t => appendCustomRow(t.label, t.url, t.id));
    }

    function appendCustomRow(label = '', url = '', id = null) {
        const container = document.getElementById('ddgc-custom-rows');
        const rowId = id || ('custom_' + Date.now() + '_' + (_customCounter++));

        const row = document.createElement('div');
        row.className = 'ddgc-custom-row';
        row.dataset.id = rowId;
        row.innerHTML = `
            <input type="text" class="ddgc-ci-label" placeholder="Название" value="${escHtml(label)}">
            <input type="text" class="ddgc-ci-url"   placeholder="https://…?q={query}" value="${escHtml(url)}">
            <button class="ddgc-btn ddgc-btn-del ddgc-del-custom" title="Удалить">✕</button>`;

        row.querySelector('.ddgc-del-custom').onclick = () => row.remove();
        container.appendChild(row);
    }

    function bindPanelEvents(cfg) {
        const panel = document.getElementById('ddgc-panel');
        const close = () => {
            panel.classList.add('ddgc-closing');
            setTimeout(() => panel.remove(), 220);
        };

        panel.querySelector('.ddgc-backdrop').onclick = close;
        document.getElementById('ddgc-close').onclick  = close;
        document.getElementById('ddgc-cancel').onclick = close;
        document.getElementById('ddgc-add-custom').onclick = () => appendCustomRow();

        document.getElementById('ddgc-save').onclick = () => {
            collectAndSave(cfg);
            close();
            applyConfig();
        };

        document.getElementById('ddgc-reset').onclick = () => {
            if (confirm('Сбросить все настройки к значениям по умолчанию?')) {
                saveConfig(deepClone(DEFAULT_CONFIG));
                close();
                applyConfig();
            }
        };
    }

    function collectAndSave(cfg) {
        document.querySelectorAll('.ddgc-tab-row').forEach(row => {
            const key = row.querySelector('.ddgc-hide-cb')?.dataset?.key;
            if (!key || !cfg.tabs[key]) return;
            cfg.tabs[key].hidden      = row.querySelector('.ddgc-hide-cb').checked;
            cfg.tabs[key].label       = row.querySelector('.ddgc-label-inp').value.trim() || DEFAULT_CONFIG.tabs[key]?.label || key;
            cfg.tabs[key].redirectUrl = row.querySelector('.ddgc-url-inp').value.trim() || null;
        });
        cfg.customTabs = [];
        document.querySelectorAll('.ddgc-custom-row').forEach(row => {
            const label = row.querySelector('.ddgc-ci-label').value.trim();
            const url   = row.querySelector('.ddgc-ci-url').value.trim();
            if (label && url) cfg.customTabs.push({ id: row.dataset.id, label, url });
        });
        saveConfig(cfg);
    }

    // ─── ВСПОМОГАТЕЛЬНЫЕ УТИЛИТЫ ──────────────────────────────────────────────

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── СТИЛИ ────────────────────────────────────────────────────────────────

    GM_addStyle(`
        /* ── Кнопка в навигационной строке ── */
        #ddgc-gear-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            border-right: 1px solid rgba(150,150,150,.2);
            cursor: pointer;
            padding: 4px 10px;
            margin-right: 2px;
            transition: background .12s;
            vertical-align: middle;
            flex-shrink: 0;
            border-radius: 0;
        }
        #ddgc-gear-btn:hover { background: rgba(222,88,51,.1); }
        .ddgc-ham { display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
        .ddgc-ham span {
            display: block; width: 16px; height: 2px;
            background: #de5833; border-radius: 2px;
        }

        /* ── Оверлей (без blur) ── */
        #ddgc-panel {
            position: fixed; inset: 0; z-index: 9999;
            font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
            font-size: 14px;
        }
        .ddgc-backdrop {
            position: absolute; inset: 0;
            background: rgba(0,0,0,.45);
        }

        /* ── Боковая панель ── */
        .ddgc-modal {
            position: absolute; right: 0; top: 0; bottom: 0;
            width: 400px; max-width: 95vw;
            background: #ffffff;
            display: flex; flex-direction: column;
            box-shadow: -4px 0 24px rgba(0,0,0,.14);
            animation: ddgc-slide-in .2s cubic-bezier(.4,0,.2,1);
        }
        #ddgc-panel.ddgc-closing .ddgc-modal {
            animation: ddgc-slide-out .18s cubic-bezier(.4,0,.2,1) forwards;
        }
        #ddgc-panel.ddgc-closing .ddgc-backdrop {
            animation: ddgc-fade-out .18s ease forwards;
        }
        @keyframes ddgc-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes ddgc-slide-out { to { transform: translateX(100%); } }
        @keyframes ddgc-fade-out  { to { opacity: 0; } }

        /* ── Шапка — в стиле DDG: белая с оранжевой чертой снизу ── */
        .ddgc-head {
            padding: 14px 16px;
            background: #fff;
            border-bottom: 2px solid #de5833;
            display: flex; align-items: center; justify-content: space-between;
            flex-shrink: 0;
        }
        .ddgc-head-inner { display: flex; align-items: center; gap: 9px; }
        .ddgc-head-icon  { display: flex; flex-direction: column; gap: 3px; }
        .ddgc-head-icon span { display: block; width: 14px; height: 2px; background: #de5833; border-radius: 2px; }
        .ddgc-title { font-size: 14px; font-weight: 600; color: #222; }
        .ddgc-close {
            background: none; border: none; font-size: 18px; line-height: 1;
            cursor: pointer; color: #767676; padding: 4px 6px;
            border-radius: 4px; transition: color .12s, background .12s;
        }
        .ddgc-close:hover { background: #f0f0f0; color: #222; }

        /* ── Тело ── */
        .ddgc-body { padding: 14px 16px; overflow-y: auto; flex: 1; background: #f8f8f8; }

        .ddgc-section-title {
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            letter-spacing: .06em; color: #888; margin-bottom: 8px;
        }
        .ddgc-hint { font-size: 11px; color: #aaa; font-weight: 400; text-transform: none; letter-spacing: 0; }

        /* ── Строка вкладки ── */
        .ddgc-tab-row {
            background: #fff; border: 1px solid #e5e5e5;
            border-radius: 8px; padding: 11px 13px; margin-bottom: 7px;
        }
        .ddgc-tab-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
        .ddgc-tab-name { font-weight: 600; font-size: 13px; text-transform: capitalize; color: #222; }
        .ddgc-hide-label {
            display: flex; align-items: center; gap: 5px;
            font-size: 12px; color: #767676; cursor: pointer; user-select: none;
        }
        .ddgc-tab-fields { display: flex; flex-direction: column; gap: 7px; }
        .ddgc-field { display: flex; flex-direction: column; gap: 3px; }
        .ddgc-field > label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: .05em; }
        .ddgc-field input[type="text"], .ddgc-field select {
            padding: 6px 9px; border: 1px solid #ddd; border-radius: 6px;
            font-size: 13px; background: #fff; outline: none; color: #222;
            transition: border-color .12s, box-shadow .12s;
        }
        .ddgc-field input[type="text"]:focus, .ddgc-field select:focus {
            border-color: #de5833; box-shadow: 0 0 0 2px rgba(222,88,51,.15);
        }

        /* ── Кастомная строка ── */
        .ddgc-custom-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
        .ddgc-custom-row input {
            flex: 1; padding: 6px 9px; border: 1px solid #ddd; border-radius: 6px;
            font-size: 13px; outline: none; background: #fff; color: #222;
            transition: border-color .12s, box-shadow .12s;
        }
        .ddgc-custom-row input:focus {
            border-color: #de5833; box-shadow: 0 0 0 2px rgba(222,88,51,.15);
        }

        /* ── Подвал ── */
        .ddgc-foot {
            padding: 11px 16px; border-top: 1px solid #e5e5e5;
            display: flex; gap: 7px; justify-content: flex-end;
            background: #fff; flex-shrink: 0;
        }

        /* ── Кнопки ── */
        .ddgc-btn {
            padding: 7px 15px; border-radius: 6px; border: 1px solid #ddd;
            font-size: 13px; font-weight: 500; cursor: pointer;
            background: #f0f0f0; color: #444;
            transition: background .12s, border-color .12s; line-height: 1;
        }
        .ddgc-btn:hover { background: #e4e4e4; border-color: #ccc; }
        .ddgc-btn-save { background: #de5833; color: #fff; border-color: #de5833; }
        .ddgc-btn-save:hover { background: #c94e2b; border-color: #c94e2b; }
        .ddgc-btn-add {
            display: block; width: 100%; margin-top: 6px;
            background: #fff; color: #de5833; border-color: #de5833;
        }
        .ddgc-btn-add:hover { background: #fff5f3; }
        .ddgc-btn-del { background: #fff; color: #c0392b; border-color: #e5b4b4; flex-shrink: 0; padding: 6px 10px; }
        .ddgc-btn-del:hover { background: #fff5f5; border-color: #c0392b; }
        .ddgc-btn-reset { background: #f0f0f0; color: #767676; border-color: #ddd; }
        .ddgc-btn-reset:hover { background: #e4e4e4; }

        /* ════════ ТЁМНАЯ ТЕМА ════════ */
        #ddgc-panel.ddgc-dark .ddgc-backdrop { background: rgba(0,0,0,.6); }

        #ddgc-panel.ddgc-dark .ddgc-modal {
            background: #1b1b1b;
            box-shadow: -4px 0 24px rgba(0,0,0,.5);
        }
        #ddgc-panel.ddgc-dark .ddgc-head {
            background: #1b1b1b;
            border-bottom-color: #de5833;
        }
        #ddgc-panel.ddgc-dark .ddgc-title { color: #f0f0f0; }
        #ddgc-panel.ddgc-dark .ddgc-close { color: #888; }
        #ddgc-panel.ddgc-dark .ddgc-close:hover { background: #2a2a2a; color: #f0f0f0; }

        #ddgc-panel.ddgc-dark .ddgc-body { background: #141414; }
        #ddgc-panel.ddgc-dark .ddgc-section-title { color: #555; }
        #ddgc-panel.ddgc-dark .ddgc-hint { color: #444; }

        #ddgc-panel.ddgc-dark .ddgc-tab-row { background: #222; border-color: #2e2e2e; }
        #ddgc-panel.ddgc-dark .ddgc-tab-name { color: #f0f0f0; }
        #ddgc-panel.ddgc-dark .ddgc-hide-label { color: #888; }
        #ddgc-panel.ddgc-dark .ddgc-field > label { color: #555; }

        #ddgc-panel.ddgc-dark .ddgc-field input[type="text"],
        #ddgc-panel.ddgc-dark .ddgc-field select {
            background: #2a2a2a; border-color: #333; color: #e8e8e8;
        }
        #ddgc-panel.ddgc-dark .ddgc-field input[type="text"]:focus,
        #ddgc-panel.ddgc-dark .ddgc-field select:focus {
            border-color: #de5833; box-shadow: 0 0 0 2px rgba(222,88,51,.2);
        }
        #ddgc-panel.ddgc-dark .ddgc-custom-row input {
            background: #2a2a2a; border-color: #333; color: #e8e8e8;
        }
        #ddgc-panel.ddgc-dark .ddgc-custom-row input:focus {
            border-color: #de5833; box-shadow: 0 0 0 2px rgba(222,88,51,.2);
        }
        #ddgc-panel.ddgc-dark .ddgc-foot { background: #1b1b1b; border-color: #2e2e2e; }

        #ddgc-panel.ddgc-dark .ddgc-btn { background: #2a2a2a; border-color: #333; color: #ccc; }
        #ddgc-panel.ddgc-dark .ddgc-btn:hover { background: #333; border-color: #444; }
        #ddgc-panel.ddgc-dark .ddgc-btn-save { background: #de5833; color: #fff; border-color: #de5833; }
        #ddgc-panel.ddgc-dark .ddgc-btn-save:hover { background: #c94e2b; border-color: #c94e2b; }
        #ddgc-panel.ddgc-dark .ddgc-btn-add { background: #222; color: #de5833; border-color: #de5833; }
        #ddgc-panel.ddgc-dark .ddgc-btn-add:hover { background: #2a1a14; }
        #ddgc-panel.ddgc-dark .ddgc-btn-del { background: #222; color: #e07070; border-color: #5a2020; }
        #ddgc-panel.ddgc-dark .ddgc-btn-del:hover { background: #2e1a1a; border-color: #9b3030; }
        #ddgc-panel.ddgc-dark .ddgc-btn-reset { background: #2a2a2a; color: #888; border-color: #333; }
        #ddgc-panel.ddgc-dark .ddgc-btn-reset:hover { background: #333; }
    `);

    // ─── ИНИЦИАЛИЗАЦИЯ И SPA-ПОДДЕРЖКА ───────────────────────────────────────

    let _applyTimer = null;
    function scheduleApply() {
        clearTimeout(_applyTimer);
        _applyTimer = setTimeout(applyConfig, 350);
    }

    const observer = new MutationObserver(muts => {
        // Не блокируем по isApplying: DDG может перерисовать nav прямо во время
        // нашего apply, и тогда кнопка настроек пропадёт без шанса восстановиться
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (
                    (node.querySelector && node.querySelector('a[href*="ia="]')) ||
                    (node.matches      && node.matches('a[href*="ia="]'))
                ) {
                    scheduleApply();
                    return;
                }
            }
        }
    });

    let _lastUrl = location.href;
    setInterval(() => {
        if (location.href !== _lastUrl) {
            _lastUrl = location.href;
            setTimeout(applyConfig, 600);
        }
    }, 600);

    function init() {
        applyConfig();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

// ==UserScript==
// @name         Custom Search System Tabs
// @namespace    https://github.com/diple-df/CSST-tampermonkey-script
// @version      1.3.2
// @description  Скрывай, переименовывай, перенаправляй и добавляй кнопки-вкладки поиска. Google, Яндекс, Bing, DuckDuckGo, Ecosia, Startpage, Brave Search и Qwant. Поддержка {query} для подстановки запроса.
// @author       diple_df x claude
// @match        *://duckduckgo.com/*
// @match        *://*.duckduckgo.com/*
// @match        *://*.bing.com/*
// @match        *://*.ecosia.org/*
// @match        *://*.startpage.com/*
// @match        *://search.brave.com/*
// @match        *://*.qwant.com/*
// @match        *://*.yandex.ru/*
// @match        *://*.yandex.com/*
// @match        *://*.yandex.by/*
// @match        *://*.yandex.kz/*
// @match        *://*.yandex.com.tr/*
// @match        *://*.ya.ru/*
// @include      /^https?:\/\/(www\.)?google\.[a-z.]+\//
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      github.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/diple-df/CSST-tampermonkey-script/main/csst_tmprmnk.user.js
// @updateURL    https://raw.githubusercontent.com/diple-df/CSST-tampermonkey-script/main/csst_tmprmnk.user.js
// ==/UserScript==

/*
 * ПРИВАТНОСТЬ.
 *
 * В хранилище (GM_setValue) попадают ТОЛЬКО:
 *   • подписи вкладок и кастомных кнопок;
 *   • URL редиректов и кастомных кнопок (шаблон с {query});
 *   • флаги: hidden у вкладки, safeMode;
 *   • порядок вкладок (order);
 *   • выбранный язык интерфейса и версия схемы конфига.
 *
 * Поисковые запросы НИКОГДА не сохраняются и никуда не отправляются:
 * {query} подставляется в момент клика/применения и живёт только в DOM.
 *
 * Сетевой запрос в скрипте ровно один и он не связан с запросами
 * пользователя: не чаще раза в сутки скрипт скачивает свой собственный
 * файл с raw.githubusercontent.com, чтобы узнать номер новой версии
 * (см. раздел «АВТООБНОВЛЕНИЕ»). Никаких веб-шрифтов, CDN и аналитики.
 */
(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════════════════════
       0. МЕЛКИЕ ХЕЛПЕРЫ
       ═══════════════════════════════════════════════════════════════════════ */

    function urlOf(a) {
        const href = a.getAttribute('href') || '';
        if (!href) return null;
        try { return new URL(href, location.origin); } catch (_) { return null; }
    }

    // Первый элемент по любому из селекторов. Никогда не бросает.
    function firstMatch(selectors) {
        if (!selectors) return null;
        for (let i = 0; i < selectors.length; i++) {
            try {
                const el = document.querySelector(selectors[i]);
                if (el) return el;
            } catch (_) {}
        }
        return null;
    }

    function qsa(sel, root) {
        try { return [...(root || document).querySelectorAll(sel)]; } catch (_) { return []; }
    }

    // Вкладка — не обязательно ссылка: у Startpage это <button role="link">
    // внутри <form>. Один общий селектор, чтобы все места согласовались.
    const TAB_SELECTOR = 'a[href], button[role="link"], [role="tab"], [data-usc-key]';

    function isTabNode(el) {
        if (!el || !el.tagName) return false;
        if (el.tagName === 'A' || el.tagName === 'BUTTON') return true;
        if (el.hasAttribute('data-usc-key')) return true;
        const role = el.getAttribute('role');
        return role === 'tab' || role === 'menuitem' || role === 'link';
    }

    function paramIs(params, rule) {
        return params.get(rule.key) === rule.value;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       1. ДВИЖКИ — ДАННЫЕ, А НЕ КОД

       Адаптер = описание: селекторы, обёртка, ссылочный класс и declarative
       kindMap. Функция остаётся только там, где нужна настоящая логика
       (нигде из текущих движков — все восемь описываются данными).
       ═══════════════════════════════════════════════════════════════════════ */

    // Компилятор declarative-классификатора. Порядок проверок повторяет
    // прежние функции движков один в один (см. историю 1.2.2).
    function compileKindMap(spec) {
        if (!spec) return function () { return null; };
        const liId     = spec.liId || null;      // [[/re/, 'kind'], ...] по id ближайшего li
        const host     = spec.host || null;      // [[/re/, 'kind'], ...] по hostname
        const prePath  = spec.prePath || null;   // проверки ДО гейта onlyPath
        const onlyPath = spec.onlyPath || null;  // ранний гейт: pathname обязан совпасть
        const path     = spec.path || null;      // [[/re/, 'kind'], ...]
        const params   = spec.params || null;    // [{key, value, kind}]
        const webWhen  = spec.webWhen || null;   // [{host?, path?, param, absent?}]

        return function classifyAnchor(a, forcedUrl) {
            if (liId) {
                const li = a.closest && a.closest('li[id]');
                if (li) {
                    const id = li.id;
                    for (let i = 0; i < liId.length; i++) {
                        if (liId[i][0].test(id)) return liId[i][1];
                    }
                    return null;
                }
            }
            const url = forcedUrl || urlOf(a);
            if (!url) return null;
            if (host) {
                for (let i = 0; i < host.length; i++) {
                    if (host[i][0].test(url.hostname)) return host[i][1];
                }
            }
            if (prePath) {
                for (let i = 0; i < prePath.length; i++) {
                    if (prePath[i][0].test(url.pathname)) return prePath[i][1];
                }
            }
            if (onlyPath) {
                let ok = false;
                for (let i = 0; i < onlyPath.length; i++) {
                    if (onlyPath[i].test(url.pathname)) { ok = true; break; }
                }
                if (!ok) return null;
            }
            if (path) {
                for (let i = 0; i < path.length; i++) {
                    if (path[i][0].test(url.pathname)) return path[i][1];
                }
            }
            const p = url.searchParams;
            if (params) {
                for (let i = 0; i < params.length; i++) {
                    if (paramIs(p, params[i])) return params[i].kind;
                }
            }
            if (webWhen) {
                for (let i = 0; i < webWhen.length; i++) {
                    const w = webWhen[i];
                    if (w.host && !w.host.test(url.hostname)) continue;
                    if (w.path && !w.path.test(url.pathname)) continue;
                    if (w.param && !p.has(w.param)) continue;
                    if (w.absent) {
                        let blocked = false;
                        for (let j = 0; j < w.absent.length; j++) {
                            if (p.has(w.absent[j])) { blocked = true; break; }
                        }
                        if (blocked) continue;
                    }
                    return 'web';
                }
            }
            return null;
        };
    }

    // Универсальные правила формы кнопки в строке вкладок (A2).
    // Значения подобраны так, чтобы кнопка не ломала высоту строки движка.
    const TRIGGER_DEFAULTS = {
        size: 26,
        radius: '6px',
        margin: '0 6px',
        valign: 'middle',
        alignSelf: 'center',
        fontSize: '13px',
    };

    const ENGINES = {
        duckduckgo: {
            name: 'DuckDuckGo',
            accent: '#de5833',
            queryParam: 'q',
            storageKey: 'usc_cfg_ddg',
            test: h => /(^|\.)duckduckgo\.com$/i.test(h),
            nav: {
                containers: [
                    '#react-duckbar nav ul',
                    '[data-testid="duckbar"] nav ul',
                    '#react-duckbar nav',
                ],
                wrap: 'li',
                linkClass: 'kFFXe30DOpq5j1hbWU1q wZ4JdaHxSAhGy1HoNVja d26Geqs1C__RaCO7MUs2',
                injectMargin: '0 10px',
                trigger: { size: 26, radius: '6px', margin: '0 8px 0 10px' },
            },
            kindMap: {
                params: [
                    { key: 'iaxm', value: 'maps', kind: 'maps' },
                    { key: 'ia',   value: 'maps', kind: 'maps' },
                    { key: 'iax',  value: 'images', kind: 'images' },
                    { key: 'ia',   value: 'images', kind: 'images' },
                    { key: 'iax',  value: 'videos', kind: 'videos' },
                    { key: 'ia',   value: 'videos', kind: 'videos' },
                    { key: 'ia',   value: 'news', kind: 'news' },
                    { key: 'ia',   value: 'shopping', kind: 'shopping' },
                    { key: 'ia',   value: 'web', kind: 'web' },
                ],
                webWhen: [{ param: 'q', absent: ['ia', 'iax', 'iaxm'] }],
            },
        },

        google: {
            name: 'Google',
            accent: '#4285f4',
            queryParam: 'q',
            storageKey: 'usc_cfg_google',
            test: h => /(^|\.)google\.[a-z.]+$/i.test(h),
            nav: {
                containers: [
                    'div.beZ0tf[role="list"]',
                    'div[role="list"][jsname="U4tNTe"]',
                    '#hdtb-sc div[role="list"]',
                ],
                wrap: 'div',
                wrapRole: 'listitem',
                linkClass: 'C6AK7c',
                trigger: { size: 28, radius: '50%', margin: '0 4px 0 10px' },
            },
            kindMap: {
                host: [[/maps\.google\./i, 'maps']],
                // /maps на www.google.com проверяется до гейта /search, иначе
                // вкладка «Карты» перестаёт опознаваться (регрессия 1.2.2).
                prePath: [[/^\/maps(\/|$)/i, 'maps']],
                onlyPath: [/^\/search/, /^\/$/],
                params: [
                    { key: 'tbm', value: 'isch', kind: 'images' },
                    { key: 'udm', value: '2',    kind: 'images' },
                    { key: 'tbm', value: 'vid',  kind: 'videos' },
                    { key: 'udm', value: '7',    kind: 'videos' },
                    { key: 'udm', value: 'vids', kind: 'videos' },
                    { key: 'udm', value: 'short_vids', kind: 'videos' },
                    { key: 'tbm', value: 'nws',  kind: 'news' },
                    { key: 'udm', value: '12',   kind: 'news' },
                    { key: 'tbm', value: 'shop', kind: 'shopping' },
                    { key: 'udm', value: '28',   kind: 'shopping' },
                    { key: 'udm', value: '14',   kind: 'web' },
                    { key: 'udm', value: '0',    kind: 'web' },
                    { key: 'udm', value: 'web',  kind: 'web' },
                ],
                // Вкладка «Все» у Google часто идёт без q в href — поэтому
                // здесь достаточно отсутствия tbm/udm (onlyPath уже отсекает
                // не-поисковые страницы).
                webWhen: [{ absent: ['tbm', 'udm'] }],
            },
        },

        bing: {
            name: 'Bing',
            accent: '#008373',
            queryParam: 'q',
            storageKey: 'usc_cfg_bing',
            test: h => /(^|\.)bing\.com$/i.test(h),
            nav: {
                containers: [
                    'nav.b_scopebar > ul',
                    '.b_scopebar > ul',
                    'nav[role="navigation"][aria-label="Search Filter"] > ul',
                ],
                wrap: 'li',
                linkClass: '',
                injectMargin: '0 8px',
                // scopebar низкий: кнопка меньше и без лишнего вертикального шума
                trigger: { size: 24, radius: '6px', margin: '0 6px', fontSize: '12px' },
            },
            kindMap: {
                liId: [
                    [/-web$/, 'web'],
                    [/-images$/, 'images'],
                    [/-video/, 'videos'],
                    [/-local$/, 'maps'],
                    [/-news$/, 'news'],
                    [/-shop/, 'shopping'],
                ],
                path: [
                    [/^\/images\/search/i, 'images'],
                    [/^\/videos\/search/i, 'videos'],
                    [/^\/maps/i, 'maps'],
                    [/^\/news\/search/i, 'news'],
                    [/^\/shop/i, 'shopping'],
                ],
                webWhen: [{ path: /^\/search/i, param: 'q' }],
            },
        },

        yandex: {
            name: 'Яндекс',
            accent: '#fc3f1d',
            queryParam: 'text',
            storageKey: 'usc_cfg_yandex',
            test: h => /(^|\.)yandex\.(ru|com|by|kz|ua|com\.tr)$/i.test(h) || /(^|\.)ya\.ru$/i.test(h),
            nav: {
                containers: [
                    'nav.HeaderNav',
                    '.HeaderNav',
                    'nav[class*="HeaderNav"]',
                ],
                wrap: null,
                linkClass: 'HeaderNav-Tab HeaderNav-Item',
                trigger: { size: 28, radius: '50%', margin: '0 6px' },
            },
            kindMap: {
                host: [[/market\.yandex\./i, 'shopping'], [/dzen\.ru$/i, 'news']],
                path: [
                    [/^\/market/, 'shopping'],
                    [/^\/images/i, 'images'],
                    [/^\/video/i, 'videos'],
                    [/^\/maps/i, 'maps'],
                    [/^\/news/i, 'news'],
                ],
                params: [{ key: 'products_mode', value: '1', kind: 'shopping' }],
                webWhen: [
                    { host: /ya\.ru$/i, param: 'source' },
                    { path: /^\/search/i, param: 'text' },
                ],
            },
        },

        ecosia: {
            name: 'Ecosia',
            accent: '#007a33',
            queryParam: 'q',
            storageKey: 'usc_cfg_ecosia',
            test: h => /(^|\.)ecosia\.org$/i.test(h),
            nav: {
                // Реальная разметка www.ecosia.org/search (Wayback, 2024-11;
                // живой запрос отдаёт Cloudflare-заглушку):
                //   <nav data-test-id="layout-navigation" aria-label="Search menu">
                //     <ul role="menubar" class="search-navigation__list">
                //       <li><div class="tab-link"><a data-test-id="tab-link" href="/images?q=…">
                // Атрибут здесь data-test-id (с дефисом), а не data-testid, и
                // значения "search-nav" у Ecosia нет.
                // Гамбургер-меню сайта (<nav data-test-id="main-nav">) идёт в
                // документе ВЫШЕ строки вкладок, поэтому общий 'nav ul' без
                // проверки формы кандидата подставлял бы кнопку в меню сайта.
                containers: [
                    'nav[data-test-id="layout-navigation"] [role="menubar"]',
                    'nav[data-test-id="layout-navigation"] ul',
                    'nav[aria-label*="Search" i] ul[role="menubar"]',
                    'nav[aria-label*="Search" i] ul',
                    'ul.search-navigation__bar-list',
                ],
                wrap: 'li',
                itemClass: 'search-navigation__item',
                linkClass: '',
                injectMargin: '0 6px',
                trigger: { size: 26, radius: '6px', margin: '0 4px' },
            },
            kindMap: {
                path: [
                    [/^\/images/i, 'images'],
                    [/^\/videos/i, 'videos'],
                    [/^\/news/i, 'news'],
                    [/^\/maps/i, 'maps'],
                ],
                params: [
                    { key: 'type', value: 'images', kind: 'images' },
                    { key: 'type', value: 'videos', kind: 'videos' },
                    { key: 'type', value: 'news',   kind: 'news' },
                    { key: 'type', value: 'maps',   kind: 'maps' },
                    { key: 'type', value: 'web',    kind: 'web' },
                ],
                webWhen: [{ param: 'q', absent: ['type'] }],
            },
        },

        startpage: {
            name: 'Startpage',
            accent: '#0d7ea8',
            queryParam: 'query',
            storageKey: 'usc_cfg_startpage',
            test: h => /(^|\.)startpage\.com$/i.test(h),
            nav: {
                // Реальная разметка www.startpage.com/sp/search (Wayback, 2025-04;
                // живой запрос отдаёт заглушку Anubis):
                //   <nav class="inline-nav" aria-label="search categories">
                //     <div class="categories"><div class="vertical-link-container">
                //       <form action="/sp/search"><input type="hidden" name="cat" value="images">
                //         <button data-testid="Images" role="link">…
                // Вкладки Startpage — это <button> внутри <form>, а не <a>:
                // внутри inline-nav нет ни одного <ul>, поэтому прежние
                // 'nav … ul' селекторы не находили ничего.
                // Целимся в сам <nav>: <div class="categories"> — grid ровно на
                // шесть колонок, седьмой элемент сжал бы вкладки.
                containers: [
                    'nav[aria-label*="search categories" i]',
                    'nav.inline-nav',
                    '.inline-nav',
                    '#main nav.inline-nav',
                ],
                wrap: null,
                linkClass: '',
                injectMargin: '0 8px',
                trigger: { size: 26, radius: '6px', margin: '0 6px' },
            },
            kindMap: {
                path: [
                    [/^\/sp\/images/i, 'images'],
                    [/^\/sp\/videos/i, 'videos'],
                    [/^\/sp\/news/i, 'news'],
                ],
                params: [
                    { key: 'cat', value: 'images', kind: 'images' },
                    { key: 'cat', value: 'videos', kind: 'videos' },
                    { key: 'cat', value: 'news',   kind: 'news' },
                    { key: 'cat', value: 'web',    kind: 'web' },
                ],
                webWhen: [{ param: 'query', absent: ['cat'] }],
            },
        },

        brave: {
            name: 'Brave',
            accent: '#fb542b',
            queryParam: 'q',
            storageKey: 'usc_cfg_brave',
            test: h => /^search\.brave\.com$/i.test(h) || /(^|\.)brave\.com$/i.test(h),
            nav: {
                // Реальная разметка search.brave.com (проверено по живому
                // HTML-ответу, не по догадке):
                //   <nav class="tabs"><ul id="primary-tabs">
                //     <li class="tab-item"><a href="/images?q=…&source=web">
                // Селекторов '#search-tabs' и '[role="tablist"]' на странице
                // нет — прежний первый селектор не совпадал никогда.
                containers: [
                    'nav.tabs > ul#primary-tabs',
                    '#primary-tabs',
                    'nav.tabs > ul',
                    'nav[class*="tabs"] > ul',
                    'nav[aria-label*="Search" i] ul',
                ],
                wrap: 'li',
                itemClass: 'tab-item',
                linkClass: '',
                injectMargin: '0 6px',
                trigger: { size: 26, radius: '6px', margin: '0 4px' },
            },
            kindMap: {
                path: [
                    [/^\/images/i, 'images'],
                    [/^\/videos/i, 'videos'],
                    [/^\/news/i, 'news'],
                    [/^\/maps/i, 'maps'],
                ],
                params: [
                    { key: 'source', value: 'images',   kind: 'images' },
                    { key: 'source', value: 'videos',   kind: 'videos' },
                    { key: 'source', value: 'news',     kind: 'news' },
                    { key: 'source', value: 'maps',     kind: 'maps' },
                    { key: 'source', value: 'shopping', kind: 'shopping' },
                    { key: 'source', value: 'web',      kind: 'web' },
                ],
                webWhen: [{ param: 'q', absent: ['source'] }],
            },
        },

        qwant: {
            name: 'Qwant',
            accent: '#4a4af4',
            queryParam: 'q',
            storageKey: 'usc_cfg_qwant',
            test: h => /(^|\.)qwant\.com$/i.test(h),
            nav: {
                // Классы у Qwant обфусцированы, зато у каждой вкладки есть
                // стабильный data-testid. Контейнер = родитель вкладки «web»,
                // а обёртка нового элемента = класс этой же вкладки.
                containers: [],
                containerFrom: 'a[data-testid="webNavItem"]',
                wrap: 'div',
                itemFromAnchor: true,
                linkClass: '',
                injectMargin: '0 6px',
                trigger: { size: 26, radius: '8px', margin: '0 6px' },
            },
            kindMap: {
                path: [
                    [/^\/images/i, 'images'],
                    [/^\/videos/i, 'videos'],
                    [/^\/news/i, 'news'],
                    [/^\/shopping/i, 'shopping'],
                ],
                params: [
                    { key: 't', value: 'images',   kind: 'images' },
                    { key: 't', value: 'videos',   kind: 'videos' },
                    { key: 't', value: 'news',     kind: 'news' },
                    { key: 't', value: 'shopping', kind: 'shopping' },
                    { key: 't', value: 'web',      kind: 'web' },
                ],
                webWhen: [{ param: 'q', absent: ['t'] }],
            },
        },
    };

    for (const k of Object.keys(ENGINES)) {
        const e = ENGINES[k];
        e.key = k;
        e.nav.trigger = Object.assign({}, TRIGGER_DEFAULTS, e.nav.trigger || {});
        e.classify = compileKindMap(e.kindMap);
    }

    const ENGINE = (() => {
        const h = location.hostname;
        for (const key of Object.keys(ENGINES)) {
            if (ENGINES[key].test(h)) return ENGINES[key];
        }
        return null;
    })();

    if (!ENGINE) return;

    /* ═══════════════════════════════════════════════════════════════════════
       2. ЛОКАЛИЗАЦИЯ

       Строки — данные. Язык определяется по странице, но пользователь может
       зафиксировать любой из списка в панели — выбор сохраняется.
       ═══════════════════════════════════════════════════════════════════════ */

    function detectLang() {
        const raw = document.documentElement.getAttribute('lang')
                 || document.documentElement.getAttribute('xml:lang')
                 || (navigator.language || navigator.userLanguage)
                 || 'en';
        return String(raw).toLowerCase().split('-')[0];
    }

    const I18N = {
        en: {
            title: 'Search tabs', engineWord: 'engine', close: 'Close',
            hide: 'Hide', show: 'Show', rename: 'Rename', redirect: 'Redirect',
            more: 'All settings', filter: 'Filter tabs', filterClear: 'Clear filter',
            tabsGroup: 'Search engine tabs', customGroup: 'My buttons',
            add: 'Add button', reset: 'Reset', resetArmed: 'Reset — sure?',
            done: 'Done', export: 'Export', import: 'Import',
            exportTitle: 'Export settings', importTitle: 'Import settings',
            apply: 'Apply', copy: 'Copy', copied: 'Copied', copiedFail: 'Copy failed',
            emptyNoTabs: 'No navigation tabs found on this page.',
            emptyNoTabsBtn: 'Show all known tabs',
            emptyFilter: 'Nothing matches the filter.',
            saved: 'Saved', statusSaved: 'Saved',
            chipHidden: 'hidden', chipRenamed: 'name', chipRedirect: 'redirect',
            safeMode: 'Safe mode (button only)', safeModeHint: 'Do not touch engine tabs at all',
            language: 'Interface language', languageAuto: 'Auto (page language)',
            hideCurrent: 'Hide this tab', showCurrent: 'Show this tab',
            openSettings: 'Customize search tabs', queryHint: '{query} = current query',
            labelField: 'Label', redirectField: 'Redirect URL',
            presetField: 'Preset service', presetPlaceholder: '— choose preset —',
            original: 'Original', namePlaceholder: 'Name',
            urlPlaceholder: 'https://…?q={query}', del: 'Delete',
            tabHiddenMsg: 'Tab hidden', tabShownMsg: 'Tab shown',
            resetDone: 'Settings reset', importOk: 'Settings imported',
            importBad: 'Bad file: expected a CSST config object',
            dragHint: 'Drag to reorder', trayLabel: 'Quick actions',
            badgeTitle: 'hidden tabs', expand: 'Expand', collapse: 'Collapse',
            tabsWord: 'tabs', hiddenWord: 'hidden', allVisible: 'all visible',
            gearTitle: 'Customize search tabs', removeButton: 'Remove CSST button',
            langChanged: 'Interface language changed', orderMoved: 'Tab moved',
            invalidUrl: 'Needs a full URL containing {query}',
            urlOk: 'Query substitution is on.',
            urlEmptyHint: 'Empty — the tab leads where it did.',
            exportHint: 'Copy this JSON somewhere safe.',
            importHint: 'Paste JSON produced by Export.',
            notJson: 'That is not JSON',
            notObject: 'Expected a JSON object',
            schemaBad: 'Rejected: unknown schema version',
            toggleHide: 'Show/Hide tab', trayHide: 'Hide current tab',
            trayShow: 'Show current tab', searchIn: 'Search tabs…',
            statusNone: 'default', removeWrap: 'Remove CSST button',
        },
        ru: {
            title: 'Вкладки поиска', engineWord: 'движок', close: 'Закрыть',
            hide: 'Скрыть', show: 'Показать', rename: 'Переименовать', redirect: 'Редирект',
            more: 'Все настройки', filter: 'Фильтр по вкладкам', filterClear: 'Очистить фильтр',
            tabsGroup: 'Вкладки поисковика', customGroup: 'Свои кнопки',
            add: 'Добавить кнопку', reset: 'Сброс', resetArmed: 'Точно сбросить?',
            done: 'Готово', export: 'Экспорт', import: 'Импорт',
            exportTitle: 'Экспорт настроек', importTitle: 'Импорт настроек',
            apply: 'Применить', copy: 'Копировать', copied: 'Скопировано', copiedFail: 'Не удалось скопировать',
            emptyNoTabs: 'Вкладки навигации на этой странице не найдены.',
            emptyNoTabsBtn: 'Показать все известные вкладки',
            emptyFilter: 'Под фильтр ничего не подходит.',
            saved: 'Сохранено', statusSaved: 'Сохранено',
            chipHidden: 'скрыта', chipRenamed: 'имя', chipRedirect: 'редирект',
            safeMode: 'Безопасный режим (только кнопка)', safeModeHint: 'Не трогать вкладки поисковика вообще',
            language: 'Язык интерфейса', languageAuto: 'Авто (язык страницы)',
            hideCurrent: 'Скрыть эту вкладку', showCurrent: 'Показать эту вкладку',
            openSettings: 'Настроить вкладки поиска', queryHint: '{query} = текущий запрос',
            labelField: 'Подпись', redirectField: 'URL редиректа',
            presetField: 'Быстрый выбор сервиса', presetPlaceholder: '— выберите пресет —',
            original: 'Оригинальная', namePlaceholder: 'Название',
            urlPlaceholder: 'https://…?q={query}', del: 'Удалить',
            tabHiddenMsg: 'Вкладка скрыта', tabShownMsg: 'Вкладка показана',
            resetDone: 'Настройки сброшены', importOk: 'Настройки импортированы',
            importBad: 'Плохой файл: ожидался объект конфига CSST',
            dragHint: 'Перетащите, чтобы изменить порядок', trayLabel: 'Быстрые действия',
            badgeTitle: 'скрытых вкладок', expand: 'Раскрыть', collapse: 'Свернуть',
            tabsWord: 'вкладок', hiddenWord: 'скрыто', allVisible: 'все видны',
            gearTitle: 'Настроить вкладки поиска', removeButton: 'Убрать кнопку CSST',
            langChanged: 'Язык интерфейса изменён', orderMoved: 'Вкладка перемещена',
            invalidUrl: 'Нужен полный URL с {query}',
            urlOk: 'Подстановка запроса включена.',
            urlEmptyHint: 'Пусто — вкладка ведёт туда же, куда вела.',
            exportHint: 'Скопируйте этот JSON в надёжное место.',
            importHint: 'Вставьте JSON, полученный при экспорте.',
            notJson: 'Это не JSON',
            notObject: 'Ожидался объект JSON',
            schemaBad: 'Отклонено: неизвестная версия схемы',
            toggleHide: 'Показать/скрыть вкладку', trayHide: 'Скрыть текущую вкладку',
            trayShow: 'Показать текущую вкладку', searchIn: 'Искать вкладку…',
            statusNone: 'по умолчанию', removeWrap: 'Убрать кнопку CSST',
        },
        uk: {
            title: 'Вкладки пошуку', close: 'Закрити', hide: 'Сховати', show: 'Показати',
            rename: 'Перейменувати', redirect: 'Перехід', more: 'Усі налаштування',
            filter: 'Фільтр вкладок', filterClear: 'Очистити фільтр',
            tabsGroup: 'Вкладки пошуковика', customGroup: 'Власні кнопки',
            add: 'Додати кнопку', reset: 'Скинути', resetArmed: 'Точно скинути?',
            done: 'Готово', apply: 'Застосувати', copy: 'Копіювати', copied: 'Скопійовано',
            emptyNoTabs: 'Вкладки навігації на цій сторінці не знайдено.',
            emptyNoTabsBtn: 'Показати всі відомі вкладки',
            emptyFilter: 'Під фільтр нічого не підходить.',
            saved: 'Збережено', chipHidden: 'схована', chipRenamed: 'назва', chipRedirect: 'перехід',
            safeMode: 'Безпечний режим (лише кнопка)', safeModeHint: 'Не чіпати вкладки пошуковика',
            language: 'Мова інтерфейсу', languageAuto: 'Авто (мова сторінки)',
            hideCurrent: 'Сховати цю вкладку', showCurrent: 'Показати цю вкладку',
            openSettings: 'Налаштувати вкладки пошуку', queryHint: '{query} = поточний запит',
            labelField: 'Підпис', redirectField: 'URL переходу',
            presetPlaceholder: '— виберіть пресет —', original: 'Оригінальна',
            namePlaceholder: 'Назва', urlPlaceholder: 'https://…?q={query}', del: 'Видалити',
            gearTitle: 'Налаштувати вкладки пошуку', trayLabel: 'Швидкі дії',
            engineWord: 'движок',
            export: 'Експорт',
            import: 'Імпорт',
            exportTitle: 'Експорт налаштувань',
            importTitle: 'Імпорт налаштувань',
            copiedFail: 'Не вдалося скопіювати',
            statusSaved: 'Збережено',
            presetField: 'Швидкий вибір сервісу',
            tabHiddenMsg: 'Вкладку сховано',
            tabShownMsg: 'Вкладку показано',
            resetDone: 'Налаштування скинуто',
            importOk: 'Налаштування імпортовано',
            importBad: 'Поганий файл: очікувався об’єкт конфігурації CSST',
            dragHint: 'Перетягніть, щоб змінити порядок',
            badgeTitle: 'схованих вкладок',
            expand: 'Розгорнути',
            collapse: 'Згорнути',
            tabsWord: 'вкладок',
            hiddenWord: 'сховано',
            allVisible: 'усі видимі',
            removeButton: 'Прибрати кнопку CSST',
            langChanged: 'Мову інтерфейсу змінено',
            orderMoved: 'Вкладку переміщено',
            invalidUrl: 'Потрібен повний URL з {query}',
            urlOk: 'Підстановку запиту увімкнено.',
            urlEmptyHint: 'Порожньо — вкладка веде туди ж, куди вела.',
            exportHint: 'Скопіюйте цей JSON у надійне місце.',
            importHint: 'Вставте JSON, отриманий під час експорту.',
            notJson: 'Це не JSON',
            notObject: 'Очікувався об’єкт JSON',
            schemaBad: 'Відхилено: невідома версія схеми',
            toggleHide: 'Показати/сховати вкладку',
            trayHide: 'Сховати поточну вкладку',
            trayShow: 'Показати поточну вкладку',
            searchIn: 'Шукати вкладку…',
            statusNone: 'за замовчуванням',
            removeWrap: 'Прибрати кнопку CSST',
        },
        de: {
            title: 'Such-Tabs', close: 'Schließen', hide: 'Ausblenden', show: 'Anzeigen',
            rename: 'Umbenennen', redirect: 'Weiterleitung', more: 'Alle Einstellungen',
            filter: 'Tabs filtern', filterClear: 'Filter löschen',
            tabsGroup: 'Tabs der Suchmaschine', customGroup: 'Eigene Buttons',
            add: 'Button hinzufügen', reset: 'Zurücksetzen', resetArmed: 'Wirklich zurücksetzen?',
            done: 'Fertig', apply: 'Anwenden', copy: 'Kopieren', copied: 'Kopiert',
            emptyNoTabs: 'Keine Navigations-Tabs auf dieser Seite gefunden.',
            emptyNoTabsBtn: 'Alle bekannten Tabs zeigen',
            emptyFilter: 'Nichts passt zum Filter.',
            saved: 'Gespeichert', chipHidden: 'aus', chipRenamed: 'Name', chipRedirect: 'redirect',
            safeMode: 'Sicherer Modus (nur Button)', safeModeHint: 'Tabs der Suchmaschine nicht anfassen',
            language: 'Sprache der Oberfläche', languageAuto: 'Auto (Seitensprache)',
            hideCurrent: 'Diesen Tab ausblenden', showCurrent: 'Diesen Tab anzeigen',
            openSettings: 'Such-Tabs anpassen', queryHint: '{query} = aktuelle Suche',
            labelField: 'Beschriftung', redirectField: 'Weiterleitungs-URL',
            presetPlaceholder: '— Vorlage wählen —', original: 'Original',
            namePlaceholder: 'Name', urlPlaceholder: 'https://…?q={query}', del: 'Löschen',
            gearTitle: 'Such-Tabs anpassen', trayLabel: 'Schnellaktionen',
            engineWord: 'Engine',
            export: 'Export',
            import: 'Import',
            exportTitle: 'Einstellungen exportieren',
            importTitle: 'Einstellungen importieren',
            copiedFail: 'Kopieren fehlgeschlagen',
            statusSaved: 'Gespeichert',
            presetField: 'Schnellauswahl Dienst',
            tabHiddenMsg: 'Tab ausgeblendet',
            tabShownMsg: 'Tab angezeigt',
            resetDone: 'Einstellungen zurückgesetzt',
            importOk: 'Einstellungen importiert',
            importBad: 'Ungültige Datei: CSST-Konfiguration erwartet',
            dragHint: 'Ziehen, um die Reihenfolge zu ändern',
            badgeTitle: 'ausgeblendete Tabs',
            expand: 'Aufklappen',
            collapse: 'Zuklappen',
            tabsWord: 'Tabs',
            hiddenWord: 'ausgeblendet',
            allVisible: 'alle sichtbar',
            removeButton: 'CSST-Schaltfläche entfernen',
            langChanged: 'Sprache geändert',
            orderMoved: 'Tab verschoben',
            invalidUrl: 'Vollständige URL mit {query} nötig',
            urlOk: 'Suchbegriff-Ersetzung aktiv.',
            urlEmptyHint: 'Leer — der Tab führt wie zuvor.',
            exportHint: 'Kopieren Sie dieses JSON an einen sicheren Ort.',
            importHint: 'Fügen Sie das exportierte JSON ein.',
            notJson: 'Das ist kein JSON',
            notObject: 'JSON-Objekt erwartet',
            schemaBad: 'Abgelehnt: unbekannte Schema-Version',
            toggleHide: 'Tab ein-/ausblenden',
            trayHide: 'Diesen Tab ausblenden',
            trayShow: 'Diesen Tab anzeigen',
            searchIn: 'Tabs suchen…',
            statusNone: 'Standard',
            removeWrap: 'CSST-Schaltfläche entfernen',
        },
        fr: {
            title: 'Onglets', close: 'Fermer', hide: 'Masquer', show: 'Afficher',
            rename: 'Renommer', redirect: 'Redirection', more: 'Tous les réglages',
            filter: 'Filtrer les onglets', filterClear: 'Effacer le filtre',
            tabsGroup: 'Onglets du moteur', customGroup: 'Mes boutons',
            add: 'Ajouter', reset: 'Réinitialiser', resetArmed: 'Confirmer ?',
            done: 'Terminé', apply: 'Appliquer', copy: 'Copier', copied: 'Copié',
            emptyNoTabs: 'Aucun onglet de navigation trouvé.',
            emptyNoTabsBtn: 'Afficher tous les onglets connus',
            emptyFilter: 'Aucun résultat pour ce filtre.',
            saved: 'Enregistré', chipHidden: 'masqué', chipRenamed: 'nom', chipRedirect: 'redir.',
            safeMode: 'Mode sûr (bouton seul)', safeModeHint: 'Ne pas toucher aux onglets du moteur',
            language: "Langue de l'interface", languageAuto: 'Auto (langue de la page)',
            hideCurrent: 'Masquer cet onglet', showCurrent: 'Afficher cet onglet',
            openSettings: 'Personnaliser les onglets', queryHint: '{query} = requête actuelle',
            labelField: 'Libellé', redirectField: 'URL de redirection',
            presetPlaceholder: '— préréglage —', original: 'Original',
            namePlaceholder: 'Nom', urlPlaceholder: 'https://…?q={query}', del: 'Supprimer',
            gearTitle: 'Personnaliser les onglets', trayLabel: 'Actions rapides',
            engineWord: 'moteur',
            export: 'Exporter',
            import: 'Importer',
            exportTitle: 'Exporter les réglages',
            importTitle: 'Importer les réglages',
            copiedFail: 'Copie impossible',
            statusSaved: 'Enregistré',
            presetField: 'Service rapide',
            tabHiddenMsg: 'Onglet masqué',
            tabShownMsg: 'Onglet affiché',
            resetDone: 'Réglages réinitialisés',
            importOk: 'Réglages importés',
            importBad: 'Fichier invalide : configuration CSST attendue',
            dragHint: 'Glissez pour réordonner',
            badgeTitle: 'onglets masqués',
            expand: 'Développer',
            collapse: 'Réduire',
            tabsWord: 'onglets',
            hiddenWord: 'masqués',
            allVisible: 'tous visibles',
            removeButton: 'Supprimer le bouton CSST',
            langChanged: 'Langue de l\'interface changée',
            orderMoved: 'Onglet déplacé',
            invalidUrl: 'URL complète avec {query} requise',
            urlOk: 'Substitution de la requête activée.',
            urlEmptyHint: 'Vide — l\'onglet mène où il menait.',
            exportHint: 'Copiez ce JSON en lieu sûr.',
            importHint: 'Collez le JSON produit par l\'export.',
            notJson: 'Ce n\'est pas du JSON',
            notObject: 'Objet JSON attendu',
            schemaBad: 'Refusé : version de schéma inconnue',
            toggleHide: 'Afficher/masquer l’onglet',
            trayHide: 'Masquer cet onglet',
            trayShow: 'Afficher cet onglet',
            searchIn: 'Rechercher un onglet…',
            statusNone: 'par défaut',
            removeWrap: 'Supprimer le bouton CSST',
        },
        es: {
            title: 'Pestañas', close: 'Cerrar', hide: 'Ocultar', show: 'Mostrar',
            rename: 'Renombrar', redirect: 'Redirección', more: 'Todos los ajustes',
            filter: 'Filtrar pestañas', filterClear: 'Borrar filtro',
            tabsGroup: 'Pestañas del buscador', customGroup: 'Mis botones',
            add: 'Añadir botón', reset: 'Restablecer', resetArmed: '¿Seguro?',
            done: 'Listo', apply: 'Aplicar', copy: 'Copiar', copied: 'Copiado',
            emptyNoTabs: 'No se encontraron pestañas de navegación.',
            emptyNoTabsBtn: 'Mostrar todas las pestañas conocidas',
            emptyFilter: 'Nada coincide con el filtro.',
            saved: 'Guardado', chipHidden: 'oculta', chipRenamed: 'nombre', chipRedirect: 'redir.',
            safeMode: 'Modo seguro (solo botón)', safeModeHint: 'No tocar las pestañas del buscador',
            language: 'Idioma de la interfaz', languageAuto: 'Auto (idioma de la página)',
            hideCurrent: 'Ocultar esta pestaña', showCurrent: 'Mostrar esta pestaña',
            openSettings: 'Personalizar pestañas', queryHint: '{query} = consulta actual',
            labelField: 'Etiqueta', redirectField: 'URL de redirección',
            presetPlaceholder: '— preajuste —', original: 'Original',
            namePlaceholder: 'Nombre', urlPlaceholder: 'https://…?q={query}', del: 'Eliminar',
            gearTitle: 'Personalizar pestañas', trayLabel: 'Acciones rápidas',
            engineWord: 'motor',
            export: 'Exportar',
            import: 'Importar',
            exportTitle: 'Exportar ajustes',
            importTitle: 'Importar ajustes',
            copiedFail: 'No se pudo copiar',
            statusSaved: 'Guardado',
            presetField: 'Servicio rápido',
            tabHiddenMsg: 'Pestaña oculta',
            tabShownMsg: 'Pestaña mostrada',
            resetDone: 'Ajustes restablecidos',
            importOk: 'Ajustes importados',
            importBad: 'Archivo inválido: se esperaba una configuración CSST',
            dragHint: 'Arrastra para reordenar',
            badgeTitle: 'pestañas ocultas',
            expand: 'Expandir',
            collapse: 'Contraer',
            tabsWord: 'pestañas',
            hiddenWord: 'ocultas',
            allVisible: 'todas visibles',
            removeButton: 'Quitar botón CSST',
            langChanged: 'Idioma de la interfaz cambiado',
            orderMoved: 'Pestaña movida',
            invalidUrl: 'Se necesita una URL completa con {query}',
            urlOk: 'Sustitución de consulta activada.',
            urlEmptyHint: 'Vacío — la pestaña lleva donde llevaba.',
            exportHint: 'Copia este JSON en un lugar seguro.',
            importHint: 'Pega el JSON generado al exportar.',
            notJson: 'Eso no es JSON',
            notObject: 'Se esperaba un objeto JSON',
            schemaBad: 'Rechazado: versión de esquema desconocida',
            toggleHide: 'Mostrar/ocultar pestaña',
            trayHide: 'Ocultar esta pestaña',
            trayShow: 'Mostrar esta pestaña',
            searchIn: 'Buscar pestaña…',
            statusNone: 'por defecto',
            removeWrap: 'Quitar botón CSST',
        },
        pt: {
            title: 'Abas', close: 'Fechar', hide: 'Ocultar', show: 'Mostrar',
            rename: 'Renomear', redirect: 'Redirecionar', more: 'Todas as opções',
            filter: 'Filtrar abas', filterClear: 'Limpar filtro',
            tabsGroup: 'Abas do buscador', customGroup: 'Meus botões',
            add: 'Adicionar botão', reset: 'Redefinir', resetArmed: 'Confirmar?',
            done: 'Pronto', apply: 'Aplicar', copy: 'Copiar', copied: 'Copiado',
            emptyNoTabs: 'Nenhuma aba de navegação encontrada.',
            emptyNoTabsBtn: 'Mostrar todas as abas conhecidas',
            emptyFilter: 'Nada corresponde ao filtro.',
            saved: 'Salvo', chipHidden: 'oculta', chipRenamed: 'nome', chipRedirect: 'redir.',
            safeMode: 'Modo seguro (só botão)', safeModeHint: 'Não mexer nas abas do buscador',
            language: 'Idioma da interface', languageAuto: 'Auto (idioma da página)',
            hideCurrent: 'Ocultar esta aba', showCurrent: 'Mostrar esta aba',
            openSettings: 'Personalizar abas', queryHint: '{query} = consulta atual',
            labelField: 'Rótulo', redirectField: 'URL de redirecionamento',
            presetPlaceholder: '— predefinição —', original: 'Original',
            namePlaceholder: 'Nome', urlPlaceholder: 'https://…?q={query}', del: 'Excluir',
            gearTitle: 'Personalizar abas', trayLabel: 'Ações rápidas',
            engineWord: 'motor',
            export: 'Exportar',
            import: 'Importar',
            exportTitle: 'Exportar configurações',
            importTitle: 'Importar configurações',
            copiedFail: 'Não foi possível copiar',
            statusSaved: 'Salvo',
            presetField: 'Serviço rápido',
            tabHiddenMsg: 'Aba oculta',
            tabShownMsg: 'Aba mostrada',
            resetDone: 'Configurações redefinidas',
            importOk: 'Configurações importadas',
            importBad: 'Arquivo inválido: esperava-se uma configuração CSST',
            dragHint: 'Arraste para reordenar',
            badgeTitle: 'abas ocultas',
            expand: 'Expandir',
            collapse: 'Recolher',
            tabsWord: 'abas',
            hiddenWord: 'ocultas',
            allVisible: 'todas visíveis',
            removeButton: 'Remover botão CSST',
            langChanged: 'Idioma da interface alterado',
            orderMoved: 'Aba movida',
            invalidUrl: 'É preciso uma URL completa com {query}',
            urlOk: 'Substituição da consulta ativa.',
            urlEmptyHint: 'Vazio — a aba leva aonde levava.',
            exportHint: 'Copie este JSON para um lugar seguro.',
            importHint: 'Cole o JSON gerado na exportação.',
            notJson: 'Isso não é JSON',
            notObject: 'Esperava-se um objeto JSON',
            schemaBad: 'Rejeitado: versão de esquema desconhecida',
            toggleHide: 'Mostrar/ocultar aba',
            trayHide: 'Ocultar esta aba',
            trayShow: 'Mostrar esta aba',
            searchIn: 'Buscar aba…',
            statusNone: 'padrão',
            removeWrap: 'Remover botão CSST',
        },
        tr: {
            title: 'Sekmeler', close: 'Kapat', hide: 'Gizle', show: 'Göster',
            rename: 'Yeniden adlandır', redirect: 'Yönlendir', more: 'Tüm ayarlar',
            filter: 'Sekmeleri filtrele', filterClear: 'Filtreyi temizle',
            tabsGroup: 'Arama motoru sekmeleri', customGroup: 'Kendi düğmelerim',
            add: 'Düğme ekle', reset: 'Sıfırla', resetArmed: 'Emin misiniz?',
            done: 'Bitti', apply: 'Uygula', copy: 'Kopyala', copied: 'Kopyalandı',
            emptyNoTabs: 'Bu sayfada gezinme sekmesi bulunamadı.',
            emptyNoTabsBtn: 'Bilinen tüm sekmeleri göster',
            emptyFilter: 'Filtreye uyan bir şey yok.',
            saved: 'Kaydedildi', chipHidden: 'gizli', chipRenamed: 'ad', chipRedirect: 'yönl.',
            safeMode: 'Güvenli mod (sadece düğme)', safeModeHint: 'Motor sekmelerine dokunma',
            language: 'Arayüz dili', languageAuto: 'Otomatik (sayfa dili)',
            hideCurrent: 'Bu sekmeyi gizle', showCurrent: 'Bu sekmeyi göster',
            openSettings: 'Sekmeleri özelleştir', queryHint: '{query} = geçerli sorgu',
            labelField: 'Etiket', redirectField: 'Yönlendirme URL',
            presetPlaceholder: '— seçin —', original: 'Orijinal',
            namePlaceholder: 'Ad', urlPlaceholder: 'https://…?q={query}', del: 'Sil',
            gearTitle: 'Sekmeleri özelleştir', trayLabel: 'Hızlı işlemler',
            engineWord: 'motor',
            export: 'Dışa aktar',
            import: 'İçe aktar',
            exportTitle: 'Ayarları dışa aktar',
            importTitle: 'Ayarları içe aktar',
            copiedFail: 'Kopyalanamadı',
            statusSaved: 'Kaydedildi',
            presetField: 'Hızlı servis',
            tabHiddenMsg: 'Sekme gizlendi',
            tabShownMsg: 'Sekme gösterildi',
            resetDone: 'Ayarlar sıfırlandı',
            importOk: 'Ayarlar içe aktarıldı',
            importBad: 'Geçersiz dosya: CSST yapılandırması bekleniyordu',
            dragHint: 'Sıralamak için sürükleyin',
            badgeTitle: 'gizli sekme',
            expand: 'Genişlet',
            collapse: 'Daralt',
            tabsWord: 'sekme',
            hiddenWord: 'gizli',
            allVisible: 'hepsi görünür',
            removeButton: 'CSST düğmesini kaldır',
            langChanged: 'Arayüz dili değiştirildi',
            orderMoved: 'Sekme taşındı',
            invalidUrl: '{query} içeren tam URL gerekli',
            urlOk: 'Sorgu yerine koyma açık.',
            urlEmptyHint: 'Boş — sekme eskisi gibi açılır.',
            exportHint: 'Bu JSON’u güvenli bir yere kopyalayın.',
            importHint: 'Dışa aktarmayla üretilen JSON’u yapıştırın.',
            notJson: 'Bu JSON değil',
            notObject: 'JSON nesnesi bekleniyordu',
            schemaBad: 'Reddedildi: bilinmeyen şema sürümü',
            toggleHide: 'Sekmeyi göster/gizle',
            trayHide: 'Bu sekmeyi gizle',
            trayShow: 'Bu sekmeyi göster',
            searchIn: 'Sekme ara…',
            statusNone: 'varsayılan',
            removeWrap: 'CSST düğmesini kaldır',
        },
        it: {
            title: 'Schede', close: 'Chiudi', hide: 'Nascondi', show: 'Mostra',
            rename: 'Rinomina', redirect: 'Reindirizza', more: 'Tutte le impostazioni',
            filter: 'Filtra schede', filterClear: 'Cancella filtro',
            tabsGroup: 'Schede del motore', customGroup: 'I miei pulsanti',
            add: 'Aggiungi pulsante', reset: 'Reimposta', resetArmed: 'Confermi?',
            done: 'Fatto', apply: 'Applica', copy: 'Copia', copied: 'Copiato',
            emptyNoTabs: 'Nessuna scheda di navigazione trovata.',
            emptyNoTabsBtn: 'Mostra tutte le schede note',
            emptyFilter: 'Nessun risultato per il filtro.',
            saved: 'Salvato', chipHidden: 'nascosta', chipRenamed: 'nome', chipRedirect: 'redir.',
            safeMode: 'Modalità sicura (solo pulsante)', safeModeHint: 'Non toccare le schede del motore',
            language: "Lingua dell'interfaccia", languageAuto: 'Auto (lingua pagina)',
            hideCurrent: 'Nascondi questa scheda', showCurrent: 'Mostra questa scheda',
            openSettings: 'Personalizza schede', queryHint: '{query} = query attuale',
            labelField: 'Etichetta', redirectField: 'URL di reindirizzamento',
            presetPlaceholder: '— preset —', original: 'Originale',
            namePlaceholder: 'Nome', urlPlaceholder: 'https://…?q={query}', del: 'Elimina',
            gearTitle: 'Personalizza schede', trayLabel: 'Azioni rapide',
            engineWord: 'motore',
            export: 'Esporta',
            import: 'Importa',
            exportTitle: 'Esporta impostazioni',
            importTitle: 'Importa impostazioni',
            copiedFail: 'Copia non riuscita',
            statusSaved: 'Salvato',
            presetField: 'Servizio rapido',
            tabHiddenMsg: 'Scheda nascosta',
            tabShownMsg: 'Scheda mostrata',
            resetDone: 'Impostazioni reimpostate',
            importOk: 'Impostazioni importate',
            importBad: 'File non valido: attesa una configurazione CSST',
            dragHint: 'Trascina per riordinare',
            badgeTitle: 'schede nascoste',
            expand: 'Espandi',
            collapse: 'Comprimi',
            tabsWord: 'schede',
            hiddenWord: 'nascoste',
            allVisible: 'tutte visibili',
            removeButton: 'Rimuovi pulsante CSST',
            langChanged: 'Lingua dell\'interfaccia cambiata',
            orderMoved: 'Scheda spostata',
            invalidUrl: 'Serve un URL completo con {query}',
            urlOk: 'Sostituzione della query attiva.',
            urlEmptyHint: 'Vuoto — la scheda porta dove portava.',
            exportHint: 'Copia questo JSON in un posto sicuro.',
            importHint: 'Incolla il JSON prodotto dall\'esportazione.',
            notJson: 'Non è JSON',
            notObject: 'Atteso un oggetto JSON',
            schemaBad: 'Rifiutato: versione schema sconosciuta',
            toggleHide: 'Mostra/nascondi scheda',
            trayHide: 'Nascondi questa scheda',
            trayShow: 'Mostra questa scheda',
            searchIn: 'Cerca scheda…',
            statusNone: 'predefinito',
            removeWrap: 'Rimuovi pulsante CSST',
        },
        pl: {
            title: 'Karty', close: 'Zamknij', hide: 'Ukryj', show: 'Pokaż',
            rename: 'Zmień nazwę', redirect: 'Przekieruj', more: 'Wszystkie ustawienia',
            filter: 'Filtruj karty', filterClear: 'Wyczyść filtr',
            tabsGroup: 'Karty wyszukiwarki', customGroup: 'Moje przyciski',
            add: 'Dodaj przycisk', reset: 'Resetuj', resetArmed: 'Na pewno?',
            done: 'Gotowe', apply: 'Zastosuj', copy: 'Kopiuj', copied: 'Skopiowano',
            emptyNoTabs: 'Nie znaleziono kart nawigacji.',
            emptyNoTabsBtn: 'Pokaż wszystkie znane karty',
            emptyFilter: 'Nic nie pasuje do filtra.',
            saved: 'Zapisano', chipHidden: 'ukryta', chipRenamed: 'nazwa', chipRedirect: 'przekier.',
            safeMode: 'Tryb bezpieczny (tylko przycisk)', safeModeHint: 'Nie ruszaj kart wyszukiwarki',
            language: 'Język interfejsu', languageAuto: 'Auto (język strony)',
            hideCurrent: 'Ukryj tę kartę', showCurrent: 'Pokaż tę kartę',
            openSettings: 'Dostosuj karty', queryHint: '{query} = bieżące zapytanie',
            labelField: 'Etykieta', redirectField: 'URL przekierowania',
            presetPlaceholder: '— wybierz —', original: 'Oryginał',
            namePlaceholder: 'Nazwa', urlPlaceholder: 'https://…?q={query}', del: 'Usuń',
            gearTitle: 'Dostosuj karty', trayLabel: 'Szybkie akcje',
            engineWord: 'silnik',
            export: 'Eksportuj',
            import: 'Importuj',
            exportTitle: 'Eksportuj ustawienia',
            importTitle: 'Importuj ustawienia',
            copiedFail: 'Nie udało się skopiować',
            statusSaved: 'Zapisano',
            presetField: 'Szybka usługa',
            tabHiddenMsg: 'Kartę ukryto',
            tabShownMsg: 'Kartę pokazano',
            resetDone: 'Ustawienia zresetowane',
            importOk: 'Ustawienia zaimportowane',
            importBad: 'Zły plik: oczekiwano konfiguracji CSST',
            dragHint: 'Przeciągnij, aby zmienić kolejność',
            badgeTitle: 'ukrytych kart',
            expand: 'Rozwiń',
            collapse: 'Zwiń',
            tabsWord: 'kart',
            hiddenWord: 'ukryto',
            allVisible: 'wszystkie widoczne',
            removeButton: 'Usuń przycisk CSST',
            langChanged: 'Zmieniono język interfejsu',
            orderMoved: 'Kartę przeniesiono',
            invalidUrl: 'Potrzebny pełny URL z {query}',
            urlOk: 'Podstawianie zapytania włączone.',
            urlEmptyHint: 'Puste — karta prowadzi tam, gdzie dotąd.',
            exportHint: 'Skopiuj ten JSON w bezpieczne miejsce.',
            importHint: 'Wklej JSON wygenerowany przy eksporcie.',
            notJson: 'To nie jest JSON',
            notObject: 'Oczekiwano obiektu JSON',
            schemaBad: 'Odrzucono: nieznana wersja schematu',
            toggleHide: 'Pokaż/ukryj kartę',
            trayHide: 'Ukryj tę kartę',
            trayShow: 'Pokaż tę kartę',
            searchIn: 'Szukaj karty…',
            statusNone: 'domyślne',
            removeWrap: 'Usuń przycisk CSST',
        },
        zh: {
            title: '搜索标签页', close: '关闭', hide: '隐藏', show: '显示',
            rename: '重命名', redirect: '跳转', more: '全部设置',
            filter: '筛选标签页', filterClear: '清除筛选',
            tabsGroup: '搜索引擎标签页', customGroup: '我的按钮',
            add: '添加按钮', reset: '重置', resetArmed: '确认重置？',
            done: '完成', apply: '应用', copy: '复制', copied: '已复制',
            emptyNoTabs: '此页面未找到导航标签页。',
            emptyNoTabsBtn: '显示所有已知标签页',
            emptyFilter: '没有匹配的标签页。',
            saved: '已保存', chipHidden: '已隐藏', chipRenamed: '名称', chipRedirect: '跳转',
            safeMode: '安全模式（仅按钮）', safeModeHint: '完全不改动搜索引擎标签页',
            language: '界面语言', languageAuto: '自动（页面语言）',
            hideCurrent: '隐藏此标签页', showCurrent: '显示此标签页',
            openSettings: '自定义搜索标签页', queryHint: '{query} = 当前查询',
            labelField: '标签', redirectField: '跳转 URL',
            presetPlaceholder: '— 选择预设 —', original: '原始',
            namePlaceholder: '名称', urlPlaceholder: 'https://…?q={query}', del: '删除',
            gearTitle: '自定义搜索标签页', trayLabel: '快捷操作',
            engineWord: '引擎',
            export: '导出',
            import: '导入',
            exportTitle: '导出设置',
            importTitle: '导入设置',
            copiedFail: '复制失败',
            statusSaved: '已保存',
            presetField: '快捷服务',
            tabHiddenMsg: '标签页已隐藏',
            tabShownMsg: '标签页已显示',
            resetDone: '设置已重置',
            importOk: '设置已导入',
            importBad: '文件无效：需要 CSST 配置对象',
            dragHint: '拖动以重新排序',
            badgeTitle: '个隐藏标签页',
            expand: '展开',
            collapse: '收起',
            tabsWord: '个标签页',
            hiddenWord: '已隐藏',
            allVisible: '全部可见',
            removeButton: '移除 CSST 按钮',
            langChanged: '界面语言已更改',
            orderMoved: '标签页已移动',
            invalidUrl: '需要包含 {query} 的完整 URL',
            urlOk: '已启用查询替换。',
            urlEmptyHint: '留空 — 标签页保持原有跳转。',
            exportHint: '将此 JSON 复制到安全的地方。',
            importHint: '粘贴导出得到的 JSON。',
            notJson: '这不是 JSON',
            notObject: '需要 JSON 对象',
            schemaBad: '已拒绝：未知的架构版本',
            toggleHide: '显示/隐藏标签页',
            trayHide: '隐藏此标签页',
            trayShow: '显示此标签页',
            searchIn: '搜索标签页…',
            statusNone: '默认',
            removeWrap: '移除 CSST 按钮',
        },
        ja: {
            title: '検索タブ', close: '閉じる', hide: '非表示', show: '表示',
            rename: '名前を変更', redirect: 'リダイレクト', more: 'すべての設定',
            filter: 'タブを絞り込む', filterClear: 'フィルター解除',
            tabsGroup: '検索エンジンのタブ', customGroup: '自分のボタン',
            add: 'ボタンを追加', reset: 'リセット', resetArmed: '本当にリセット？',
            done: '完了', apply: '適用', copy: 'コピー', copied: 'コピーしました',
            emptyNoTabs: 'このページにナビゲーションタブが見つかりません。',
            emptyNoTabsBtn: '既知のタブをすべて表示',
            emptyFilter: 'フィルターに一致しません。',
            saved: '保存しました', chipHidden: '非表示', chipRenamed: '名前', chipRedirect: '転送',
            safeMode: 'セーフモード（ボタンのみ）', safeModeHint: '検索エンジンのタブに触れない',
            language: '表示言語', languageAuto: '自動（ページの言語）',
            hideCurrent: 'このタブを隠す', showCurrent: 'このタブを表示',
            openSettings: '検索タブをカスタマイズ', queryHint: '{query} = 現在の検索語',
            labelField: 'ラベル', redirectField: 'リダイレクト URL',
            presetPlaceholder: '— プリセットを選択 —', original: '元のタブ',
            namePlaceholder: '名前', urlPlaceholder: 'https://…?q={query}', del: '削除',
            gearTitle: '検索タブをカスタマイズ', trayLabel: 'クイック操作',
            engineWord: 'エンジン',
            export: 'エクスポート',
            import: 'インポート',
            exportTitle: '設定をエクスポート',
            importTitle: '設定をインポート',
            copiedFail: 'コピーできませんでした',
            statusSaved: '保存しました',
            presetField: 'サービスを選択',
            tabHiddenMsg: 'タブを非表示にしました',
            tabShownMsg: 'タブを表示しました',
            resetDone: '設定をリセットしました',
            importOk: '設定をインポートしました',
            importBad: '無効なファイル: CSST 設定が必要です',
            dragHint: 'ドラッグして並べ替え',
            badgeTitle: '個の非表示タブ',
            expand: '展開',
            collapse: '折りたたむ',
            tabsWord: 'タブ',
            hiddenWord: '非表示',
            allVisible: 'すべて表示',
            removeButton: 'CSST ボタンを削除',
            langChanged: '表示言語を変更しました',
            orderMoved: 'タブを移動しました',
            invalidUrl: '{query} を含む完全な URL が必要です',
            urlOk: '検索語の置換が有効です。',
            urlEmptyHint: '空 — タブは元のリンク先のままです。',
            exportHint: 'この JSON を安全な場所にコピーしてください。',
            importHint: 'エクスポートした JSON を貼り付けてください。',
            notJson: 'JSON ではありません',
            notObject: 'JSON オブジェクトが必要です',
            schemaBad: '拒否: 不明なスキーマバージョン',
            toggleHide: 'タブを表示/非表示',
            trayHide: 'このタブを隠す',
            trayShow: 'このタブを表示',
            searchIn: 'タブを検索…',
            statusNone: '既定',
            removeWrap: 'CSST ボタンを削除',
        },
        ko: {
            title: '검색 탭', close: '닫기', hide: '숨기기', show: '표시',
            rename: '이름 변경', redirect: '리디렉션', more: '모든 설정',
            filter: '탭 필터', filterClear: '필터 지우기',
            tabsGroup: '검색 엔진 탭', customGroup: '내 버튼',
            add: '버튼 추가', reset: '초기화', resetArmed: '정말 초기화?',
            done: '완료', apply: '적용', copy: '복사', copied: '복사됨',
            emptyNoTabs: '이 페이지에서 탐색 탭을 찾지 못했습니다.',
            emptyNoTabsBtn: '알려진 모든 탭 표시',
            emptyFilter: '필터와 일치하는 항목이 없습니다.',
            saved: '저장됨', chipHidden: '숨김', chipRenamed: '이름', chipRedirect: '이동',
            safeMode: '안전 모드 (버튼만)', safeModeHint: '검색 엔진 탭을 건드리지 않음',
            language: '인터페이스 언어', languageAuto: '자동 (페이지 언어)',
            hideCurrent: '이 탭 숨기기', showCurrent: '이 탭 표시',
            openSettings: '검색 탭 설정', queryHint: '{query} = 현재 검색어',
            labelField: '레이블', redirectField: '리디렉션 URL',
            presetPlaceholder: '— 프리셋 선택 —', original: '원본',
            namePlaceholder: '이름', urlPlaceholder: 'https://…?q={query}', del: '삭제',
            gearTitle: '검색 탭 설정', trayLabel: '빠른 작업',
            engineWord: '엔진',
            export: '내보내기',
            import: '가져오기',
            exportTitle: '설정 내보내기',
            importTitle: '설정 가져오기',
            copiedFail: '복사하지 못했습니다',
            statusSaved: '저장됨',
            presetField: '빠른 서비스',
            tabHiddenMsg: '탭을 숨겼습니다',
            tabShownMsg: '탭을 표시했습니다',
            resetDone: '설정을 초기화했습니다',
            importOk: '설정을 가져왔습니다',
            importBad: '잘못된 파일: CSST 구성이 필요합니다',
            dragHint: '끌어서 순서 변경',
            badgeTitle: '개의 숨긴 탭',
            expand: '펼치기',
            collapse: '접기',
            tabsWord: '개 탭',
            hiddenWord: '숨김',
            allVisible: '모두 표시',
            removeButton: 'CSST 버튼 제거',
            langChanged: '인터페이스 언어를 변경했습니다',
            orderMoved: '탭을 이동했습니다',
            invalidUrl: '{query}가 포함된 전체 URL이 필요합니다',
            urlOk: '검색어 치환이 켜졌습니다.',
            urlEmptyHint: '비움 — 탭은 원래대로 이동합니다.',
            exportHint: '이 JSON을 안전한 곳에 복사하세요.',
            importHint: '내보낸 JSON을 붙여넣으세요.',
            notJson: 'JSON이 아닙니다',
            notObject: 'JSON 객체가 필요합니다',
            schemaBad: '거부됨: 알 수 없는 스키마 버전',
            toggleHide: '탭 표시/숨기기',
            trayHide: '이 탭 숨기기',
            trayShow: '이 탭 표시',
            searchIn: '탭 검색…',
            statusNone: '기본',
            removeWrap: 'CSST 버튼 제거',
        },
        hi: {
            title: 'खोज टैब', close: 'बंद करें', hide: 'छिपाएँ', show: 'दिखाएँ',
            rename: 'नाम बदलें', redirect: 'रीडायरेक्ट', more: 'सभी सेटिंग्स',
            filter: 'टैब फ़िल्टर करें', filterClear: 'फ़िल्टर हटाएँ',
            tabsGroup: 'सर्च इंजन टैब', customGroup: 'मेरे बटन',
            add: 'बटन जोड़ें', reset: 'रीसेट', resetArmed: 'पक्का रीसेट?',
            done: 'हो गया', apply: 'लागू करें', copy: 'कॉपी', copied: 'कॉपी हो गया',
            emptyNoTabs: 'इस पेज पर कोई नेविगेशन टैब नहीं मिला।',
            emptyNoTabsBtn: 'सभी ज्ञात टैब दिखाएँ',
            emptyFilter: 'फ़िल्टर से कुछ मेल नहीं खाता।',
            saved: 'सहेजा गया', chipHidden: 'छिपा', chipRenamed: 'नाम', chipRedirect: 'रीडायरेक्ट',
            safeMode: 'सेफ़ मोड (केवल बटन)', safeModeHint: 'सर्च इंजन टैब को छूना नहीं',
            language: 'इंटरफ़ेस भाषा', languageAuto: 'स्वतः (पेज भाषा)',
            hideCurrent: 'यह टैब छिपाएँ', showCurrent: 'यह टैब दिखाएँ',
            openSettings: 'खोज टैब बदलें', queryHint: '{query} = वर्तमान क्वेरी',
            labelField: 'लेबल', redirectField: 'रीडायरेक्ट URL',
            presetPlaceholder: '— प्रीसेट चुनें —', original: 'मूल',
            namePlaceholder: 'नाम', urlPlaceholder: 'https://…?q={query}', del: 'हटाएँ',
            gearTitle: 'खोज टैब बदलें', trayLabel: 'त्वरित क्रियाएँ',
            engineWord: 'इंजन',
            export: 'निर्यात',
            import: 'आयात',
            exportTitle: 'सेटिंग्स निर्यात करें',
            importTitle: 'सेटिंग्स आयात करें',
            copiedFail: 'कॉपी नहीं हो सका',
            statusSaved: 'सहेजा गया',
            presetField: 'त्वरित सेवा',
            tabHiddenMsg: 'टैब छिपाया गया',
            tabShownMsg: 'टैब दिखाया गया',
            resetDone: 'सेटिंग्स रीसेट हो गईं',
            importOk: 'सेटिंग्स आयात हो गईं',
            importBad: 'गलत फ़ाइल: CSST कॉन्फ़िग चाहिए',
            dragHint: 'क्रम बदलने के लिए खींचें',
            badgeTitle: 'छिपे टैब',
            expand: 'खोलें',
            collapse: 'समेटें',
            tabsWord: 'टैब',
            hiddenWord: 'छिपे',
            allVisible: 'सभी दिख रहे',
            removeButton: 'CSST बटन हटाएँ',
            langChanged: 'इंटरफ़ेस भाषा बदली',
            orderMoved: 'टैब खिसका',
            invalidUrl: '{query} के साथ पूरा URL चाहिए',
            urlOk: 'क्वेरी प्रतिस्थापन चालू है।',
            urlEmptyHint: 'खाली — टैब पहले जैसे ही जाएगा।',
            exportHint: 'इस JSON को सुरक्षित जगह कॉपी करें।',
            importHint: 'निर्यात किया गया JSON पेस्ट करें।',
            notJson: 'यह JSON नहीं है',
            notObject: 'JSON ऑब्जेक्ट चाहिए',
            schemaBad: 'अस्वीकृत: अज्ञात स्कीमा संस्करण',
            toggleHide: 'टैब दिखाएँ/छिपाएँ',
            trayHide: 'यह टैब छिपाएँ',
            trayShow: 'यह टैब दिखाएँ',
            searchIn: 'टैब खोजें…',
            statusNone: 'डिफ़ॉल्ट',
            removeWrap: 'CSST बटन हटाएँ',
        },
        ar: {
            title: 'تبويبات البحث', close: 'إغلاق', hide: 'إخفاء', show: 'إظهار',
            rename: 'إعادة تسمية', redirect: 'تحويل', more: 'كل الإعدادات',
            filter: 'تصفية التبويبات', filterClear: 'مسح التصفية',
            tabsGroup: 'تبويبات محرك البحث', customGroup: 'أزراري',
            add: 'إضافة زر', reset: 'إعادة تعيين', resetArmed: 'تأكيد؟',
            done: 'تم', apply: 'تطبيق', copy: 'نسخ', copied: 'تم النسخ',
            emptyNoTabs: 'لم يتم العثور على تبويبات تنقل في هذه الصفحة.',
            emptyNoTabsBtn: 'إظهار كل التبويبات المعروفة',
            emptyFilter: 'لا شيء يطابق التصفية.',
            saved: 'تم الحفظ', chipHidden: 'مخفي', chipRenamed: 'اسم', chipRedirect: 'تحويل',
            safeMode: 'الوضع الآمن (الزر فقط)', safeModeHint: 'عدم المساس بتبويبات المحرك',
            language: 'لغة الواجهة', languageAuto: 'تلقائي (لغة الصفحة)',
            hideCurrent: 'إخفاء هذا التبويب', showCurrent: 'إظهار هذا التبويب',
            openSettings: 'تخصيص تبويبات البحث', queryHint: '{query} = الاستعلام الحالي',
            labelField: 'التسمية', redirectField: 'رابط التحويل',
            presetPlaceholder: '— اختر إعدادًا —', original: 'الأصلي',
            namePlaceholder: 'الاسم', urlPlaceholder: 'https://…?q={query}', del: 'حذف',
            gearTitle: 'تخصيص تبويبات البحث', trayLabel: 'إجراءات سريعة',
            engineWord: 'محرك',
            export: 'تصدير',
            import: 'استيراد',
            exportTitle: 'تصدير الإعدادات',
            importTitle: 'استيراد الإعدادات',
            copiedFail: 'تعذّر النسخ',
            statusSaved: 'تم الحفظ',
            presetField: 'خدمة سريعة',
            tabHiddenMsg: 'تم إخفاء التبويب',
            tabShownMsg: 'تم إظهار التبويب',
            resetDone: 'تمت إعادة تعيين الإعدادات',
            importOk: 'تم استيراد الإعدادات',
            importBad: 'ملف غير صالح: مطلوب إعداد CSST',
            dragHint: 'اسحب لإعادة الترتيب',
            badgeTitle: 'تبويبات مخفية',
            expand: 'توسيع',
            collapse: 'طي',
            tabsWord: 'تبويبات',
            hiddenWord: 'مخفية',
            allVisible: 'الكل مرئي',
            removeButton: 'إزالة زر CSST',
            langChanged: 'تم تغيير لغة الواجهة',
            orderMoved: 'تم نقل التبويب',
            invalidUrl: 'مطلوب رابط كامل يحتوي على {query}',
            urlOk: 'استبدال الاستعلام مُفعَّل.',
            urlEmptyHint: 'فارغ — يبقى التبويب كما كان.',
            exportHint: 'انسخ هذا الـ JSON إلى مكان آمن.',
            importHint: 'ألصق الـ JSON الناتج عن التصدير.',
            notJson: 'هذا ليس JSON',
            notObject: 'كان متوقعًا كائن JSON',
            schemaBad: 'مرفوض: إصدار مخطط غير معروف',
            toggleHide: 'إظهار/إخفاء التبويب',
            trayHide: 'إخفاء هذا التبويب',
            trayShow: 'إظهار هذا التبويب',
            searchIn: 'ابحث عن تبويب…',
            statusNone: 'افتراضي',
            removeWrap: 'إزالة زر CSST',
        },
    };

    // Названия вкладок поисковика — отдельные данные, чтобы canonicalLabel()
    // не зависел от наличия ключа tabs в словаре интерфейса.
    const TAB_NAMES = {
        en: { web:'Web', images:'Images', videos:'Videos', maps:'Maps', news:'News', shopping:'Shopping' },
        ru: { web:'Веб', images:'Изображения', videos:'Видео', maps:'Карты', news:'Новости', shopping:'Товары' },
        uk: { web:'Веб', images:'Зображення', videos:'Відео', maps:'Карти', news:'Новини', shopping:'Покупки' },
        de: { web:'Web', images:'Bilder', videos:'Videos', maps:'Karten', news:'News', shopping:'Shopping' },
        fr: { web:'Web', images:'Images', videos:'Vidéos', maps:'Cartes', news:'Actualités', shopping:'Shopping' },
        es: { web:'Web', images:'Imágenes', videos:'Vídeos', maps:'Mapas', news:'Noticias', shopping:'Compras' },
        pt: { web:'Web', images:'Imagens', videos:'Vídeos', maps:'Mapas', news:'Notícias', shopping:'Compras' },
        tr: { web:'Web', images:'Görseller', videos:'Videolar', maps:'Haritalar', news:'Haberler', shopping:'Alışveriş' },
        it: { web:'Web', images:'Immagini', videos:'Video', maps:'Mappe', news:'Notizie', shopping:'Shopping' },
        pl: { web:'Sieć', images:'Grafika', videos:'Wideo', maps:'Mapy', news:'Wiadomości', shopping:'Zakupy' },
        zh: { web:'网页', images:'图片', videos:'视频', maps:'地图', news:'新闻', shopping:'购物' },
        ja: { web:'ウェブ', images:'画像', videos:'動画', maps:'地図', news:'ニュース', shopping:'ショッピング' },
        ko: { web:'웹', images:'이미지', videos:'동영상', maps:'지도', news:'뉴스', shopping:'쇼핑' },
        hi: { web:'वेब', images:'चित्र', videos:'वीडियो', maps:'मानचित्र', news:'समाचार', shopping:'खरीदारी' },
        ar: { web:'الويب', images:'الصور', videos:'الفيديو', maps:'الخرائط', news:'الأخبار', shopping:'التسوق' },
    };

    const RTL_LANGS = { ar: true };
    const LANG_LIST = ['auto'];
    Object.keys(I18N).forEach(k => LANG_LIST.push(k));

    let _langOverride = null;   // '' => авто
    function activeLang() {
        if (_langOverride && I18N[_langOverride]) return _langOverride;
        const auto = detectLang();
        return I18N[auto] ? auto : 'en';
    }
    function isRtl() { return !!RTL_LANGS[activeLang()]; }
    function L() { return I18N[activeLang()] || I18N.en; }
    function t(key) { const v = L()[key]; return v != null ? v : (I18N.en[key] != null ? I18N.en[key] : key); }

    /* ═══════════════════════════════════════════════════════════════════════
       3. КОНФИГ, СХЕМА И ХРАНИЛИЩЕ
       ═══════════════════════════════════════════════════════════════════════ */

    const SCHEMA_VERSION = 1;
    const UI_STORAGE_KEY = 'usc_cfg_ui';

    const TAB_KEYS = ['web', 'images', 'videos', 'maps', 'news', 'shopping'];

    function defaultConfig() {
        const tabs = {};
        TAB_KEYS.forEach(k => {
            tabs[k] = { hidden: false, label: null, redirectUrl: null };
        });
        // order пуст, пока пользователь сам не перетащил вкладку: так порядок
        // на странице остаётся родным для каждого движка.
        return { v: SCHEMA_VERSION, tabs, customTabs: [], order: [], safeMode: false };
    }

    // Подпись вкладки «по умолчанию» — из таблицы названий текущего языка.
    function canonicalLabel(key) {
        const names = TAB_NAMES[activeLang()] || TAB_NAMES.en;
        return names[key] || key;
    }

    function loadUiPrefs() {
        try {
            const raw = GM_getValue(UI_STORAGE_KEY, null);
            if (!raw) return { lang: 'auto' };
            const p = JSON.parse(raw);
            const lang = p && typeof p.lang === 'string' && (p.lang === 'auto' || I18N[p.lang]) ? p.lang : 'auto';
            return { lang };
        } catch (_) { return { lang: 'auto' }; }
    }
    function saveUiPrefs(prefs) {
        try { GM_setValue(UI_STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, lang: prefs.lang || 'auto' })); } catch (_) {}
    }

    /* Валидация конфига по явной схеме.
       Возвращает { ok, cfg, error }. Никогда не бросает. */
    function validateConfig(raw, opts) {
        const strict = !!(opts && opts.strict);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { ok: false, error: 'notObject' };
        }
        if (raw.v != null && raw.v !== SCHEMA_VERSION) {
            return { ok: false, error: 'schemaBad' };
        }
        const looksLikeCsst = raw.tabs && typeof raw.tabs === 'object'
            || Array.isArray(raw.customTabs)
            || Array.isArray(raw.order);
        if (strict && !looksLikeCsst) return { ok: false, error: 'importBad' };
        if (!looksLikeCsst) return { ok: false, error: 'notObject' };

        const out = defaultConfig();

        if (raw.tabs && typeof raw.tabs === 'object') {
            Object.keys(raw.tabs).forEach(k => {
                const src = raw.tabs[k];
                if (!src || typeof src !== 'object') return;
                const dst = out.tabs[k] || (out.tabs[k] = { hidden: false, label: null, redirectUrl: null });
                dst.hidden = src.hidden === true;
                dst.label = (typeof src.label === 'string' && src.label.trim()) ? src.label.trim().slice(0, 80) : null;
                dst.redirectUrl = (typeof src.redirectUrl === 'string' && src.redirectUrl.trim())
                    ? src.redirectUrl.trim().slice(0, 2048) : null;
            });
        }

        if (Array.isArray(raw.customTabs)) {
            let n = 0;
            raw.customTabs.forEach(ct => {
                if (!ct || typeof ct !== 'object') return;
                const label = typeof ct.label === 'string' ? ct.label.trim().slice(0, 80) : '';
                const url = typeof ct.url === 'string' ? ct.url.trim().slice(0, 2048) : '';
                if (!label || !url) return;
                out.customTabs.push({
                    id: (typeof ct.id === 'string' && /^[\w.-]{1,64}$/.test(ct.id)) ? ct.id : ('c' + (++n) + '_' + Date.now()),
                    label, url,
                });
            });
        }

        if (Array.isArray(raw.order)) {
            const seen = new Set();
            const order = [];
            raw.order.forEach(k => {
                if (typeof k !== 'string' || seen.has(k)) return;
                seen.add(k);
                order.push(k);
            });
            Object.keys(out.tabs).forEach(k => { if (!seen.has(k)) order.push(k); });
            out.order = order;
        } else {
            out.order = Object.keys(out.tabs);
        }

        out.safeMode = raw.safeMode === true;
        return { ok: true, cfg: out };
    }

    function loadConfig() {
        try {
            const raw = GM_getValue(ENGINE.storageKey, null);
            if (!raw) return defaultConfig();
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const res = validateConfig(parsed);
            if (!res.ok) return defaultConfig();
            return res.cfg;
        } catch (_) {
            return defaultConfig();
        }
    }

    function saveConfig(cfg) { try { GM_setValue(ENGINE.storageKey, JSON.stringify(cfg)); } catch (_) {} }

    const UI = loadUiPrefs();
    _langOverride = UI.lang === 'auto' ? null : UI.lang;

    /* ═══════════════════════════════════════════════════════════════════════
       4. ПРЕСЕТЫ СЕРВИСОВ
       ═══════════════════════════════════════════════════════════════════════ */

    const PRESETS_COMMON = {
        web: [
            { name: 'Google',     url: 'https://www.google.com/search?q={query}' },
            { name: 'Bing',       url: 'https://www.bing.com/search?q={query}' },
            { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
            { name: 'Startpage',  url: 'https://www.startpage.com/sp/search?query={query}' },
            { name: 'Brave',      url: 'https://search.brave.com/search?q={query}' },
            { name: 'Ecosia',     url: 'https://www.ecosia.org/search?q={query}' },
            { name: 'Qwant',      url: 'https://www.qwant.com/?q={query}' },
        ],
        images: [
            { name: 'Google',     url: 'https://www.google.com/search?q={query}&udm=2' },
            { name: 'Bing',       url: 'https://www.bing.com/images/search?q={query}' },
            { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}&iax=images&ia=images' },
            { name: 'Pinterest',  url: 'https://www.pinterest.com/search/pins/?q={query}' },
        ],
        videos: [
            { name: 'YouTube',     url: 'https://www.youtube.com/results?search_query={query}' },
            { name: 'Bing',        url: 'https://www.bing.com/videos/search?q={query}' },
            { name: 'Vimeo',       url: 'https://vimeo.com/search?q={query}' },
            { name: 'Dailymotion', url: 'https://www.dailymotion.com/search/{query}' },
        ],
        maps: [
            { name: 'Google Maps',   url: 'https://www.google.com/maps/search/{query}' },
            { name: 'Bing Maps',     url: 'https://www.bing.com/maps?q={query}' },
            { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query={query}' },
        ],
        news: [
            { name: 'Google News', url: 'https://news.google.com/search?q={query}' },
            { name: 'Bing News',   url: 'https://www.bing.com/news/search?q={query}' },
        ],
        shopping: [
            { name: 'Google Shopping', url: 'https://www.google.com/search?q={query}&tbm=shop' },
            { name: 'Amazon',          url: 'https://www.amazon.com/s?k={query}' },
            { name: 'eBay',            url: 'https://www.ebay.com/sch/i.html?_nkw={query}' },
            { name: 'AliExpress',      url: 'https://www.aliexpress.com/wholesale?SearchText={query}' },
        ],
    };

    const PRESETS_REGIONAL = {
        ru: {
            web:      [{ name:'Яндекс', url:'https://yandex.ru/search/?text={query}' }, { name:'Mail.ru', url:'https://go.mail.ru/search?q={query}' }],
            images:   [{ name:'Яндекс Картинки', url:'https://yandex.ru/images/search?text={query}' }],
            videos:   [{ name:'Rutube', url:'https://rutube.ru/search/?query={query}' }, { name:'VK Видео', url:'https://vk.com/video?q={query}' }, { name:'Яндекс Видео', url:'https://yandex.ru/video/search?text={query}' }],
            maps:     [{ name:'Яндекс Карты', url:'https://yandex.ru/maps/?text={query}' }, { name:'2GIS', url:'https://2gis.ru/search/{query}' }],
            news:     [{ name:'Яндекс Новости', url:'https://dzen.ru/news/search?text={query}' }],
            shopping: [{ name:'Wildberries', url:'https://www.wildberries.ru/catalog/0/search.aspx?search={query}' }, { name:'Ozon', url:'https://www.ozon.ru/search/?text={query}' }, { name:'Яндекс Маркет', url:'https://market.yandex.ru/search?text={query}' }, { name:'AliExpress RU', url:'https://aliexpress.ru/wholesale?SearchText={query}' }, { name:'Avito', url:'https://www.avito.ru/all?q={query}' }],
        },
        uk: {
            web:      [{ name:'Meta.ua', url:'https://search.meta.ua/?q={query}' }],
            maps:     [{ name:'Google Maps', url:'https://www.google.com/maps/search/{query}' }],
            shopping: [{ name:'Rozetka', url:'https://rozetka.com.ua/search/?text={query}' }, { name:'Prom.ua', url:'https://prom.ua/search?search_term={query}' }, { name:'OLX', url:'https://www.olx.ua/list/q-{query}/' }],
        },
        de: {
            shopping: [{ name:'Amazon.de', url:'https://www.amazon.de/s?k={query}' }, { name:'Otto', url:'https://www.otto.de/suche/{query}/' }, { name:'eBay.de', url:'https://www.ebay.de/sch/i.html?_nkw={query}' }],
        },
        fr: {
            shopping: [{ name:'Amazon.fr', url:'https://www.amazon.fr/s?k={query}' }, { name:'Cdiscount', url:'https://www.cdiscount.com/search/10/{query}.html' }],
        },
        es: {
            shopping: [{ name:'Amazon.es', url:'https://www.amazon.es/s?k={query}' }, { name:'MercadoLibre', url:'https://listado.mercadolibre.com.ar/{query}' }],
        },
        pt: {
            shopping: [{ name:'Mercado Livre', url:'https://lista.mercadolivre.com.br/{query}' }, { name:'Amazon.com.br', url:'https://www.amazon.com.br/s?k={query}' }],
        },
        tr: {
            web:      [{ name:'Yandex', url:'https://yandex.com.tr/search/?text={query}' }],
            shopping: [{ name:'Trendyol', url:'https://www.trendyol.com/sr?q={query}' }, { name:'Hepsiburada', url:'https://www.hepsiburada.com/ara?q={query}' }],
        },
        it: {
            shopping: [{ name:'Amazon.it', url:'https://www.amazon.it/s?k={query}' }, { name:'eBay.it', url:'https://www.ebay.it/sch/i.html?_nkw={query}' }],
        },
        pl: {
            shopping: [{ name:'Allegro', url:'https://allegro.pl/listing?string={query}' }, { name:'Amazon.pl', url:'https://www.amazon.pl/s?k={query}' }],
        },
        zh: {
            web:      [{ name:'百度', url:'https://www.baidu.com/s?wd={query}' }, { name:'Sogou', url:'https://www.sogou.com/web?query={query}' }],
            shopping: [{ name:'淘宝', url:'https://s.taobao.com/search?q={query}' }, { name:'京东', url:'https://search.jd.com/Search?keyword={query}' }],
        },
        ja: {
            web:      [{ name:'Yahoo! JAPAN', url:'https://search.yahoo.co.jp/search?p={query}' }],
            shopping: [{ name:'Amazon.co.jp', url:'https://www.amazon.co.jp/s?k={query}' }, { name:'楽天', url:'https://search.rakuten.co.jp/search/mall/{query}/' }],
        },
        ko: {
            web:      [{ name:'Naver', url:'https://search.naver.com/search.naver?query={query}' }, { name:'Daum', url:'https://search.daum.net/search?q={query}' }],
            shopping: [{ name:'Coupang', url:'https://www.coupang.com/np/search?q={query}' }],
        },
        hi: {
            web:      [{ name:'Google India', url:'https://www.google.co.in/search?q={query}' }],
            shopping: [{ name:'Flipkart', url:'https://www.flipkart.com/search?q={query}' }, { name:'Amazon.in', url:'https://www.amazon.in/s?k={query}' }],
        },
        ar: {
            web:      [{ name:'Google', url:'https://www.google.com/search?q={query}' }],
            shopping: [{ name:'Noon', url:'https://www.noon.com/search/?q={query}' }],
        },
    };

    function buildPresets(lang) {
        const cats = TAB_KEYS;
        const reg  = PRESETS_REGIONAL[lang] || {};
        const out  = {};
        cats.forEach(cat => {
            const seen = new Set();
            const list = [];
            [...(reg[cat] || []), ...(PRESETS_COMMON[cat] || [])].forEach(s => {
                if (seen.has(s.url)) return;
                seen.add(s.url);
                list.push(s);
            });
            out[cat] = list;
        });
        return out;
    }

    let PRESETS = buildPresets(activeLang());

    /* ═══════════════════════════════════════════════════════════════════════
       5. ТЁМНАЯ ТЕМА
       ═══════════════════════════════════════════════════════════════════════ */

    function isDarkTheme() {
        const dt = document.documentElement.getAttribute('data-theme')
                || (document.body && document.body.getAttribute('data-theme'));
        if (dt === 'dark')  return true;
        if (dt === 'light') return false;
        try {
            const bg = getComputedStyle(document.body).backgroundColor;
            const m  = bg.match(/[\d.]+/g);
            if (m && m.length >= 3 && !(m.length === 4 && parseFloat(m[3]) === 0)) {
                const lum = (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000;
                return lum < 100;
            }
        } catch (_) {}
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
        return false;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       6. ИКОНКИ — ОДИН ИСТОЧНИК ПРАВДЫ (A1)
       Все иконки: stroke="currentColor", fill="none", 16×16 viewBox,
       круглые концы, stroke-width 1.7. Работают в любой теме, т.к. цвет
       наследуется от кнопки.
       ═══════════════════════════════════════════════════════════════════════ */

    const ICONS = {
        menu:      '<path d="M3 4.5h10M3 8h7.5M3 11.5h10" stroke-linecap="round"/>',
        close:     '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke-linecap="round"/>',
        eye:       '<path d="M1.8 8S4 4.2 8 4.2 14.2 8 14.2 8 12 11.8 8 11.8 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.9"/>',
        eyeOff:    '<path d="M1.8 8S4 4.2 8 4.2c1 0 1.9.3 2.7.7M14.2 8s-2.2 3.8-6.2 3.8c-1 0-1.9-.3-2.7-.7"/><path d="M6.5 6.6a2 2 0 0 0 2.9 2.8" /><path d="M2.8 2.8l10.4 10.4" stroke-linecap="round"/>',
        tag:       '<path d="M8.6 2.2H13a.8.8 0 0 1 .8.8v4.4a1 1 0 0 1-.3.7l-5.6 5.6a1 1 0 0 1-1.4 0L2.3 9.5a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 .7-.3Z"/><circle cx="11.2" cy="4.9" r=".9"/>',
        arrowRight:'<path d="M2.8 8h9.4" stroke-linecap="round"/><path d="M9 4.8L12.3 8 9 11.2" stroke-linecap="round" stroke-linejoin="round"/>',
        trash:     '<path d="M2.8 4.4h10.4" stroke-linecap="round"/><path d="M6.2 4.4V3.2a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.2" stroke-linecap="round"/><path d="M4.4 4.4l.6 8.2a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8.2" stroke-linecap="round"/><path d="M6.8 7v3.6M9.2 7v3.6" stroke-linecap="round"/>',
        plus:      '<path d="M8 3.2v9.6M3.2 8h9.6" stroke-linecap="round"/>',
        reset:     '<path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9" stroke-linecap="round"/><path d="M2.4 2.4v3.4H5.8" stroke-linecap="round" stroke-linejoin="round"/>',
        download:  '<path d="M8 2.4v7.4" stroke-linecap="round"/><path d="M5.2 7.2L8 10l2.8-2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.4h10" stroke-linecap="round"/>',
        upload:    '<path d="M8 10.2V2.8" stroke-linecap="round"/><path d="M5.2 5.6L8 2.8l2.8 2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.4h10" stroke-linecap="round"/>',
        search:    '<circle cx="7.1" cy="7.1" r="4.3"/><path d="M10.4 10.4L13.4 13.4" stroke-linecap="round"/>',
        grip:      '<circle cx="6" cy="5" r=".85" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r=".85" fill="currentColor" stroke="none"/><circle cx="6" cy="11" r=".85" fill="currentColor" stroke="none"/><circle cx="10" cy="5" r=".85" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".85" fill="currentColor" stroke="none"/><circle cx="10" cy="11" r=".85" fill="currentColor" stroke="none"/>',
        chevron:   '<path d="M4.4 6.4L8 10l3.6-3.6" stroke-linecap="round" stroke-linejoin="round"/>',
        chevronUp: '<path d="M4.4 9.6L8 6l3.6 3.6" stroke-linecap="round" stroke-linejoin="round"/>',
        chevronLeft:'<path d="M9.8 3.6L6.2 8l3.6 4.4" stroke-linecap="round" stroke-linejoin="round"/>',
        chevronRight:'<path d="M6.2 3.6L9.8 8l-3.6 4.4" stroke-linecap="round" stroke-linejoin="round"/>',
        check:     '<path d="M3.4 8.4l3 3 5.8-6.4" stroke-linecap="round" stroke-linejoin="round"/>',
        sliders:   '<path d="M2.6 5.4h10.8M2.6 10.6h10.8" stroke-linecap="round"/><circle cx="6" cy="5.4" r="1.7"/><circle cx="10.2" cy="10.6" r="1.7"/>',
        layout:    '<rect x="2.4" y="3" width="11.2" height="10" rx="1.6"/><path d="M2.4 6.6h11.2" stroke-linecap="round"/>',
        external:  '<path d="M9.4 2.8h3.8v3.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.2 2.8L7.6 8.4" stroke-linecap="round"/><path d="M12 9.6v3.2a.8.8 0 0 1-.8.8H3.6a.8.8 0 0 1-.8-.8V6a.8.8 0 0 1 .8-.8h3.2" stroke-linecap="round"/>',
    };

    function icon(name, size) {
        const body = ICONS[name];
        if (!body) return '';
        const s = size || 16;
        return '<svg viewBox="0 0 16 16" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" '
             + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
             + body + '</svg>';
    }

    /* ═══════════════════════════════════════════════════════════════════════
       7. ПОИСК КОНТЕЙНЕРА: КАСКАД + КЕШ + ПРОВЕРКА ФОРМЫ СТРАНИЦЫ
       ═══════════════════════════════════════════════════════════════════════ */

    let _navCache     = null;   // { el, strategy } на один проход
    let _navStrategy  = null;   // стратегия, выигравшая в этой сессии
    let _navFailures  = 0;      // подряд неудачных поисков
    let _layoutUnsupported = false;

    function getQuery() {
        try { return new URLSearchParams(window.location.search).get(ENGINE.queryParam) || ''; }
        catch (_) { return ''; }
    }

    function isOwnEl(el) {
        if (!el || !el.getAttribute) return false;
        if (el.id === 'usc-gear-btn' || el.id === 'usc-ui-host' || el.id === 'usc-tray') return true;
        return el.hasAttribute('data-usc-custom')
            || el.hasAttribute('data-usc-inject-wrap')
            || el.hasAttribute('data-usc-hook');
    }

    /* Startpage описывает вкладки как <button> внутри GET-формы
       <form action="/sp/search"> со скрытыми <input name="cat" value="images">
       и <input name="query" value="…">. Ссылки там нет вообще, поэтому
       собираем псевдо-URL из action и hidden-полей и отдаём его тому же
       declarative-классификатору — карта движка уже понимает cat/query. */
    function formUrlOf(el) {
        if (!el || el.tagName !== 'BUTTON') return null;
        const form = el.closest && el.closest('form[action]');
        if (!form) return null;
        const action = form.getAttribute('action') || '';
        if (!/search/i.test(action)) return null;
        const sp = new URLSearchParams();
        form.querySelectorAll('input[type="hidden"][name]').forEach(inp => {
            const name = inp.getAttribute('name');
            const val = inp.getAttribute('value');
            if (name && val != null) sp.set(name, val);
        });
        // Формы настроек и прочие служебные тоже несут query — отсекаем.
        const hasQuery = sp.has(ENGINE.queryParam) || sp.has('q') || sp.has('query');
        if (!hasQuery) return null;
        try { return new URL(action + '?' + sp.toString(), location.origin); }
        catch (_) { return null; }
    }

    function classifyEl(el) {
        if (!el || isOwnEl(el)) return null;
        const forced = el.getAttribute('data-usc-key');
        if (forced) return forced;
        const direct = ENGINE.classify(el);
        if (direct) return direct;
        const alt = formUrlOf(el);
        return alt ? ENGINE.classify(el, alt) : null;
    }

    function isVisible(el) {
        return !!(el && el.getClientRects && el.getClientRects().length);
    }

    function classifiedLinks(visibleOnly) {
        const out = [];
        qsa(TAB_SELECTOR).forEach(el => {
            if (!classifyEl(el)) return;
            if (visibleOnly && !isVisible(el)) return;
            out.push(el);
        });
        return out;
    }

    // Эвристика «самый густой кластер ссылок» (уже была — доведена до каскада).
    function densestFromClassified(links) {
        if (!links.length) return null;
        const keysByEl = new Map();
        links.forEach(link => {
            const key = classifyEl(link);
            if (!key) return;
            let n = link.parentElement;
            for (let d = 0; d < 8 && n && n !== document.body; d++, n = n.parentElement) {
                let s = keysByEl.get(n);
                if (!s) { s = new Set(); keysByEl.set(n, s); }
                s.add(key);
            }
        });
        let best = null, bestKeys = 1, bestSize = Infinity;
        keysByEl.forEach((keys, el) => {
            if (keys.size < 2) return;
            const size = el.getElementsByTagName('*').length;
            if (keys.size > bestKeys || (keys.size === bestKeys && size < bestSize)) {
                best = el; bestKeys = keys.size; bestSize = size;
            }
        });
        return best;
    }

    /* ── Проверка формы кандидата ──────────────────────────────────────

       Одно правило для ВСЕХ стратегий: промах не бросает исключение и не
       вешает кнопку в случайный <ul>. Кандидат обязан:

         • лежать у верхней кромки страницы (строка вкладок не в подвале и не
           в мега-меню, свёрнутом за гамбургером) и быть видимым;
         • не быть автокомплитом поисковой строки и не быть меню;
         • содержать минимум две «вкладочные» единицы своего домена.

       Именно этой проверки не хватало: движковый селектор брался по первому
       совпадению без валидации, поэтому неверный селектор молча отдавал
       чужой узел вместо того, чтобы уйти по каскаду дальше. */

    const NAV_HOST = location.hostname.replace(/^www\./, '');

    function tabText(el) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim()
                 || (el.getAttribute('aria-label') || '').trim();
        return txt.length <= 40 ? txt : '';
    }

    /* Только самые внутренние «вкладочные» узлы: <div role="tab"><a href> —
       это ОДНА вкладка, а не две. */
    function leafTabNodes(root) {
        const all = qsa(TAB_SELECTOR, root).filter(n => isTabNode(n));
        return all.filter(n => !all.some(other => other !== n && n.contains(other)));
    }

    // «Вкладочные» единицы внутри узла: ссылки ИЛИ кнопки-ссылки своего домена.
    function navLinksIn(root) {
        const out = [];
        leafTabNodes(root).forEach(node => {
            if (isOwnEl(node) || node.closest('[data-usc-inject-wrap]')) return;
            if (!tabText(node)) return;
            const u = urlOf(node) || formUrlOf(node);
            if (!u) return;
            if (u.hostname.replace(/^www\./, '') !== NAV_HOST) return;
            out.push({ node, url: u });
        });
        return out;
    }

    // Признак раздела: путь + «категория», но без самого запроса.
    function sectionOf(url) {
        const sp = url.searchParams;
        const section = sp.get('cat') || sp.get('source') || sp.get('t')
                     || sp.get('type') || sp.get('scope') || '';
        return url.pathname.replace(/\/+$/, '') + '|' + section;
    }

    function carriesQuery(url) {
        const sp = url.searchParams;
        return sp.has(ENGINE.queryParam) || sp.has('q') || sp.has('query') || sp.has('text');
    }

    function isAutocomplete(el) {
        const role = el.getAttribute('role');
        if (role === 'menu' || role === 'listbox') return true;
        if (role === 'menubar') return false;      // Ecosia: это и есть строка вкладок
        if (el.closest('[role="listbox"], datalist')) return true;
        if (el.querySelector('[role="listbox"], datalist')) return true;
        return false;
    }

    // Строка вкладок живёт у верхней кромки. Порог мягкий (половина экрана),
    // чтобы не ломать движки с высоким верхним блоком.
    function nearTop(el) {
        let r = null;
        try { r = el.getBoundingClientRect(); } catch (_) { return true; }
        if (!r) return true;
        if (!r.width && !r.height) return false;   // свёрнутое меню, подвал
        const limit = Math.max(320, (window.innerHeight || 800) * 0.5);
        return r.top < limit && r.bottom > -40;
    }

    function plausibleNav(el, need) {
        if (!el || el.nodeType !== 1) return false;
        if (isOwnEl(el) || el.closest('#usc-ui-host')) return false;
        if (isAutocomplete(el)) return false;
        if (navLinksIn(el).length < (need || 2)) return false;
        return nearTop(el);
    }

    // Первый селектор, дающий ПРАВДОПОДОБНЫЙ контейнер, а не просто узел.
    function firstValid(selectors) {
        if (!selectors) return null;
        for (let i = 0; i < selectors.length; i++) {
            let el = null;
            try { el = document.querySelector(selectors[i]); } catch (_) { continue; }
            if (el && plausibleNav(el, 2)) return { el, selector: selectors[i] };
        }
        return null;
    }

    /* Универсальный фолбэк без знания движка: узел, внутри которого несколько
       РАЗНЫХ разделов своего домена несут один и тот же поисковый запрос — это
       и есть строка вкладок. Требуем ≥2 разных признака раздела И запрос в
       каждой из них, поэтому случайный <ul> со ссылками (футер, сайдбар) не
       проходит: у его ссылок запроса нет. */
    function genericTabStrip() {
        const cands = qsa('nav, [role="navigation"], [role="tablist"], [role="menubar"], '
                        + 'header ul, ul, div[role="list"], div[role="menubar"]');
        let best = null, bestScore = 0;
        for (const el of cands) {
            if (!plausibleNav(el, 2)) continue;
            const sections = new Set();
            let withQuery = 0;
            navLinksIn(el).forEach(l => {
                sections.add(sectionOf(l.url));
                if (carriesQuery(l.url)) withQuery++;
            });
            if (sections.size < 2 || withQuery < 2) continue;
            const score = sections.size * 100 + withQuery * 10
                        - Math.min(60, el.getElementsByTagName('*').length / 6);
            if (score > bestScore) { best = el; bestScore = score; }
        }
        return best;
    }

    // Каскад стратегий. Возвращает { el, strategy, selector } или null.
    function resolveNavContainer() {
        const nav = ENGINE.nav || {};

        // 1. Движковые селекторы — но только если контейнер правдоподобен.
        const hit = firstValid(nav.containers);
        if (hit) return { el: hit.el, strategy: 'selectors', selector: hit.selector };

        // 2. Стабильный якорь (Qwant: родитель ссылки-вкладки).
        if (nav.containerFrom) {
            let anchor = null;
            try { anchor = document.querySelector(nav.containerFrom); } catch (_) {}
            const parent = anchor && anchor.parentElement;
            if (plausibleNav(parent, 2)) {
                return { el: parent, strategy: 'containerFrom', selector: nav.containerFrom };
            }
        }

        // 3. Семантика без привязки к движку: nav с говорящим aria-label,
        //    затем nav внутри header, затем любой nav.
        const sem = firstValid(['nav[aria-label*="search" i]', 'nav[aria-label*="tab" i]',
                                'header nav', 'nav']);
        if (sem) return { el: sem.el, strategy: 'semantic', selector: sem.selector };

        // 4. Самый густой кластер уже классифицированных ссылок.
        const byKeys = densestFromClassified(classifiedLinks(true))
                    || densestFromClassified(classifiedLinks(false));
        if (byKeys && plausibleNav(byKeys, 2)) return { el: byKeys, strategy: 'classified' };

        // 5. Универсальный фолбэк по форме строки вкладок. Самая рискованная
        //    стратегия: разрешена, пока формат страницы ещё похож на
        //    поддерживаемый. После трёх промахов подряд считаем вёрстку
        //    неподдерживаемой и НЕ вставляем кнопку в случайное место.
        //    Раз в 20 проходов — осторожная повторная попытка.
        if (!_layoutUnsupported || (_navFailures % 20) === 0) {
            const generic = genericTabStrip();
            if (generic) return { el: generic, strategy: 'generic', selector: null };
        }

        return null;
    }

    // Кеш на проход: applyConfig вызывает эту функцию многократно.
    let _navPass = 0;
    function beginNavPass() { _navPass++; _navCache = null; }

    /* Наблюдаемость каскада. Пишем только в память страницы: никакого DOM,
       никакой сети, ничего не сохраняется. Нужно ровно для того, чтобы
       следующий прогон не гадал, какая стратегия выиграла. */
    function describeContainer(el) {
        if (!el) return null;
        const info = { tag: el.tagName ? el.tagName.toLowerCase() : '?' };
        if (el.id) info.id = el.id;
        const cls = (el.getAttribute && el.getAttribute('class') || '').trim();
        if (cls) info.class = cls.slice(0, 120);
        try {
            const r = el.getBoundingClientRect();
            info.top = Math.round(r.top);
            info.height = Math.round(r.height);
        } catch (_) {}
        info.links = navLinksIn(el).length;
        return info;
    }

    function publishDiag(strategy, el, selector) {
        try {
            window.__csstDiag = {
                version: SCRIPT_VERSION,
                engine: ENGINE.key,
                engineName: ENGINE.name,
                strategy: strategy || 'none',
                selector: selector || null,
                container: describeContainer(el),
                tabs: el ? tabEls(el).length : 0,
                failures: _navFailures,
                at: Date.now(),
            };
        } catch (_) {}
    }

    function navContainer() {
        if (_navCache && _navCache.pass === _navPass) return _navCache.el;
        const res = resolveNavContainer();

        if (res) {
            _navStrategy = res.strategy;
            _navFailures = 0;
            _layoutUnsupported = false;
        } else {
            _navFailures++;
            if (_navFailures >= 3) _layoutUnsupported = true;
        }
        _navCache = { pass: _navPass, el: res ? res.el : null };
        publishDiag(res && res.strategy, _navCache.el, res && res.selector);
        return _navCache.el;
    }

    function navStrategyName() { return _navStrategy || 'none'; }
    function layoutUnsupported() { return _layoutUnsupported; }

    // Диагностика для меню Tampermonkey: что определено и что применено.
    function diagnosticsText() {
        const cfg = getCfg();
        const detected = detectTabs();
        const rows = detected.map(d => d.key + ' = ' + (d.label || '?'));
        const hidden = Object.keys(cfg.tabs).filter(k => cfg.tabs[k] && cfg.tabs[k].hidden);
        return [
            'CSST ' + SCRIPT_VERSION,
            'Движок: ' + ENGINE.name + ' (' + location.hostname + ')',
            'Страница: ' + location.pathname + location.search,
            'Стратегия контейнера: ' + navStrategyName()
                + (window.__csstDiag && window.__csstDiag.selector
                    ? ' ← ' + window.__csstDiag.selector : ''),
            'Вёрстка неподдерживаема: ' + (layoutUnsupported() ? 'да' : 'нет'),
            'Кнопка вставлена: ' + (document.getElementById('usc-gear-btn') ? 'да' : 'нет'),
            'Распознано вкладок: ' + detected.length,
            'Скрыто: ' + (hidden.length ? hidden.join(', ') : 'ничего'),
            'Своих кнопок: ' + (cfg.customTabs || []).length,
            'Безопасный режим: ' + (cfg.safeMode ? 'вкл' : 'выкл'),
            'Порядок: ' + ((cfg.order || []).join(', ') || 'родной'),
            '',
            rows.length ? rows.join('\n') : '(вкладки не найдены)',
        ].join('\n');
    }

    // textContent включает содержимое <style>/<script>, а у Startpage раздел —
    // это <button> со вложенным <style>, из-за чего подпись вкладки превращалась
    // в «.css-knhteg{font-size:14px;…». Собираем текст только по видимым узлам.
    function visibleText(el) {
        let out = '';
        const walk = (node) => {
            for (let i = 0; i < node.childNodes.length; i++) {
                const child = node.childNodes[i];
                if (child.nodeType === 3) { out += child.textContent; continue; }
                if (child.nodeType !== 1) continue;
                const tag = child.tagName;
                if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
                walk(child);
            }
        };
        walk(el);
        return out;
    }

    function cleanLabel(el) {
        const spans = [...el.querySelectorAll('span')]
            .filter(s => s.children.length === 0 && s.textContent.trim());
        let txt = spans.length ? spans[spans.length - 1].textContent : visibleText(el);
        txt = (txt || '').replace(/\s+/g, ' ').trim();
        return txt.length > 40 ? txt.slice(0, 40).trim() : txt;
    }

    function syntheticKey(a) {
        if (a.hasAttribute('data-usc-key')) return a.getAttribute('data-usc-key');
        const li = a.closest('li[id]');
        if (li && li.id) return 'x:' + li.id.toLowerCase();
        const u = urlOf(a) || formUrlOf(a);
        if (u) {
            const interesting = ['udm', 'tbm', 'ia', 'iax', 'iaxm', 'products_mode', 'scope', 'mode', 'm', 'lr', 't', 'cat', 'source', 'type'];
            const parts = [];
            interesting.forEach(p => { const v = u.searchParams.get(p); if (v) parts.push(p + '=' + v); });
            let base = (u.hostname || '').replace(/^www\./, '') + u.pathname.replace(/\/+$/, '');
            if (parts.length) base += '?' + parts.join('&');
            if (base) return 'x:' + base.toLowerCase();
        }
        const lab = cleanLabel(a);
        return lab ? 'x:' + lab.toLowerCase() : null;
    }

    function keyOf(a) {
        if (isOwnEl(a)) return null;
        const dk = a.getAttribute('data-usc-key');
        if (dk) return dk;
        const c = classifyEl(a);          // ссылка, кнопка-ссылка или форма
        if (c) return c;
        return syntheticKey(a);
    }

    function tabEls(container) {
        if (!container) return [];
        return leafTabNodes(container).filter(a => {
            if (isOwnEl(a)) return false;
            return !!cleanLabel(a) || a.hasAttribute('data-usc-key');
        });
    }

    function detectTabs() {
        const container = navContainer();
        if (!container) return [];
        const found = [], seen = new Set();
        tabEls(container).forEach(el => {
            const key = keyOf(el);
            if (!key || seen.has(key)) return;
            seen.add(key);
            found.push({ key, label: cleanLabel(el), el });
        });
        return found;
    }

    // Текущая активная вкладка (для быстрого действия «скрыть эту»).
    function currentTabKey() {
        const container = navContainer();
        if (!container) return null;
        const els = tabEls(container);
        let best = null;
        for (const el of els) {
            const key = keyOf(el);
            if (!key) continue;
            const active = el.getAttribute('aria-current')
                || (el.closest('[aria-current="page"], [aria-selected="true"], [class*="active" i], [class*="current" i]') ? '1' : null);
            if (active) return key;
            if (!best) best = key;
        }
        return best;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       8. ПРИМЕНЕНИЕ КОНФИГА
       ═══════════════════════════════════════════════════════════════════════ */

    let isApplying = false;
    let _cfgCache = null;

    function getCfg() {
        if (!_cfgCache) _cfgCache = loadConfig();
        return _cfgCache;
    }
    function setCfg(cfg) { _cfgCache = cfg; saveConfig(cfg); }

    function applyConfig() {
        if (_disabled) return;
        if (isApplying) return;
        isApplying = true;
        try { _applyConfig(); } finally { isApplying = false; markQuiet(); }
    }

    function _applyConfig() {
        beginNavPass();
        const cfg = getCfg();

        const container = navContainer();
        if (!container) { hideAllInterference(); return; }

        // №4: безопасный режим — снимаем всё вмешательство, кнопку оставляем.
        if (cfg.safeMode) {
            tabEls(container).forEach(link => restoreTab(link));
            injectItems(cfg, container);
            return;
        }

        const seen = new Set();
        tabEls(container).forEach(link => {
            const key = keyOf(link);
            if (!key || seen.has(key)) return;
            seen.add(key);

            const tabCfg = cfg.tabs[key];
            if (!tabCfg) { restoreTab(link); return; }

            if (tabCfg.hidden) { hideTab(link, container); return; }
            showTab(link);

            const canonical = canonicalLabel(key);
            const wanted = tabCfg.label || canonical;
            setLinkText(link, wanted, canonical);

            if (tabCfg.redirectUrl) applyRedirect(link, key, tabCfg.redirectUrl);
            else if (link.hasAttribute('data-usc-redirect')) clearRedirect(link);
        });

        reorderTabs(cfg, container);
        injectItems(cfg, container);
    }

    function hideAllInterference() {
        const gear = document.getElementById('usc-gear-btn');
        if (gear) (gear.closest('[data-usc-inject-wrap]') || gear).remove();
        document.querySelectorAll('[data-usc-custom]').forEach(el => {
            const wrap = el.closest('[data-usc-inject-wrap]');
            (wrap || el).remove();
        });
    }

    function restoreTab(link) {
        showTab(link);
        if (link.hasAttribute('data-usc-redirect')) clearRedirect(link);
        setLinkText(link, null, null);
    }

    function hideTab(link, container) {
        link.style.setProperty('display', 'none', 'important');
        link.setAttribute('data-usc-hidden', '1');
        const p = link.parentElement;
        if (p && p !== container && p !== document.body && p !== document.documentElement) {
            const sib = [...p.querySelectorAll(TAB_SELECTOR)].filter(a => !isOwnEl(a) && cleanLabel(a));
            if (sib.length <= 1) {
                p.style.setProperty('display', 'none', 'important');
                p.setAttribute('data-usc-wr-hidden', '1');
            }
        }
    }

    function showTab(link) {
        if (link.getAttribute('data-usc-hidden')) {
            link.style.removeProperty('display');
            link.removeAttribute('data-usc-hidden');
        }
        const wp = link.parentElement;
        if (wp && wp.getAttribute('data-usc-wr-hidden')) {
            wp.style.removeProperty('display');
            wp.removeAttribute('data-usc-wr-hidden');
        }
    }

    function applyRedirect(link, key, redirectUrl) {
        if (!link.hasAttribute('data-usc-orig')) {
            link.setAttribute('data-usc-href', link.getAttribute('href') || '');
        }
        const resolved = redirectUrl.replace(/\{query\}/g, encodeURIComponent(getQuery()));
        link.setAttribute('data-usc-key', key);
        link.setAttribute('data-usc-redirect', redirectUrl);
        link.setAttribute('data-usc-target', resolved);
        if (link.tagName === 'A') link.href = resolved;   // у <button> href нет
        if (!link._uscBound) {
            link.addEventListener('click', function (e) {
                const tgt = link.getAttribute('data-usc-target');
                if (tgt && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    window.location.href = tgt;
                }
            }, true);
            link._uscBound = true;
        }
    }

    function clearRedirect(link) {
        if (link.hasAttribute('data-usc-href')) {
            const orig = link.getAttribute('data-usc-href');
            if (orig) link.setAttribute('href', orig); else link.removeAttribute('href');
            link.removeAttribute('data-usc-href');
        }
        link.removeAttribute('data-usc-redirect');
        link.removeAttribute('data-usc-target');
    }

    // Переименование с восстановлением оригинальной подписи.
    function setLinkText(link, text, canonical) {
        const leaves = [...link.querySelectorAll('span, div')]
            .filter(e => e.children.length === 0 && e.textContent.trim());

        if (!leaves.length) {
            const node = [...link.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
            if (node) {
                if (text == null || text === canonical) {
                    if (link._uscOrigText != null) node.textContent = link._uscOrigText;
                } else {
                    if (link._uscOrigText == null) link._uscOrigText = node.textContent;
                    node.textContent = text;
                }
            } else if (text != null) {
                link.textContent = text;
            }
            return;
        }

        const isDefault = (text == null || text === canonical);
        if (isDefault) {
            if (link._uscOrigText == null) return;
            leaves.forEach(e => { e.textContent = link._uscOrigText; });
            link._uscOrigText = null;
            return;
        }
        if (link._uscOrigText == null) link._uscOrigText = leaves[leaves.length - 1].textContent;
        leaves.forEach(e => { e.textContent = text; });
    }

    function makeClickHandler(resolvedUrl) {
        return function (e) {
            if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                window.location.href = resolvedUrl;
            }
        };
    }

    // №5: DOM-перестановка по cfg.order. Максимально осторожно: если набор
    // узлов не совпадает или порядок уже верный — DOM не трогаем.
    function reorderTabs(cfg, container) {
        if (!cfg.order || cfg.order.length < 2) return;
        try {
            const map = new Map();
            tabEls(container).forEach(a => {
                const k = keyOf(a);
                if (k && !map.has(k)) map.set(k, a);
            });
            const units = [];
            cfg.order.forEach(k => {
                const a = map.get(k);
                if (!a) return;
                const p = a.parentElement;
                const unit = (p && p !== container && p.parentElement === container) ? p : a;
                if (units.indexOf(unit) === -1) units.push(unit);
            });
            if (units.length < 2) return;

            const current = [...container.children].filter(n => !isOwnEl(n));
            const relevant = current.filter(n => units.indexOf(n) !== -1);
            if (relevant.length !== units.length) return;   // структура иная — не лезем

            let same = true;
            for (let i = 0; i < units.length; i++) {
                if (relevant[i] !== units[i]) { same = false; break; }
            }
            if (same) return;

            const anchor = current.find(n => units.indexOf(n) === -1) || null;
            units.forEach(u => {
                if (anchor && anchor.parentElement === container) container.insertBefore(u, anchor);
                else container.appendChild(u);
            });
        } catch (_) {}
    }

    // Обёртка нового узла. styleFromAnchor — скопировать классы с существующей
    // вкладки, когда классы движка обфусцированы (Qwant).
    function wrapInjected(inner, styleFromAnchor) {
        const nav = ENGINE.nav || {};
        if (!nav.wrap) return inner;
        const w = document.createElement(nav.wrap);
        if (nav.itemClass) w.className = nav.itemClass;
        else if (nav.itemFromAnchor && styleFromAnchor) {
            const cls = styleFromAnchor.getAttribute('class');
            if (cls) w.setAttribute('class', cls);
        }
        if (nav.wrapRole)  w.setAttribute('role', nav.wrapRole);
        w.setAttribute('data-usc-inject-wrap', '1');
        w.appendChild(inner);
        return w;
    }

    function buildCustomAnchor(tab, q) {
        const a = document.createElement('a');
        const cls = (ENGINE.nav && ENGINE.nav.linkClass) || '';
        if (cls) a.className = cls;
        a.textContent = tab.label;
        a.setAttribute('data-usc-custom', tab.id);
        a.style.cursor = 'pointer';
        const resolvedUrl = tab.url.replace(/\{query\}/g, encodeURIComponent(q));
        a.href = resolvedUrl;
        a.addEventListener('click', makeClickHandler(resolvedUrl), true);
        return a;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       9. КНОПКА В СТРОКЕ ВКЛАДОК + ЛЕТУЧИЙ ТРЕЙ (A2, A3)

       Трей содержит РОВНО два действия: скрыть/показать текущую вкладку и
       открыть полную панель. Всё, что требует ввода текста, живёт только в
       раскрытой панели.

       Трей рендерится отдельным fixed-элементом в body: строки вкладок у
       поисковиков часто имеют overflow:hidden и обрезали бы absolute-трей.
       Показ/скрытие — по наведению, фокусу и «закреплению» после клика.
       ═══════════════════════════════════════════════════════════════════════ */

    // Пока пользователь не трогал свои кнопки, панель не имеет права
    // переписывать список: в момент перерисовки/смены языка/timer-гонки
    // DOM бывает пуст, и запись стирала все кастомные кнопки.
    let _customDirty = false;

    let _trayHideTimer = null;

    function currentTabCfg() {
        const cfg = getCfg();
        const key = currentTabKey();
        return { cfg, key, tab: key ? cfg.tabs[key] : null };
    }

    function hiddenCount(cfg) {
        let n = 0;
        Object.keys(cfg.tabs || {}).forEach(k => { if (cfg.tabs[k] && cfg.tabs[k].hidden) n++; });
        return n;
    }

    function buildGearButton() {
        const btn = document.createElement('button');
        btn.id = 'usc-gear-btn';
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', t('gearTitle'));
        btn.title = t('gearTitle') + ' — ' + ENGINE.name;
        // Только иконка: ни бейджа со счётчиком, ни всплывающего трея
        // по наведению — панель открывается кликом.
        btn.innerHTML = '<span class="usc-gear-ico" aria-hidden="true">' + icon('menu', 17) + '</span>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });
        return btn;
    }

    function getTray() {
        let tray = document.querySelector('[data-usc-hook="tray"]');
        if (!tray) {
            tray = document.createElement('div');
            tray.setAttribute('data-usc-hook', 'tray');
            tray.setAttribute('role', 'toolbar');
            tray.setAttribute('aria-label', t('trayLabel'));
            tray.setAttribute('aria-orientation', 'horizontal');
            tray.hidden = true;
            tray.addEventListener('mouseenter', cancelHideTray);
            tray.addEventListener('mouseleave', scheduleHideTray);
            document.body.appendChild(tray);
        }
        return tray;
    }

    function renderTray() {
        const tray = getTray();
        const { key, tab } = currentTabCfg();
        const isHidden = !!(tab && tab.hidden);

        const hideBtn = document.createElement('button');
        hideBtn.type = 'button';
        hideBtn.className = 'usc-qa usc-qa-hide';
        hideBtn.dataset.tip = isHidden ? t('showCurrent') : t('hideCurrent');
        hideBtn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
        hideBtn.setAttribute('aria-label', isHidden ? t('showCurrent') : t('hideCurrent'));
        hideBtn.title = isHidden ? t('showCurrent') : t('hideCurrent');
        hideBtn.disabled = !key;
        hideBtn.innerHTML = icon(isHidden ? 'eyeOff' : 'eye', 16);
        hideBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const cur = currentTabCfg();
            if (!cur.key) return;
            const next = getCfg();
            if (!next.tabs[cur.key]) next.tabs[cur.key] = { hidden: false, label: null, redirectUrl: null };
            next.tabs[cur.key].hidden = !next.tabs[cur.key].hidden;
            setCfg(next);
            applyConfig();
            renderTray();
            updateBadge(next);
            announce(next.tabs[cur.key].hidden ? t('tabHiddenMsg') : t('tabShownMsg'));
            if (_panelOpen) refreshPanelFromConfig();
        });

        const sep = document.createElement('span');
        sep.className = 'usc-qa-sep';
        sep.setAttribute('aria-hidden', 'true');

        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'usc-qa usc-qa-more';
        moreBtn.dataset.tip = t('more');
        moreBtn.setAttribute('aria-label', t('more'));
        moreBtn.setAttribute('aria-haspopup', 'dialog');
        moreBtn.setAttribute('aria-expanded', _panelOpen ? 'true' : 'false');
        moreBtn.title = t('more');
        moreBtn.innerHTML = icon('sliders', 16);
        moreBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            hideTray();
            if (_panelOpen) closePanel(true); else openPanel(true);
        });

        tray.textContent = '';
        tray.appendChild(hideBtn);
        tray.appendChild(sep);
        tray.appendChild(moreBtn);
        return tray;
    }

    function positionTray() {
        const tray = document.querySelector('[data-usc-hook="tray"]');
        const btn = document.getElementById('usc-gear-btn');
        if (!tray || !btn || tray.hidden) return;
        const r = btn.getBoundingClientRect();
        if (!r.width && !r.height) { tray.hidden = true; return; }
        tray.style.visibility = 'hidden';
        const tw = tray.offsetWidth || 80;
        const th = tray.offsetHeight || 34;
        let left = Math.round(r.right - tw);
        left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
        let top = Math.round(r.bottom + 7);
        if (top + th > window.innerHeight - 6) top = Math.max(6, Math.round(r.top - th - 7));
        tray.style.left = left + 'px';
        tray.style.top = top + 'px';
        tray.style.visibility = '';
    }

    function showTray() {
        cancelHideTray();
        const tray = renderTray();
        if (!document.getElementById('usc-gear-btn')) return;
        tray.hidden = false;
        positionTray();
        tray.classList.add('is-on');
    }

    function cancelHideTray() {
        clearTimeout(_trayHideTimer);
        _trayHideTimer = null;
    }

    function scheduleHideTray() {
        cancelHideTray();
        _trayHideTimer = setTimeout(() => { hideTray(); }, 180);
    }

    function hideTray() {
        const tray = document.querySelector('[data-usc-hook="tray"]');
        if (!tray) return;
        tray.classList.remove('is-on');
        tray.hidden = true;
    }

    function updateBadge(cfg) {
        // Счётчик на иконке убран по просьбе: он отвлекал.
        const btn = document.getElementById('usc-gear-btn');
        if (!btn) return;
        const badge = btn.querySelector('.usc-badge');
        if (!badge) return;
        const n = hiddenCount(cfg || getCfg());
        if (n > 0) {
            badge.hidden = false;
            badge.textContent = String(n);
            badge.title = n + ' ' + t('badgeTitle');
        } else {
            badge.hidden = true;
            badge.textContent = '';
        }
    }

    // Перепозиционирование трея при прокрутке/ресайзе (он fixed).
    let _trayReposBound = false;
    function bindTrayReposition() {
        if (_trayReposBound) return;
        _trayReposBound = true;
        const onMove = () => {
            const tray = document.querySelector('[data-usc-hook="tray"]');
            if (tray && !tray.hidden) positionTray();
        };
        window.addEventListener('scroll', onMove, { passive: true });
        window.addEventListener('resize', onMove);
    }

    function injectItems(cfg, container) {
        if (!container) container = navContainer();
        if (!container) return;

        bindTrayReposition();

        document.querySelectorAll('[data-usc-custom]').forEach(el => {
            const wrap = el.closest('[data-usc-inject-wrap]');
            (wrap || el).remove();
        });

        // Опорный «родной» элемент нужен только движкам с обфусцированными
        // классами (Qwant): у них копируем стиль существующей вкладки.
        const styleFrom = (ENGINE.nav && ENGINE.nav.itemFromAnchor)
            ? (container.querySelector('a[href]') || null)
            : null;

        const q = getQuery();
        (cfg.customTabs || []).forEach(tab => {
            container.appendChild(wrapInjected(buildCustomAnchor(tab, q), styleFrom));
        });

        let gear = document.getElementById('usc-gear-btn');
        if (!gear) {
            const unit = document.createElement('span');
            unit.setAttribute('data-usc-hook', 'trigger');
            unit.appendChild(buildGearButton());
            container.appendChild(wrapInjected(unit, styleFrom));
        } else {
            const unit = gear.parentElement && gear.parentElement.getAttribute('data-usc-hook') === 'trigger'
                ? gear.parentElement : gear;
            const wrapEl = unit.closest('[data-usc-inject-wrap]') || unit;
            if (wrapEl.parentElement !== container || wrapEl !== container.lastElementChild) {
                container.appendChild(wrapEl);
            }
        }
        updateBadge(cfg);
    }

    /* ═══════════════════════════════════════════════════════════════════════
       10. СТИЛИ ДЛЯ LIGHT DOM: кнопка, трей, кастомные кнопки
       ═══════════════════════════════════════════════════════════════════════ */

    const ACCENT = ENGINE.accent || '#4285f4';
    const TRG = (ENGINE.nav && ENGINE.nav.trigger) || TRIGGER_DEFAULTS;

    function accentRgba(alpha) {
        const m = String(ACCENT).replace('#', '').match(/.{2}/g);
        if (!m || m.length < 3) return 'rgba(66,133,244,' + alpha + ')';
        const r = parseInt(m[0], 16), g = parseInt(m[1], 16), b = parseInt(m[2], 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function navCss() {
        const size = TRG.size || 26;
        return `
        /* ── Обёртка триггера ── */
        [data-usc-hook="trigger"] {
            position: relative;
            display: inline-flex;
            align-items: ${TRG.alignSelf || 'center'};
            vertical-align: ${TRG.valign || 'middle'};
            margin: ${TRG.margin || '0 6px'};
            padding: 0;
            line-height: 1;
            flex-shrink: 0;
            font-size: ${TRG.fontSize || 'inherit'};
        }
        [data-usc-inject-wrap] {
            list-style: none;
            display: inline-flex;
            align-items: center;
            margin: 0;
            padding: 0;
        }
        ${ENGINE.nav && ENGINE.nav.injectMargin ? '[data-usc-inject-wrap] { margin: ' + ENGINE.nav.injectMargin + '; }' : ''}

        /* ── Кнопка ≡ ── */
        #usc-gear-btn {
            -webkit-appearance: none;
            appearance: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            width: ${size}px;
            height: ${size}px;
            min-width: ${size}px;
            min-height: ${size}px;
            padding: 0;
            margin: 0;
            border: 1px solid transparent;
            border-radius: ${TRG.radius || '6px'};
            background: transparent;
            color: ${ACCENT};
            cursor: pointer;
            position: relative;
            z-index: 2;
            line-height: 0;
            font: inherit;
            flex: 0 0 auto;
            vertical-align: ${TRG.valign || 'middle'};
            transition: background .13s ease, border-color .13s ease, color .13s ease;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        }
        #usc-gear-btn:hover,
        #usc-gear-btn:focus-visible,
        #usc-gear-btn[aria-expanded="true"] {
            background: ${accentRgba(0.13)};
            border-color: ${accentRgba(0.4)};
        }
        #usc-gear-btn:focus-visible { outline: 2px solid ${accentRgba(0.55)}; outline-offset: 2px; }
        #usc-gear-btn .usc-gear-ico { display: inline-flex; line-height: 0; pointer-events: none; }
        #usc-gear-btn svg { display: block; }

        /* ── Счётчик скрытых ── */
        #usc-gear-btn .usc-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            min-width: 14px;
            height: 14px;
            padding: 0 3px;
            box-sizing: border-box;
            border-radius: 999px;
            background: ${ACCENT};
            color: #fff;
            font: 700 9px/14px -apple-system, "Segoe UI", Roboto, sans-serif;
            text-align: center;
            letter-spacing: 0;
            pointer-events: none;
            box-shadow: 0 0 0 1.5px rgba(255,255,255,.9);
        }
        #usc-gear-btn .usc-badge[hidden] { display: none; }

        /* ── Летучий трей: ровно два действия, fixed → не обрезается строкой ── */
        [data-usc-hook="tray"] {
            position: fixed;
            z-index: 2147483000;
            display: flex;
            align-items: center;
            gap: 1px;
            padding: 3px;
            box-sizing: border-box;
            background: #fff;
            border: 1px solid rgba(16,17,20,.13);
            border-radius: 999px;
            box-shadow: 0 6px 18px -6px rgba(16,17,20,.28), 0 1px 3px rgba(16,17,20,.1);
            opacity: 0;
            transform: translateY(-4px) scale(.96);
            transform-origin: top right;
            pointer-events: none;
            transition: opacity .13s ease, transform .13s ease;
            font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        [data-usc-hook="tray"].is-on {
            opacity: 1;
            transform: none;
            pointer-events: auto;
        }
        [data-usc-hook="tray"][hidden] { display: none; }
        [data-usc-hook="tray"] .usc-qa {
            -webkit-appearance: none;
            appearance: none;
            box-sizing: border-box;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 0;
            border-radius: 999px;
            background: transparent;
            color: #4d5160;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 0;
            flex: 0 0 auto;
            transition: background .12s ease, color .12s ease;
        }
        [data-usc-hook="tray"] .usc-qa svg { display: block; }
        [data-usc-hook="tray"] .usc-qa:hover { background: rgba(16,17,20,.08); color: ${ACCENT}; }
        [data-usc-hook="tray"] .usc-qa:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -1px; }
        [data-usc-hook="tray"] .usc-qa[aria-pressed="true"] { color: ${ACCENT}; background: ${accentRgba(0.14)}; }
        [data-usc-hook="tray"] .usc-qa:disabled { opacity: .4; cursor: default; }
        [data-usc-hook="tray"] .usc-qa-sep {
            width: 1px; height: 15px; background: rgba(16,17,20,.14);
            margin: 0 2px; flex: 0 0 auto;
        }

        /* ── Кастомные кнопки в строке вкладок ── */
        a[data-usc-custom] {
            display: inline-flex;
            align-items: center;
            text-decoration: none;
            white-space: nowrap;
            -webkit-appearance: none;
            appearance: none;
        }

        /* Тёмная тема страницы */
        html[data-theme="dark"] [data-usc-hook="tray"],
        body[data-theme="dark"] [data-usc-hook="tray"] {
            background: #1d2027;
            border-color: rgba(255,255,255,.14);
            box-shadow: 0 6px 18px -6px rgba(0,0,0,.7), 0 1px 3px rgba(0,0,0,.5);
        }
        html[data-theme="dark"] [data-usc-hook="tray"] .usc-qa,
        body[data-theme="dark"] [data-usc-hook="tray"] .usc-qa { color: #b6bac6; }
        html[data-theme="dark"] [data-usc-hook="tray"] .usc-qa:hover,
        body[data-theme="dark"] [data-usc-hook="tray"] .usc-qa:hover { background: rgba(255,255,255,.11); }
        html[data-theme="dark"] [data-usc-hook="tray"] .usc-qa-sep,
        body[data-theme="dark"] [data-usc-hook="tray"] .usc-qa-sep { background: rgba(255,255,255,.16); }
        html[data-theme="dark"] #usc-gear-btn .usc-badge,
        body[data-theme="dark"] #usc-gear-btn .usc-badge { box-shadow: 0 0 0 1.5px #16181d; }

        @media (max-width: 760px) {
            [data-usc-hook="tray"] .usc-qa { width: 38px; height: 38px; }
            #usc-gear-btn { width: ${size + 4}px; height: ${size + 4}px; min-width: ${size + 4}px; min-height: ${size + 4}px; }
        }
        @media (pointer: coarse) {
            [data-usc-hook="tray"] .usc-qa { width: 38px; height: 38px; }
        }
        @media (prefers-reduced-motion: reduce) {
            #usc-gear-btn, [data-usc-hook="tray"] { transition-duration: .01ms !important; }
        }
        `;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       11. ПАНЕЛЬ НАСТРОЕК

       Панель живёт в Shadow DOM отдельного хоста. Это защищает её от
       страничных скриптов: Bing ставит MutationObserver («AdPrevention»),
       который удаляет добавленные в light DOM <div>/<li> с «рекламным»
       классом. Без изоляции панель открывалась пустой.
       ═══════════════════════════════════════════════════════════════════════ */

    let uiRoot = null;
    let _escHandler = null;
    let _outsideHandler = null;
    let _trapHandler = null;
    let _resizeHandler = null;
    let _announceTimer = null;
    let _panelOpen = false;
    let _openKeys = {};        // раскрытые строки
    let _liveRegion = null;

    function uiEl(id) {
        if (uiRoot) {
            const el = uiRoot.getElementById ? uiRoot.getElementById(id) : uiRoot.querySelector('#' + id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    function uiAll(selector) {
        return uiRoot ? [...uiRoot.querySelectorAll(selector)] : [...document.querySelectorAll(selector)];
    }

    function announce(msg) {
        if (!msg) return;
        if (!_liveRegion) {
            _liveRegion = document.createElement('div');
            _liveRegion.setAttribute('aria-live', 'polite');
            _liveRegion.setAttribute('role', 'status');
            _liveRegion.className = 'usc-sr';
            _liveRegion.id = 'usc-live';
            document.body.appendChild(_liveRegion);
        }
        _liveRegion.textContent = '';
        clearTimeout(_announceTimer);
        _announceTimer = setTimeout(() => { _liveRegion.textContent = msg; }, 30);
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function panelStatText(cfg, detected) {
        const total = (detected && detected.length) || Object.keys(cfg.tabs).length;
        const n = hiddenCount(cfg);
        // Короткая строка: в шапке мало места, длинный текст обрезался.
        return n ? (n + ' / ' + total + ' ' + t('hiddenWord')) : (total + ' ' + t('tabsWord'));
    }

    /* ── Открытие / закрытие / позиционирование ───────────────────────────── */

    function togglePanel() {
        if (_panelOpen) closePanel(true);
        else openPanel();
    }

    function openPanel(fromTray) {
        const existing = document.getElementById('usc-ui-host');
        if (existing && existing.isConnected) {
            const p = existing.shadowRoot && existing.shadowRoot.getElementById('usc-panel');
            if (p && !p.classList.contains('usc-closing')) return;
            existing.remove();
            uiRoot = null;
        }
        if (document.getElementById('usc-panel')) return;

        const cfg = getCfg();
        beginNavPass();
        const detected = detectTabs();

        const panel = document.createElement('div');
        panel.id = 'usc-panel';
        panel.dir = isRtl() ? 'rtl' : 'ltr';
        if (isDarkTheme()) panel.classList.add('usc-dark');
        panel.innerHTML = buildPanelHTML(cfg, detected);

        const host = document.createElement('csst-ui');
        host.id = 'usc-ui-host';
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';

        let root = null;
        try { root = host.attachShadow({ mode: 'open' }); } catch (_) { root = null; }

        if (root) {
            const style = document.createElement('style');
            style.textContent = panelCss();
            root.appendChild(style);
            root.appendChild(panel);
            uiRoot = root;
        } else {
            uiRoot = null;
            document.body.appendChild(panel);
        }
        document.body.appendChild(host);

        renderTabRows(cfg, detected);
        renderCustomRows(cfg);
        bindPanelEvents(cfg);
        placePanel();
        _panelOpen = true;
        const gear = document.getElementById('usc-gear-btn');
        if (gear) gear.setAttribute('aria-expanded', 'true');
        const more = document.querySelector('[data-usc-hook="tray"] .usc-qa-more');
        if (more) more.setAttribute('aria-expanded', 'true');
        if (fromTray) {
            requestAnimationFrame(() => {
                const f = uiEl('usc-filter');
                try { if (f) f.focus(); } catch (_) {}
            });
        }
    }

    // Перерисовка содержимого уже открытой панели после внешнего изменения.
    function refreshPanelFromConfig() {
        if (!_panelOpen) return;
        const cfg = getCfg();
        const detected = detectTabs();
        // Значение фильтра живёт в DOM и переживает перерисовку строк.
        renderTabRows(cfg, detected);
        renderCustomRows(cfg);
    }

    function placePanel() {
        const modal = uiRoot ? uiRoot.querySelector('.usc-modal') : document.querySelector('#usc-panel .usc-modal');
        if (!modal) return;
        const narrow = window.innerWidth <= 760;
        if (narrow) {
            modal.style.left = '';
            modal.style.top = '';
            modal.style.maxHeight = '';
            modal.classList.remove('is-up');
            return;
        }
        const W = 360;
        const btn = document.getElementById('usc-gear-btn');
        const r = btn ? btn.getBoundingClientRect() : { right: window.innerWidth - 16, top: 40, bottom: 60 };
        const left = Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8);
        const maxBottom = window.innerHeight - 10;

        modal.style.maxHeight = Math.max(240, maxBottom - 10) + 'px';
        const h = modal.offsetHeight || 420;
        let top = r.bottom + 10;
        const up = top + h > maxBottom;
        modal.classList.toggle('is-up', up);
        if (up) top = Math.max(8, r.top - h - 10);
        if (top + h > maxBottom) top = Math.max(8, maxBottom - h);
        modal.style.left = Math.round(left) + 'px';
        modal.style.top = Math.round(top) + 'px';
    }

    function closePanel(restoreFocus) {
        const panel = uiEl('usc-panel');
        if (!panel || panel.classList.contains('usc-closing')) return;
        panel.classList.add('usc-closing');
        _panelOpen = false;

        if (_escHandler)     { document.removeEventListener('keydown', _escHandler, true); _escHandler = null; }
        if (_trapHandler)    { document.removeEventListener('keydown', _trapHandler, true); _trapHandler = null; }
        if (_outsideHandler) { document.removeEventListener('mousedown', _outsideHandler, true); _outsideHandler = null; }
        if (_resizeHandler)  { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }

        const gear = document.getElementById('usc-gear-btn');
        if (gear) gear.setAttribute('aria-expanded', 'false');
        const more = document.querySelector('[data-usc-hook="tray"] .usc-qa-more');
        if (more) more.setAttribute('aria-expanded', 'false');

        setTimeout(() => {
            const host = uiRoot && uiRoot.host ? uiRoot.host : document.getElementById('usc-ui-host');
            if (panel) panel.remove();
            const p = document.getElementById('usc-panel');
            if (p) p.remove();
            if (host) host.remove();
            uiRoot = null;
        }, 170);
        if (restoreFocus && gear) { try { gear.focus(); } catch (_) {} }
    }

    /* ── HTML панели ───────────────────────────────────────────────────────── */

    function buildPanelHTML(cfg, detected) {
        const langOpts = LANG_LIST.map(code => {
            const name = code === 'auto' ? t('languageAuto') : (I18N[code] ? langName(code) : code);
            const sel = (UI.lang === code) ? ' selected' : '';
            return '<option value="' + escHtml(code) + '"' + sel + '>' + escHtml(name) + '</option>';
        }).join('');

        return `
        <div class="usc-backdrop"></div>
        <div class="usc-modal" role="dialog" aria-modal="false" aria-labelledby="usc-title">
            <div class="usc-top">
                <span class="usc-brand" aria-hidden="true">${icon('layout', 15)}</span>
                <h2 class="usc-title" id="usc-title">${escHtml(t('title'))}</h2>
                <span class="usc-engine">${escHtml(ENGINE.name)}</span>
                <span class="usc-stat" id="usc-stat">${escHtml(panelStatText(cfg, detected))}</span>
                <button class="usc-iconbtn usc-close" id="usc-close" type="button"
                        title="${escHtml(t('close'))}" aria-label="${escHtml(t('close'))}">${icon('close', 14)}</button>
            </div>

            <div class="usc-filter" id="usc-filter-wrap">
                ${icon('search', 13)}
                <input type="text" id="usc-filter" class="usc-filter-inp"
                       placeholder="${escHtml(t('searchIn'))}" aria-label="${escHtml(t('filter'))}">
                <button class="usc-filter-clear" id="usc-filter-clear" type="button"
                        aria-label="${escHtml(t('filterClear'))}" title="${escHtml(t('filterClear'))}">${icon('close', 11)}</button>
            </div>

            <div class="usc-body" id="usc-body">
                <div class="usc-group"><span>${escHtml(t('tabsGroup'))}</span><span class="usc-group-n" id="usc-tabcount"></span></div>
                <div id="usc-tab-rows"></div>

                <div class="usc-group"><span>${escHtml(t('customGroup'))}</span><span class="usc-group-n" id="usc-customcount"></span></div>
                <div id="usc-custom-rows"></div>
                <div class="usc-add-row">
                    <button class="usc-btn usc-btn-add" id="usc-add-custom" type="button">
                        ${icon('plus', 12)}<span>${escHtml(t('add'))}</span>
                    </button>
                </div>

                <div class="usc-empty" id="usc-empty" hidden>
                    <b id="usc-empty-title">${escHtml(t('emptyFilter'))}</b>
                    <button class="usc-btn" id="usc-empty-fallback" type="button" hidden>${escHtml(t('emptyNoTabsBtn'))}</button>
                </div>

                <div class="usc-opts">
                    <label class="usc-opt">
                        <input type="checkbox" id="usc-safe" ${cfg.safeMode ? 'checked' : ''}>
                        <span class="usc-opt-body">
                            <span class="usc-opt-name">${escHtml(t('safeMode'))}</span>
                            <span class="usc-opt-hint">${escHtml(t('safeModeHint'))}</span>
                        </span>
                    </label>
                    <label class="usc-opt usc-opt-lang">
                        <span class="usc-opt-body">
                            <span class="usc-opt-name">${escHtml(t('language'))}</span>
                        </span>
                        <select id="usc-lang" class="usc-select" aria-label="${escHtml(t('language'))}">${langOpts}</select>
                    </label>
                </div>
            </div>

            <div class="usc-foot">
                <button class="usc-btn usc-iconbtn" id="usc-export" type="button" title="${escHtml(t('export'))}" aria-label="${escHtml(t('export'))}">${icon('download', 14)}</button>
                <button class="usc-btn usc-iconbtn" id="usc-import" type="button" title="${escHtml(t('import'))}" aria-label="${escHtml(t('import'))}">${icon('upload', 14)}</button>
                <button class="usc-btn usc-btn-reset" id="usc-reset" type="button">${icon('reset', 12)}<span id="usc-reset-label">${escHtml(t('reset'))}</span></button>
                <button class="usc-btn usc-btn-done" id="usc-close-2" type="button">${icon('check', 13)}<span>${escHtml(t('done'))}</span></button>
            </div>

            <div class="usc-sheet" id="usc-sheet" role="group" aria-label="${escHtml(t('exportTitle'))}">
                <div class="usc-sheet-top">
                    <h3 id="usc-sheet-title">${escHtml(t('exportTitle'))}</h3>
                    <button class="usc-iconbtn" id="usc-sheet-close" type="button" aria-label="${escHtml(t('close'))}">${icon('close', 14)}</button>
                </div>
                <p class="usc-sheet-hint" id="usc-sheet-hint">${escHtml(t('exportHint'))}</p>
                <textarea id="usc-sheet-text" spellcheck="false" aria-label="${escHtml(t('exportTitle'))}"></textarea>
                <div class="usc-sheet-foot">
                    <button class="usc-btn" id="usc-sheet-copy" type="button">${escHtml(t('copy'))}</button>
                    <button class="usc-btn usc-btn-done" id="usc-sheet-apply" type="button" hidden>${escHtml(t('apply'))}</button>
                    <button class="usc-btn" id="usc-sheet-done" type="button">${escHtml(t('done'))}</button>
                </div>
            </div>
        </div>`;
    }

    const LANG_NAMES = {
        en: 'English', ru: 'Русский', uk: 'Українська', de: 'Deutsch', fr: 'Français',
        es: 'Español', pt: 'Português', tr: 'Türkçe', it: 'Italiano', pl: 'Polski',
        zh: '中文', ja: '日本語', ko: '한국어', hi: 'हिन्दी', ar: 'العربية',
    };
    function langName(code) { return LANG_NAMES[code] || code; }

    /* ── Рендер строк вкладок ──────────────────────────────────────────────── */

    function renderTabRows(cfg, detected) {
        const container = uiEl('usc-tab-rows');
        if (!container) return;
        container.textContent = '';

        const filterEl = uiEl('usc-filter');
        const q = (filterEl && filterEl.value || '').trim().toLowerCase();

        // №9: если ничего не найдено — показываем fallback «все известные вкладки».
        let list = (detected && detected.length)
            ? detected.map(d => ({ key: d.key, label: d.label }))
            : [];
        let usingFallback = false;
        if (!list.length) {
            list = Object.keys(cfg.tabs).map(key => ({ key, label: '' }));
            usingFallback = true;
        }

        // №5: порядок из конфига; вкладки, которых там нет, идут следом
        // в том порядке, в котором их отдал движок.
        const order = (cfg.order || []).slice();
        const seenOrder = new Set(order);
        list.forEach((item, i) => {
            if (!seenOrder.has(item.key)) { order.push(item.key); seenOrder.add(item.key); }
            item._idx = i;
        });
        list.sort((a, b) => {
            const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
            if (ia !== ib) return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
            return a._idx - b._idx;
        });

        let shown = 0;
        list.forEach(item => {
            const key = item.key;
            const nativeLabel = item.label;
            const tab = cfg.tabs[key] || (cfg.tabs[key] = { hidden: false, label: null, redirectUrl: null });
            const canonical = canonicalLabel(key);
            const display = tab.label || nativeLabel || canonical;
            if (q && display.toLowerCase().indexOf(q) === -1) return;
            shown++;
            container.appendChild(buildTabRow(cfg, key, display, canonical, nativeLabel));
        });

        const countEl = uiEl('usc-tabcount');
        if (countEl) countEl.textContent = shown + ' / ' + list.length;

        const emptyEl = uiEl('usc-empty');
        const emptyTitle = uiEl('usc-empty-title');
        const fallbackBtn = uiEl('usc-empty-fallback');
        if (emptyEl) {
            if (!usingFallback && q && shown === 0) {
                emptyEl.hidden = false;
                emptyTitle.textContent = t('emptyFilter');
                fallbackBtn.hidden = true;
            } else if (usingFallback && !detected.length) {
                emptyEl.hidden = false;
                emptyTitle.textContent = t('emptyNoTabs');
                fallbackBtn.hidden = false;   // «Показать все известные вкладки»
            } else {
                emptyEl.hidden = true;
            }
        }
        syncStats(cfg, detected);
    }

    function syncStats(cfg, detected) {
        const stat = uiEl('usc-stat');
        if (stat) stat.textContent = panelStatText(cfg, detected || detectTabs());
        const customCount = uiEl('usc-customcount');
        if (customCount) customCount.textContent = String((cfg.customTabs || []).length);
        updateBadge(cfg);
    }

    function statusChips(cfg, key, canonical) {
        const tab = cfg.tabs[key] || {};
        const parts = [];
        if (tab.hidden) parts.push('<span class="usc-chip usc-chip-hidden">' + escHtml(t('chipHidden')) + '</span>');
        if (tab.label && tab.label !== canonical) parts.push('<span class="usc-chip usc-chip-edit">' + escHtml(t('chipRenamed')) + '</span>');
        if (tab.redirectUrl) parts.push('<span class="usc-chip usc-chip-redir">' + escHtml(t('chipRedirect')) + '</span>');
        return parts.join('');
    }

    function buildTabRow(cfg, key, display, canonical, nativeLabel) {
        const tab = cfg.tabs[key] || { hidden: false, label: null, redirectUrl: null };
        const k = escHtml(key);
        const row = document.createElement('div');
        row.className = 'usc-row' + (tab.hidden ? ' is-hidden' : '') + (_openKeys[key] ? ' is-open' : '');
        row.dataset.key = key;
        row.dataset.native = nativeLabel || '';
        row.draggable = true;

        const presets = PRESETS[key] || [];
        const presetHtml = presets.length ? `
            <div class="usc-mini usc-wide">
                <span>${escHtml(t('presetField'))}</span>
                <select class="usc-preset usc-select" data-key="${k}" aria-label="${escHtml(t('presetField'))}">
                    <option value="">${escHtml(t('presetPlaceholder'))}</option>
                    ${presets.map(p => `<option value="${escHtml(p.url)}"${tab.redirectUrl === p.url ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}
                    <option value="__default__">${escHtml(t('original'))}</option>
                </select>
            </div>` : '';

        row.innerHTML = `
            <span class="usc-grip" aria-hidden="true" title="${escHtml(t('dragHint'))}">${icon('grip', 14)}</span>
            <div class="usc-row-main">
                <span class="usc-row-name" title="${escHtml(display)}">${escHtml(display)}</span>
                <span class="usc-chips">${statusChips(cfg, key, canonical)}</span>
            </div>
            <div class="usc-row-actions">
                <button class="usc-act usc-act-hide${tab.hidden ? ' is-on' : ''}" type="button"
                        data-key="${k}" aria-pressed="${tab.hidden ? 'true' : 'false'}"
                        title="${escHtml(tab.hidden ? t('show') : t('hide'))}"
                        aria-label="${escHtml((tab.hidden ? t('show') : t('hide')) + ' ' + display)}">${icon(tab.hidden ? 'eyeOff' : 'eye', 16)}</button>
                <button class="usc-act usc-act-more" type="button"
                        aria-expanded="${_openKeys[key] ? 'true' : 'false'}"
                        title="${escHtml(t('rename') + ' / ' + t('redirect'))}"
                        aria-label="${escHtml(t('rename') + ' ' + display)}">
                    <span class="usc-chev">${icon('chevron', 14)}</span>
                </button>
            </div>
            <div class="usc-detail">
                <div class="usc-mini usc-wide">
                    <span>${escHtml(t('labelField'))}</span>
                    <input type="text" class="usc-label-inp" data-key="${k}"
                           value="${escHtml(tab.label || '')}"
                           placeholder="${escHtml(nativeLabel || canonical)}"
                           aria-label="${escHtml(t('labelField') + ' ' + display)}">
                </div>
                ${presetHtml}
                <div class="usc-mini usc-wide">
                    <span>${escHtml(t('redirectField'))} <b class="usc-req">· {query}</b></span>
                    <input type="text" class="usc-url-inp" data-key="${k}"
                           value="${escHtml(tab.redirectUrl || '')}"
                           placeholder="${escHtml(t('urlPlaceholder'))}"
                           aria-label="${escHtml(t('redirectField') + ' ' + display)}">
                    <span class="usc-hint-line">${escHtml(t('urlEmptyHint'))}</span>
                </div>
            </div>`;

        if (tab.redirectUrl) {
            const inp = row.querySelector('.usc-url-inp');
            const hint = row.querySelector('.usc-hint-line');
            const bad = !isGoodUrl(tab.redirectUrl);
            if (inp) inp.classList.toggle('is-bad', bad);
            if (hint) { hint.textContent = bad ? t('invalidUrl') : t('urlOk'); hint.classList.toggle('is-bad', bad); }
        }
        return row;
    }

    /* ── Рендер кастомных кнопок ───────────────────────────────────────────── */

    let _customCounter = 1;

    function renderCustomRows(cfg) {
        const container = uiEl('usc-custom-rows');
        if (!container) return;
        container.textContent = '';
        (cfg.customTabs || []).forEach((ct, i) => container.appendChild(buildCustomRow(ct, i)));
    }

    function buildCustomRow(ct, idx) {
        const row = document.createElement('div');
        row.className = 'usc-custom';
        row.dataset.id = ct.id;
        row.dataset.idx = String(idx);
        row.innerHTML = `
            <div class="usc-stack">
                <input type="text" class="usc-ci-label" value="${escHtml(ct.label || '')}"
                       placeholder="${escHtml(t('namePlaceholder'))}" aria-label="${escHtml(t('namePlaceholder'))}">
                <input type="text" class="usc-ci-url" value="${escHtml(ct.url || '')}"
                       placeholder="${escHtml(t('urlPlaceholder'))}" aria-label="${escHtml(t('urlPlaceholder'))}">
            </div>
            <button class="usc-del" type="button" title="${escHtml(t('del'))}"
                    aria-label="${escHtml(t('del') + ' ' + (ct.label || ''))}">${icon('trash', 15)}</button>`;

        const urlInp = row.querySelector('.usc-ci-url');
        urlInp.classList.toggle('is-bad', !!(ct.url && !isGoodUrl(ct.url)));
        urlInp.addEventListener('input', () => {
            urlInp.classList.toggle('is-bad', !!(urlInp.value.trim() && !isGoodUrl(urlInp.value.trim())));
        });
        return row;
    }

    function appendCustomRow(label, url, id) {
        const container = uiEl('usc-custom-rows');
        if (!container) return null;
        const rowId = id || ('c' + Date.now().toString(36) + '_' + (_customCounter++));
        const el = buildCustomRow({ id: rowId, label: label || '', url: url || '' }, container.children.length);
        container.appendChild(el);
        return el;
    }

    function isGoodUrl(u) {
        if (!u) return true;
        if (u.indexOf('{query}') === -1) return false;
        try { new URL(u.replace(/\{query\}/g, 'test')); return true; } catch (_) { return false; }
    }

    /* ── События панели ────────────────────────────────────────────────────── */

    let _liveTimer = null;
    let _savedFlash = null;

    function liveSave(cfg) {
        clearTimeout(_liveTimer);
        _liveTimer = setTimeout(() => {
            // Панель могла закрыться за эти 180 мс (смена языка, импорт):
            // тогда читать DOM нельзя — соберём пустоту и затрём конфиг.
            if (!uiEl('usc-panel')) return;
            collectAndSave(cfg);
            applyConfig();
            flashSaved();
        }, 180);
    }

    function flashSaved() {
        const stat = uiEl('usc-stat');
        if (!stat) return;
        if (_savedFlash) clearTimeout(_savedFlash);
        stat.textContent = t('saved');
        stat.classList.add('is-saved');
        _savedFlash = setTimeout(() => {
            // Пересчитываем, а не восстанавливаем старое значение: счётчик
            // скрытых мог измениться, пока горела надпись «Сохранено».
            stat.textContent = panelStatText(getCfg(), detectTabs());
            stat.classList.remove('is-saved');
        }, 1200);
        announce(t('saved'));
    }

    function collectAndSave(cfg) {
        // вкладки
        uiAll('.usc-row').forEach(row => {
            const key = row.dataset.key;
            if (!key) return;
            if (!cfg.tabs[key]) cfg.tabs[key] = { hidden: false, label: null, redirectUrl: null };
            const labelInp = row.querySelector('.usc-label-inp');
            const urlInp   = row.querySelector('.usc-url-inp');
            const hideBtn  = row.querySelector('.usc-act-hide');
            if (labelInp) {
                const v = labelInp.value.trim();
                cfg.tabs[key].label = v ? v : null;
            }
            if (urlInp) {
                const v = urlInp.value.trim();
                cfg.tabs[key].redirectUrl = v ? v : null;
            }
            if (hideBtn) cfg.tabs[key].hidden = hideBtn.getAttribute('aria-pressed') === 'true';
        });
        // Кастомные кнопки. Если контейнера нет в DOM (панель закрывается,
        // перерисовывается или меняется язык), НЕ обнуляем список: раньше
        // отложенный live-save успевал сработать между closePanel и openPanel
        // и стирал все свои кнопки.
        const customBox = uiEl('usc-custom-rows');
        if (customBox && _customDirty) {
            const nextCustom = [];
            uiAll('.usc-custom').forEach(row => {
                const labelInp = row.querySelector('.usc-ci-label');
                const urlInp   = row.querySelector('.usc-ci-url');
                if (!labelInp || !urlInp) return;
                const label = labelInp.value.trim();
                const url   = urlInp.value.trim();
                if (label && url) nextCustom.push({ id: row.dataset.id, label, url });
            });
            cfg.customTabs = nextCustom;
            _customDirty = false;
        }
        // порядок: только то, что реально перечислено в панели
        const order = [];
        uiAll('.usc-row').forEach(r => { if (r.dataset.key) order.push(r.dataset.key); });
        if (order.length) {
            const rest = (cfg.order || []).filter(k => order.indexOf(k) === -1);
            cfg.order = order.concat(rest);
        }
        // безопасный режим
        const safe = uiEl('usc-safe');
        if (safe) cfg.safeMode = !!safe.checked;

        setCfg(cfg);
    }

    function bindPanelEvents(cfg) {
        const panel = uiEl('usc-panel');
        if (!panel) return;
        const close = () => closePanel(true);

        const backdrop = panel.querySelector('.usc-backdrop');
        if (backdrop) backdrop.onclick = close;
        ['usc-close', 'usc-close-2'].forEach(id => {
            const b = uiEl(id);
            if (b) b.onclick = close;
        });

        // ── фильтр (№7-стиль, часть дизайна) ──
        const filterEl = uiEl('usc-filter');
        const filterWrap = uiEl('usc-filter-wrap');
        if (filterEl) {
            filterEl.addEventListener('input', () => {
                if (filterWrap) filterWrap.classList.toggle('has-value', filterEl.value !== '');
                renderTabRows(cfg, detectTabs());
            });
            filterEl.addEventListener('keydown', e => {
                if (e.key !== 'Escape') return;
                if (filterEl.value) { e.stopPropagation(); filterEl.value = ''; if (filterWrap) filterWrap.classList.remove('has-value'); renderTabRows(cfg, detectTabs()); }
            });
        }
        const clearBtn = uiEl('usc-filter-clear');
        if (clearBtn) clearBtn.onclick = () => {
            if (!filterEl) return;
            filterEl.value = '';
            if (filterWrap) filterWrap.classList.remove('has-value');
            filterEl.focus();
            renderTabRows(cfg, detectTabs());
        };

        // ── №9: fallback «показать все известные вкладки» ──
        const fallbackBtn = uiEl('usc-empty-fallback');
        if (fallbackBtn) fallbackBtn.onclick = () => {
            beginNavPass();
            renderTabRows(cfg, []);
            announce(t('emptyNoTabsBtn'));
        };

        // ── №4: безопасный режим ──
        const safeCb = uiEl('usc-safe');
        if (safeCb) safeCb.addEventListener('change', () => {
            const next = getCfg();
            next.safeMode = !!safeCb.checked;
            setCfg(next);
            applyConfig();
            flashSaved();
        });

        // ── №20: язык интерфейса ──
        const langSel = uiEl('usc-lang');
        if (langSel) langSel.addEventListener('change', () => {
            const code = langSel.value;
            UI.lang = code;
            saveUiPrefs(UI);
            _langOverride = code === 'auto' ? null : code;
            PRESETS = buildPresets(activeLang());
            // Перерисовываем панель под новый язык, не теряя настройки.
            // Отложенный live-save гасим: он читал уже удалённый DOM.
            clearTimeout(_liveTimer);
            _customDirty = false;
            const keepOpen = _openKeys;
            const savedCfg = getCfg();
            closePanel(false);
            setTimeout(() => {
                _openKeys = keepOpen;
                _panelOpen = false;
                openPanel();
                announce(t('langChanged'));
                void savedCfg;
            }, 190);
        });

        // ── Добавить свою кнопку ──
        const addBtn = uiEl('usc-add-custom');
        if (addBtn) addBtn.onclick = () => {
            _customDirty = true;
            const row = appendCustomRow();
            const inp = row && row.querySelector('.usc-ci-label');
            if (inp) inp.focus();
            announce(t('add'));
        };

        // ── Действия в строке вкладки ──
        const tabsBox = uiEl('usc-tab-rows');
        if (tabsBox) tabsBox.addEventListener('click', e => {
            const hideBtn = e.target.closest('.usc-act-hide');
            if (hideBtn) {
                const row = hideBtn.closest('.usc-row');
                if (!row) return;
                const key = row.dataset.key;
                const on = hideBtn.getAttribute('aria-pressed') !== 'true';
                hideBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
                hideBtn.classList.toggle('is-on', on);
                hideBtn.innerHTML = icon(on ? 'eyeOff' : 'eye', 16);
                const display = (row.querySelector('.usc-row-name') || {}).textContent || key;
                hideBtn.setAttribute('aria-label', (on ? t('show') : t('hide')) + ' ' + display);
                hideBtn.title = on ? t('show') : t('hide');
                row.classList.toggle('is-hidden', on);
                refreshRowChips(row, key, on);
                liveSave(cfg);
                return;
            }
            const moreBtn = e.target.closest('.usc-act-more');
            if (moreBtn) {
                const row = moreBtn.closest('.usc-row');
                if (!row) return;
                const key = row.dataset.key;
                _openKeys[key] = !_openKeys[key];
                moreBtn.setAttribute('aria-expanded', _openKeys[key] ? 'true' : 'false');
                row.classList.toggle('is-open', !!_openKeys[key]);
                requestAnimationFrame(placePanel);
                if (_openKeys[key]) {
                    const inp = row.querySelector('.usc-label-inp');
                    if (inp) { try { inp.focus(); inp.select(); } catch (_) {} }
                }
            }
        });

        // ── Удаление своей кнопки ──
        const customBox = uiEl('usc-custom-rows');
        if (customBox) customBox.addEventListener('click', e => {
            const del = e.target.closest('.usc-del');
            if (!del) return;
            const row = del.closest('.usc-custom');
            if (!row) return;
            _customDirty = true;
            row.style.opacity = '0';
            row.style.transform = 'scale(.96)';
            setTimeout(() => {
                row.remove();
                collectAndSave(cfg);
                applyConfig();
                renderCustomRowsMeta(cfg);
                flashSaved();
            }, 140);
        });

        // ── live-save на любом вводе ──
        const body = uiEl('usc-body');
        if (body) {
            body.addEventListener('input', e => {
                const tgt = e.target;
                if (!tgt) return;
                if (tgt.classList.contains('usc-url-inp')) validateUrlField(tgt);
                if (tgt.classList.contains('usc-ci-url')) validateCustomUrl(tgt);
                if (tgt.classList.contains('usc-label-inp')) updateRowName(tgt);
                if (tgt.classList.contains('usc-ci-label')) { _customDirty = true; updateCustomName(tgt); }
                if (tgt.classList.contains('usc-ci-url')) _customDirty = true;
                if (tgt.closest('.usc-sheet')) return;
                liveSave(cfg);
            });
            body.addEventListener('change', e => {
                const sel = e.target && e.target.closest('.usc-preset');
                if (sel) {
                    const key = sel.dataset.key || '';
                    const row = sel.closest('.usc-row');
                    const inp = row && row.querySelector('.usc-url-inp');
                    if (inp) {
                        if (sel.value === '__default__') inp.value = '';
                        else if (sel.value) inp.value = sel.value;
                        validateUrlField(inp);
                    }
                    liveSave(cfg);
                    return;
                }
                if (e.target && e.target.classList.contains('usc-preset')) return;
                liveSave(cfg);
            });
        }

        // ── Экспорт / импорт ──
        bindSheet(cfg);

        // ── Сброс: два шага ──
        const resetBtn = uiEl('usc-reset');
        let resetArmed = false;
        let resetTimer = null;
        if (resetBtn) resetBtn.onclick = () => {
            if (!resetArmed) {
                resetArmed = true;
                resetBtn.classList.add('is-danger');
                const lbl = uiEl('usc-reset-label');
                if (lbl) lbl.textContent = t('resetArmed');
                clearTimeout(resetTimer);
                resetTimer = setTimeout(() => {
                    resetArmed = false;
                    resetBtn.classList.remove('is-danger');
                    if (lbl) lbl.textContent = t('reset');
                }, 3200);
                return;
            }
            resetArmed = false;
            clearTimeout(resetTimer);
            resetBtn.classList.remove('is-danger');
            const lbl = uiEl('usc-reset-label');
            if (lbl) lbl.textContent = t('reset');
            _customDirty = false;
            setCfg(defaultConfig());
            applyConfig();
            closePanel(false);
            setTimeout(() => { _panelOpen = false; openPanel(); }, 190);
            announce(t('resetDone'));
        };

        // ── Escape + focus trap + клик вне ──
        _escHandler = e => {
            if (!e) return;
            const sheet = uiEl('usc-sheet');
            if (e.key === 'Escape' && sheet && sheet.classList.contains('is-on')) {
                e.preventDefault(); e.stopPropagation();
                sheet.classList.remove('is-on');
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        };
        document.addEventListener('keydown', _escHandler, true);

        _trapHandler = e => {
            if (e.key !== 'Tab') return;
            const nodes = uiAll('.usc-modal button, .usc-modal input, .usc-modal select, .usc-modal textarea, .usc-modal [tabindex]:not([tabindex="-1"])')
                .filter(n => !n.disabled && n.offsetParent !== null && !n.hidden);
            if (!nodes.length) return;
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', _trapHandler, true);

        _outsideHandler = e => {
            // В Shadow DOM e.target «поднимается» до хоста, поэтому берём реальный путь.
            const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
            const tray = document.querySelector('[data-usc-hook="trigger"]');
            const trayEl = document.querySelector('[data-usc-hook="tray"]');
            for (const node of path) {
                if (node === panel) return;
                if (tray && (node === tray)) return;
                if (trayEl && node === trayEl) return;
                if (node === document.body || node === document.documentElement) break;
            }
            closePanel(false);
        };
        document.addEventListener('mousedown', _outsideHandler, true);

        _resizeHandler = () => placePanel();
        window.addEventListener('resize', _resizeHandler);

        // ── Drag-and-drop реордер (№5) ──
        bindDragReorder(cfg);

        // ── Alt+↑/↓ реордер с клавиатуры ──
        panel.addEventListener('keydown', e => {
            if (!e.altKey) return;
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const row = document.activeElement && document.activeElement.closest
                ? document.activeElement.closest('.usc-row') : null;
            if (!row || !row.dataset.key) return;
            e.preventDefault();
            moveRow(row.dataset.key, e.key === 'ArrowUp' ? -1 : 1, cfg);
        });
    }

    function renderCustomRowsMeta(cfg) {
        const c = uiEl('usc-customcount');
        if (c) c.textContent = String((cfg.customTabs || []).length);
        syncStats(cfg, detectTabs());
    }

    function refreshRowChips(row, key, hidden) {
        const cfg = getCfg();
        const chips = row.querySelector('.usc-chips');
        if (!chips) return;
        const canonical = canonicalLabel(key);
        const tab = cfg.tabs[key] || {};
        const copy = { hidden: !!hidden, label: tab.label, redirectUrl: tab.redirectUrl };
        const parts = [];
        if (copy.hidden) parts.push('<span class="usc-chip usc-chip-hidden">' + escHtml(t('chipHidden')) + '</span>');
        if (copy.label && copy.label !== canonical) parts.push('<span class="usc-chip usc-chip-edit">' + escHtml(t('chipRenamed')) + '</span>');
        if (copy.redirectUrl) parts.push('<span class="usc-chip usc-chip-redir">' + escHtml(t('chipRedirect')) + '</span>');
        chips.innerHTML = parts.join('');
    }

    function updateRowName(inp) {
        const row = inp.closest('.usc-row');
        if (!row) return;
        const nameEl = row.querySelector('.usc-row-name');
        const native = row.dataset.native || row.dataset.key;
        const v = inp.value.trim() || native;
        if (nameEl) { nameEl.textContent = v; nameEl.title = v; }
    }

    function updateCustomName(inp) {
        const row = inp.closest('.usc-custom');
        if (!row) return;
        const del = row.querySelector('.usc-del');
        if (del) del.setAttribute('aria-label', t('del') + ' ' + (inp.value.trim() || ''));
    }

    function validateUrlField(inp) {
        const row = inp.closest('.usc-row');
        const hint = row && row.querySelector('.usc-hint-line');
        const v = inp.value.trim();
        const bad = !!v && !isGoodUrl(v);
        inp.classList.toggle('is-bad', bad);
        if (hint) {
            hint.classList.toggle('is-bad', bad);
            hint.textContent = !v ? t('urlEmptyHint') : (bad ? t('invalidUrl') : t('urlOk'));
        }
    }

    function validateCustomUrl(inp) {
        const v = inp.value.trim();
        inp.classList.toggle('is-bad', !!v && !isGoodUrl(v));
    }

    /* ── №5: drag-and-drop ─────────────────────────────────────────────────── */

    let _dragKey = null;

    function bindDragReorder(cfg) {
        const box = uiEl('usc-tab-rows');
        if (!box) return;

        box.addEventListener('dragstart', e => {
            const row = e.target.closest && e.target.closest('.usc-row');
            if (!row) return;
            _dragKey = row.dataset.key;
            row.classList.add('is-dragging');
            try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', _dragKey || '');
            } catch (_) {}
        });
        box.addEventListener('dragend', () => {
            _dragKey = null;
            uiAll('.usc-row').forEach(r => r.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
        });
        box.addEventListener('dragover', e => {
            const row = e.target.closest && e.target.closest('.usc-row');
            if (!row || !_dragKey) return;
            e.preventDefault();
            try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
            const r = row.getBoundingClientRect();
            const after = (e.clientY - r.top) > r.height / 2;
            uiAll('.usc-row').forEach(x => x.classList.remove('is-drop-before', 'is-drop-after'));
            row.classList.add(after ? 'is-drop-after' : 'is-drop-before');
        });
        box.addEventListener('drop', e => {
            const row = e.target.closest && e.target.closest('.usc-row');
            if (!row || !_dragKey) return;
            e.preventDefault();
            const targetKey = row.dataset.key;
            if (!targetKey || targetKey === _dragKey) return;
            reorderTo(_dragKey, targetKey, row.classList.contains('is-drop-after'), cfg);
            _dragKey = null;
        });
    }

    function reorderTo(fromKey, toKey, after, cfg) {
        const rows = uiAll('.usc-row');
        const keys = rows.map(r => r.dataset.key);
        const from = keys.indexOf(fromKey);
        let to = keys.indexOf(toKey);
        if (from === -1 || to === -1) return;
        keys.splice(from, 1);
        if (from < to) to--;
        keys.splice(after ? to + 1 : to, 0, fromKey);

        // переставляем DOM
        const box = uiEl('usc-tab-rows');
        if (box) {
            const byKey = new Map();
            rows.forEach(r => byKey.set(r.dataset.key, r));
            keys.forEach(k => { const r = byKey.get(k); if (r) box.appendChild(r); });
        }
        cfg.order = keys.concat((cfg.order || []).filter(k => keys.indexOf(k) === -1));
        setCfg(cfg);
        applyConfig();
        announce(t('orderMoved'));
        flashSaved();
    }

    function moveRow(key, dir, cfg) {
        const rows = uiAll('.usc-row');
        const keys = rows.map(r => r.dataset.key);
        const i = keys.indexOf(key);
        const j = i + dir;
        if (i === -1 || j < 0 || j >= keys.length) return;
        const target = rows[j];
        reorderTo(key, target.dataset.key, dir > 0, cfg);
    }

    /* ── Экспорт / импорт с валидацией (№18) ───────────────────────────────── */

    function bindSheet(cfg) {
        const sheet = uiEl('usc-sheet');
        const text = uiEl('usc-sheet-text');
        const title = uiEl('usc-sheet-title');
        const hint = uiEl('usc-sheet-hint');
        const copyBtn = uiEl('usc-sheet-copy');
        const applyBtn = uiEl('usc-sheet-apply');

        const hide = () => { if (sheet) sheet.classList.remove('is-on'); };

        const exp = uiEl('usc-export');
        if (exp) exp.onclick = () => {
            const data = JSON.stringify(getCfg(), null, 2);
            if (title) title.textContent = t('exportTitle');
            if (hint) hint.textContent = t('exportHint');
            if (text) { text.value = data; text.readOnly = true; }
            if (copyBtn) copyBtn.hidden = false;
            if (applyBtn) applyBtn.hidden = true;
            if (sheet) sheet.classList.add('is-on');
            if (text) { try { text.focus(); text.select(); } catch (_) {} }
            // Заодно скачиваем файл — привычный путь.
            try {
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'csst-config.json';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (_) {}
        };

        // Импорт — через файл. Раньше просили вставить JSON руками; это
        // неудобно и легко испортить переносом строк. Экспорт по-прежнему
        // и скачивает .json, и показывает текст.
        let fileInput = document.getElementById('usc-import-file');
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.id = 'usc-import-file';
            fileInput.accept = '.json,application/json';
            fileInput.style.display = 'none';
            const hostEl = (uiRoot && uiRoot.host) ? uiRoot.host : document.body;
            hostEl.appendChild(fileInput);
        }
        const failImport = (msg) => {
            announce(msg);
            if (hint) { hint.textContent = msg; hint.classList.add('is-bad'); }
        };
        const applyJson = (raw) => {
            let parsed;
            try { parsed = JSON.parse(raw); } catch (_) { failImport(t('notJson')); return; }
            const res = validateConfig(parsed, { strict: true });
            if (!res.ok) { failImport(t(res.error) || t('importBad')); return; }
            if (hint) { hint.classList.remove('is-bad'); }
            setCfg(res.cfg);
            applyConfig();
            hide();
            closePanel(false);
            setTimeout(() => { _panelOpen = false; openPanel(); }, 190);
            announce(t('importOk'));
        };
        fileInput.onchange = () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => { applyJson(String(reader.result || '')); fileInput.value = ''; };
            reader.onerror = () => { failImport(t('importBad')); fileInput.value = ''; };
            reader.readAsText(f);
        };
        const imp = uiEl('usc-import');
        if (imp) imp.onclick = () => {
            if (hint) hint.classList.remove('is-bad');
            try { fileInput.value = ''; fileInput.click(); } catch (_) { announce(t('importBad')); }
        };

        if (copyBtn) copyBtn.onclick = () => {
            if (!text) return;
            const done = () => { announce(t('copied')); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text.value).then(done, () => {
                    try { text.select(); document.execCommand('copy'); done(); } catch (_) { announce(t('copiedFail')); }
                });
            } else {
                try { text.select(); document.execCommand('copy'); done(); } catch (_) { announce(t('copiedFail')); }
            }
        };

        if (applyBtn) applyBtn.onclick = () => {
            if (!text) return;
            let parsed;
            try { parsed = JSON.parse(text.value); } catch (_) { announce(t('notJson')); return; }
            const res = validateConfig(parsed, { strict: true });
            if (!res.ok) {
                announce(t(res.error) || t('importBad'));
                if (hint) { hint.textContent = t(res.error) || t('importBad'); hint.classList.add('is-bad'); }
                return;
            }
            if (hint) { hint.classList.remove('is-bad'); hint.textContent = t('importHint'); }
            setCfg(res.cfg);
            applyConfig();
            hide();
            closePanel(false);
            setTimeout(() => { _panelOpen = false; openPanel(); }, 190);
            announce(t('importOk'));
        };

        const sheetClose = uiEl('usc-sheet-close');
        if (sheetClose) sheetClose.onclick = hide;
        const sheetDone = uiEl('usc-sheet-done');
        if (sheetDone) sheetDone.onclick = hide;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       12. CSS ПАНЕЛИ (Shadow DOM)
       ═══════════════════════════════════════════════════════════════════════ */

    function panelCss() {
        const dark = isDarkTheme();
        return `
        :host { contain: layout style; all: initial; }
        #usc-panel {
            --accent: ${ACCENT};
            --accent-soft: ${accentRgba(0.12)};
            --ink: #101114;
            --ink-2: #4d5160;
            --ink-3: #82869a;
            --line: #e6e7eb;
            --line-2: #f0f1f4;
            --bg: #ffffff;
            --bg-2: #f6f7f9;
            --bg-3: #eceef2;
            --danger: #d92d20;
            --ok: #12805c;
            position: absolute;
            inset: 0;
            z-index: 2147483646;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            font-size: 12px;
            line-height: 1.45;
            color: var(--ink);
            letter-spacing: normal;
            text-align: start;
            direction: ${isRtl() ? 'rtl' : 'ltr'};
            -webkit-font-smoothing: antialiased;
            -webkit-text-size-adjust: 100%;
        }
        #usc-panel *, #usc-panel *::before, #usc-panel *::after { box-sizing: border-box; }
        #usc-panel button, #usc-panel input, #usc-panel select, #usc-panel textarea {
            font-family: inherit; font-size: inherit; color: inherit; letter-spacing: inherit;
        }
        #usc-panel svg { display: block; flex: 0 0 auto; }

        .usc-backdrop { position: absolute; inset: 0; background: transparent; }

        /* ── Модалка ── */
        .usc-modal {
            position: absolute;
            left: 8px;
            top: 8px;
            width: 360px;
            display: flex;
            flex-direction: column;
            max-height: calc(100vh - 20px);
            background: var(--bg);
            border: 1px solid var(--line);
            border-radius: 10px;
            box-shadow: 0 18px 42px -12px rgba(16,17,20,.28), 0 2px 8px rgba(16,17,20,.08);
            overflow: hidden;
            animation: usc-in .14s cubic-bezier(.3,0,.2,1);
        }
        .usc-modal.is-up { animation-name: usc-in-up; }
        #usc-panel.usc-closing .usc-modal { animation: usc-out .13s ease forwards; }
        @keyframes usc-in    { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
        @keyframes usc-in-up { from { opacity: 0; transform: translateY(6px) scale(.985); }  to { opacity: 1; transform: none; } }
        @keyframes usc-out   { to { opacity: 0; transform: scale(.98); } }

        /* ── Верх ── */
        .usc-top {
            display: flex; align-items: center; gap: 7px;
            padding: 9px 9px 9px 11px;
            border-bottom: 1px solid var(--line);
            flex-shrink: 0;
        }
        .usc-brand { color: var(--accent); display: inline-flex; flex: 0 0 auto; }
        .usc-title { margin: 0; font-size: 12.5px; font-weight: 700; letter-spacing: .01em; white-space: nowrap; flex: 0 0 auto; }
        .usc-engine {
            font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
            color: var(--accent); background: var(--accent-soft);
            border-radius: 4px; padding: 2px 5px; white-space: nowrap; flex: 0 0 auto;
        }
        .usc-stat { font-size: 10px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .usc-stat.is-saved { color: var(--ok); font-weight: 700; }
        .usc-iconbtn {
            -webkit-appearance: none; appearance: none;
            margin-inline-start: auto;
            width: 26px; height: 26px; min-width: 26px;
            display: inline-flex; align-items: center; justify-content: center;
            border: 1px solid transparent; border-radius: 6px;
            background: none; color: var(--ink-3); cursor: pointer; padding: 0;
            transition: background .12s, color .12s, border-color .12s;
        }
        .usc-iconbtn:hover { background: var(--bg-2); color: var(--ink); border-color: var(--line); }
        .usc-iconbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

        /* ── Фильтр ── */
        .usc-filter {
            position: relative; display: flex; align-items: center; gap: 6px;
            padding: 7px 10px; border-bottom: 1px solid var(--line);
            background: var(--bg-2); flex-shrink: 0;
        }
        .usc-filter > svg { color: var(--ink-3); flex: 0 0 auto; }
        .usc-filter-inp {
            flex: 1 1 auto; min-width: 0; height: 28px;
            border: 1px solid var(--line); border-radius: 6px;
            padding: 0 26px 0 8px; background: var(--bg); color: var(--ink);
            outline: 0; transition: border-color .12s, box-shadow .12s;
        }
        #usc-panel[dir="rtl"] .usc-filter-inp { padding: 0 8px 0 26px; }
        .usc-filter-inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .usc-filter-clear {
            position: absolute; inset-inline-end: 16px;
            width: 17px; height: 17px; display: none; align-items: center; justify-content: center;
            border: 0; border-radius: 50%; background: var(--bg-3); color: var(--ink-3);
            cursor: pointer; padding: 0;
        }
        .usc-filter.has-value .usc-filter-clear { display: inline-flex; }
        .usc-filter-clear:hover { background: var(--line); color: var(--ink); }

        /* ── Тело ── */
        .usc-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; }
        .usc-body::-webkit-scrollbar { width: 10px; }
        .usc-body::-webkit-scrollbar-thumb { background: var(--line); border-radius: 99px; border: 3px solid var(--bg); }

        .usc-group {
            display: flex; align-items: center; gap: 6px;
            padding: 7px 11px 5px; font-size: 9px; font-weight: 700;
            letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3);
            background: var(--bg); position: sticky; top: 0; z-index: 1;
        }
        .usc-group-n { font-weight: 600; letter-spacing: 0; text-transform: none; opacity: .85; }

        /* ── Строка вкладки ── */
        .usc-row {
            display: grid;
            grid-template-columns: auto minmax(0,1fr) auto;
            align-items: center; gap: 6px;
            padding: 4px 8px 4px 6px;
            border-bottom: 1px solid var(--line-2);
            min-height: 36px;
        }
        #usc-panel[dir="rtl"] .usc-row { padding: 4px 6px 4px 8px; }
        .usc-row:hover { background: var(--bg-2); }
        .usc-row.is-hidden .usc-row-name { color: var(--ink-3); text-decoration: line-through; text-decoration-thickness: 1px; }
        .usc-row.is-hidden { background: var(--bg-2); }
        .usc-row.is-dragging { opacity: .45; }
        .usc-row.is-drop-before { box-shadow: inset 0 2px 0 var(--accent); }
        .usc-row.is-drop-after  { box-shadow: inset 0 -2px 0 var(--accent); }

        .usc-grip {
            color: var(--ink-3); opacity: .5; cursor: grab;
            display: inline-flex; align-items: center; padding: 0 1px;
            touch-action: none;
        }
        .usc-row:hover .usc-grip { opacity: 1; }
        .usc-grip:active { cursor: grabbing; }

        .usc-row-main { min-width: 0; display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; }
        .usc-row-name {
            font-size: 12.5px; font-weight: 600; min-width: 0;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .usc-chips { display: inline-flex; gap: 3px; flex: 0 0 auto; }
        .usc-chip {
            font-size: 8.5px; font-weight: 700; letter-spacing: .03em;
            padding: 1px 4px; border-radius: 3px; text-transform: uppercase;
            background: var(--bg-3); color: var(--ink-3); white-space: nowrap;
        }
        .usc-chip-edit  { background: rgba(29,78,216,.12); color: #1d4ed8; }
        .usc-chip-redir { background: rgba(18,128,92,.13); color: var(--ok); }
        .usc-chip-hidden{ background: var(--bg-3); color: var(--ink-3); }

        .usc-row-actions { display: flex; align-items: center; gap: 1px; flex: 0 0 auto; }
        .usc-act {
            -webkit-appearance: none; appearance: none;
            width: 26px; height: 26px; min-width: 26px; padding: 0;
            display: inline-flex; align-items: center; justify-content: center;
            border: 0; border-radius: 6px; background: none; color: var(--ink-3);
            cursor: pointer; flex: 0 0 auto;
            transition: background .12s, color .12s, box-shadow .12s;
        }
        .usc-act:hover { background: var(--bg); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
        .usc-act.is-on { color: var(--accent); background: var(--accent-soft); }
        .usc-act:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .usc-chev { display: inline-flex; transition: transform .14s; }
        .usc-row.is-open .usc-chev { transform: rotate(180deg); }

        /* ── Раскрытая часть строки ── */
        .usc-detail {
            grid-column: 1 / -1;
            display: none; gap: 6px;
            padding: 2px 2px 8px;
            grid-template-columns: 1fr 1fr;
        }
        .usc-row.is-open .usc-detail { display: grid; }
        .usc-mini { display: grid; gap: 2px; min-width: 0; }
        .usc-wide { grid-column: 1 / -1; }
        .usc-mini > span {
            font-size: 8.5px; font-weight: 700; letter-spacing: .05em;
            text-transform: uppercase; color: var(--ink-3);
            display: flex; align-items: center; gap: 4px;
        }
        .usc-req { color: var(--accent); font-weight: 700; }
        .usc-mini input, .usc-select {
            width: 100%; min-width: 0; height: 26px;
            border: 1px solid var(--line); border-radius: 5px;
            padding: 0 7px; background: var(--bg); color: var(--ink);
            outline: 0; -webkit-appearance: none; appearance: none;
            transition: border-color .12s, box-shadow .12s;
        }
        .usc-select { padding-inline-end: 20px; }
        .usc-mini input:focus, .usc-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .usc-mini input.is-bad { border-color: var(--danger); box-shadow: 0 0 0 3px rgba(217,45,32,.12); }
        .usc-hint-line { font-size: 9.5px; color: var(--ink-3); line-height: 1.35; }
        .usc-hint-line.is-bad { color: var(--danger); font-weight: 600; }

        /* ── Свои кнопки ── */
        .usc-custom {
            display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px;
            align-items: start; padding: 7px 8px 7px 11px;
            border-bottom: 1px solid var(--line-2);
            transition: opacity .12s, transform .12s;
        }
        .usc-custom:hover { background: var(--bg-2); }
        .usc-stack { display: grid; gap: 3px; min-width: 0; }
        .usc-custom input {
            width: 100%; min-width: 0; height: 26px;
            border: 1px solid var(--line); border-radius: 5px;
            padding: 0 7px; background: var(--bg); color: var(--ink);
            outline: 0; transition: border-color .12s, box-shadow .12s;
        }
        .usc-custom input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .usc-custom input.is-bad { border-color: var(--danger); box-shadow: 0 0 0 3px rgba(217,45,32,.12); }
        .usc-del {
            -webkit-appearance: none; appearance: none;
            width: 26px; height: 26px; min-width: 26px; padding: 0;
            display: inline-flex; align-items: center; justify-content: center;
            border: 1px solid var(--line); border-radius: 5px;
            background: var(--bg); color: var(--ink-3); cursor: pointer; flex: 0 0 auto;
            transition: color .12s, border-color .12s, background .12s;
        }
        .usc-del:hover { background: rgba(217,45,32,.08); border-color: rgba(217,45,32,.4); color: var(--danger); }
        .usc-del:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

        .usc-add-row { padding: 7px 8px 9px 11px; }

        /* ── Пустое состояние ── */
        .usc-empty {
            padding: 18px 14px; text-align: center; color: var(--ink-3); font-size: 11.5px;
            display: flex; flex-direction: column; align-items: center; gap: 8px;
        }
        .usc-empty[hidden] { display: none; }
        .usc-empty b { display: block; color: var(--ink-2); font-size: 12px; font-weight: 600; }

        /* ── Опции: safe mode + язык ── */
        .usc-opts {
            border-top: 1px solid var(--line);
            padding: 8px 11px 10px;
            display: grid; gap: 7px;
            background: var(--bg-2);
        }
        .usc-opt { display: flex; align-items: center; gap: 8px; cursor: pointer; min-height: 24px; padding: 2px 0; }
        .usc-opt input[type="checkbox"] { width: 15px; height: 15px; accent-color: ${ACCENT}; flex: 0 0 auto; margin: 0; }
        .usc-opt-body { display: grid; gap: 1px; min-width: 0; flex: 1 1 auto; }
        .usc-opt-name { font-size: 11px; font-weight: 600; color: var(--ink-2); }
        .usc-opt-hint { font-size: 9.5px; color: var(--ink-3); }
        .usc-opt-lang { cursor: default; }
        .usc-opt-lang .usc-select { max-width: 150px; height: 26px; margin-inline-start: auto; }

        /* ── Подвал ── */
        .usc-foot {
            display: flex; gap: 5px; align-items: center; flex-wrap: wrap;
            padding: 7px 9px; border-top: 1px solid var(--line); background: var(--bg-2);
            flex-shrink: 0;
        }
        .usc-btn {
            -webkit-appearance: none; appearance: none;
            height: 27px; min-height: 27px; padding: 0 9px;
            border-radius: 5px; border: 1px solid var(--line);
            background: var(--bg); color: var(--ink-2);
            font-size: 11.5px; font-weight: 500; cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center; gap: 5px;
            white-space: nowrap; line-height: 1;
            transition: border-color .12s, color .12s, background .12s, filter .12s;
        }
        .usc-btn:hover { border-color: var(--ink-3); color: var(--ink); }
        .usc-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .usc-btn.usc-iconbtn { width: 27px; min-width: 27px; padding: 0; margin-inline-start: 0; }
        .usc-btn-add { width: 100%; border-style: dashed; color: var(--accent); border-color: ${accentRgba(0.45)}; background: transparent; font-weight: 600; }
        .usc-btn-add:hover { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
        .usc-btn-done { margin-inline-start: auto; background: ${ACCENT}; border-color: ${ACCENT}; color: #fff; font-weight: 600; }
        .usc-btn-done:hover { filter: brightness(.93); color: #fff; border-color: ${ACCENT}; }
        .usc-btn-reset.is-danger { color: var(--danger); border-color: rgba(217,45,32,.5); background: rgba(217,45,32,.08); }

        /* ── Лист экспорта/импорта ── */
        .usc-sheet {
            position: absolute; inset: 0; z-index: 5; background: var(--bg);
            display: none; flex-direction: column;
        }
        .usc-sheet.is-on { display: flex; }
        .usc-sheet-top { display: flex; align-items: center; gap: 8px; padding: 9px 9px 9px 11px; border-bottom: 1px solid var(--line); }
        .usc-sheet-top h3 { margin: 0; font-size: 12px; font-weight: 700; }
        .usc-sheet-hint { margin: 8px 10px 0; font-size: 10px; color: var(--ink-3); }
        .usc-sheet-hint.is-bad { color: var(--danger); font-weight: 600; }
        .usc-sheet textarea {
            flex: 1 1 auto; margin: 8px 10px; padding: 8px; min-height: 140px; resize: none;
            border: 1px solid var(--line); border-radius: 6px;
            font: 11px/1.5 ui-monospace, Consolas, monospace;
            background: var(--bg-2); color: var(--ink-2); outline: 0;
        }
        .usc-sheet textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .usc-sheet-foot { display: flex; gap: 5px; padding: 0 10px 10px; }
        .usc-sheet-foot .usc-btn-done { margin-inline-start: 0; }

        .usc-sr {
            position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
            overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
        }

        /* ════════ ТЁМНАЯ ТЕМА ════════ */
        ${dark ? `
        #usc-panel {
            --ink: #f2f3f6; --ink-2: #b6bac6; --ink-3: #8b90a0;
            --line: #2b2e38; --line-2: #23262e;
            --bg: #16181d; --bg-2: #1d2027; --bg-3: #262a33;
            --accent-soft: ${accentRgba(0.2)};
        }
        .usc-modal { box-shadow: 0 18px 42px -12px rgba(0,0,0,.7), 0 2px 8px rgba(0,0,0,.4); }
        .usc-chip-edit { background: rgba(123,162,255,.16); color: #9db8ff; }
        .usc-chip-redir { background: rgba(52,211,153,.15); color: #5eead4; }
        .usc-del:hover { background: rgba(217,45,32,.16); }
        .usc-act:hover { background: #22252c; }
        ` : ''}

        /* ── Узкие экраны: нижний лист + крупные цели ── */
        @media (max-width: 760px) {
            .usc-modal {
                left: 10px !important; right: 10px !important;
                bottom: 10px !important; top: auto !important;
                width: auto; max-height: min(72vh, 560px) !important;
                border-radius: 14px;
            }
            /* Цели ≥44×44 px для пальца; иконки визуально того же размера. */
            .usc-row { min-height: 54px; padding: 6px 6px; }
            .usc-act { width: 44px; height: 44px; min-width: 44px; }
            .usc-del { width: 44px; height: 44px; min-width: 44px; }
            .usc-iconbtn { width: 44px; height: 44px; min-width: 44px; }
            .usc-btn { height: 40px; min-height: 40px; padding: 0 12px; }
            .usc-btn.usc-iconbtn { width: 40px; min-width: 40px; }
            .usc-filter-inp { height: 40px; }
            .usc-filter-clear { width: 24px; height: 24px; inset-inline-end: 20px; }
            .usc-mini input, .usc-select, .usc-custom input { height: 40px; }
            .usc-opt { min-height: 44px; }
            .usc-opt input[type="checkbox"] { width: 22px; height: 22px; }
            .usc-chev { transform-origin: center; }
        }
        @media (prefers-reduced-motion: reduce) {
            .usc-modal, .usc-row, .usc-chev, .usc-act { animation-duration: .01ms !important; transition-duration: .01ms !important; }
        }
        `;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       13. АВТООБНОВЛЕНИЕ (активный слой)

       Пассивный слой — @updateURL/@downloadURL в шапке — остаётся как был.
       Здесь добавляется активный: раз в сутки, в простое, скрипт скачивает
       свой raw-файл и сравнивает @version. О найденной версии сообщает
       баннером один раз на версию. Любая ошибка гасится молча.
       ═══════════════════════════════════════════════════════════════════════ */

    const SCRIPT_VERSION = '1.3.2';
    const UPDATE_URL = 'https://raw.githubusercontent.com/diple-df/CSST-tampermonkey-script/main/csst_tmprmnk.user.js';
    const UPDATE_META_KEY = 'usc_update_meta';
    const UPDATE_CHECK_EVERY = 24 * 60 * 60 * 1000;   // сутки
    const UPDATE_TIMEOUT = 15000;

    // Сегментное сравнение: 2.10.0 > 2.9.0, 1.3.0 > 1.3, 1.3.0-beta < 1.3.0.
    function parseVersion(v) {
        const clean = String(v || '').trim().replace(/^v/i, '');
        const m = clean.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/);
        if (!m) return null;
        return {
            nums: m[1].split('.').map(n => parseInt(n, 10) || 0),
            pre: m[2] || '',
        };
    }

    function compareVersions(a, b) {
        const A = parseVersion(a), B = parseVersion(b);
        if (!A && !B) return 0;
        if (!A) return -1;
        if (!B) return 1;
        const len = Math.max(A.nums.length, B.nums.length);
        for (let i = 0; i < len; i++) {
            const x = A.nums[i] || 0, y = B.nums[i] || 0;
            if (x > y) return 1;
            if (x < y) return -1;
        }
        // Релиз новее пре-релиза с тем же номером.
        if (A.pre && !B.pre) return -1;
        if (!A.pre && B.pre) return 1;
        if (A.pre === B.pre) return 0;
        return A.pre > B.pre ? 1 : -1;
    }

    function loadUpdateMeta() {
        try {
            const raw = GM_getValue(UPDATE_META_KEY, null);
            if (!raw) return { lastCheck: 0, notified: '' };
            const p = JSON.parse(raw);
            if (!p || typeof p !== 'object') return { lastCheck: 0, notified: '' };
            return {
                lastCheck: typeof p.lastCheck === 'number' && isFinite(p.lastCheck) ? p.lastCheck : 0,
                notified: typeof p.notified === 'string' ? p.notified : '',
            };
        } catch (_) {
            return { lastCheck: 0, notified: '' };
        }
    }

    function saveUpdateMeta(meta) {
        try {
            GM_setValue(UPDATE_META_KEY, JSON.stringify({
                lastCheck: meta.lastCheck || 0,
                notified: meta.notified || '',
            }));
        } catch (_) {}
    }

    // Достаём @version из текста юзерскрипта, не исполняя его.
    function versionFromSource(text) {
        if (!text || typeof text !== 'string') return null;
        const m = text.match(/^\/\/\s*@version\s+(\S+)/m);
        return m ? m[1].trim() : null;
    }

    function fetchLatestVersion(done) {
        let finished = false;
        const finish = (ver) => {
            if (finished) return;
            finished = true;
            try { done(ver); } catch (_) {}
        };

        if (typeof GM_xmlhttpRequest !== 'function') { finish(null); return; }

        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: UPDATE_URL,
                timeout: UPDATE_TIMEOUT,
                headers: { 'Accept': 'text/plain, */*', 'Cache-Control': 'no-cache' },
                onload: (res) => {
                    let ver = null;
                    try {
                        if (res && res.status >= 200 && res.status < 300 && typeof res.responseText === 'string') {
                            ver = versionFromSource(res.responseText);
                        }
                    } catch (_) {}
                    finish(ver);
                },
                onerror: () => finish(null),
                ontimeout: () => finish(null),
                onabort: () => finish(null),
            });
        } catch (_) {
            finish(null);
        }
    }

    let _updateBanner = null;

    function removeUpdateBanner() {
        if (_updateBanner) { try { _updateBanner.remove(); } catch (_) {} _updateBanner = null; }
    }

    // Баннер собирается только через createElement/textContent (без innerHTML).
    function showUpdateBanner(latest) {
        if (_updateBanner || !document.body) return;
        if (document.getElementById('usc-update-banner')) return;

        const bar = document.createElement('div');
        bar.id = 'usc-update-banner';
        bar.setAttribute('role', 'status');
        bar.setAttribute('data-usc-hook', 'update');
        bar.style.cssText = [
            'position:fixed', 'z-index:2147483600', 'bottom:14px', 'right:14px',
            'max-width:320px', 'display:flex', 'align-items:center', 'gap:8px',
            'padding:9px 10px', 'box-sizing:border-box', 'border-radius:9px',
            'font:12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif',
            'background:#fff', 'color:#101114',
            'border:1px solid ' + accentRgba(0.35),
            'box-shadow:0 10px 28px -10px rgba(16,17,20,.35)',
        ].join(';');

        const dot = document.createElement('span');
        dot.setAttribute('aria-hidden', 'true');
        dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:' + ACCENT;

        const text = document.createElement('span');
        text.style.cssText = 'flex:1 1 auto;min-width:0';

        const label = document.createElement('span');
        label.textContent = 'CSST ' + latest + ' — обновление доступно';
        text.appendChild(label);

        const link = document.createElement('a');
        link.href = UPDATE_URL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = ' скачать';
        link.style.cssText = 'color:' + ACCENT + ';font-weight:600;text-decoration:none;white-space:nowrap';
        text.appendChild(link);

        const close = document.createElement('button');
        close.type = 'button';
        close.setAttribute('aria-label', 'Закрыть уведомление об обновлении');
        close.style.cssText = 'appearance:none;border:0;background:none;cursor:pointer;color:#82869a;'
            + 'padding:3px;border-radius:4px;flex:0 0 auto;line-height:0';
        // Иконка — настоящий SVG через createElementNS (innerHTML запрещён).
        try {
            const NS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('width', '13');
            svg.setAttribute('height', '13');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '1.8');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            const p1 = document.createElementNS(NS, 'path');
            p1.setAttribute('d', 'M4.2 4.2l7.6 7.6');
            const p2 = document.createElementNS(NS, 'path');
            p2.setAttribute('d', 'M11.8 4.2l-7.6 7.6');
            svg.appendChild(p1);
            svg.appendChild(p2);
            close.appendChild(svg);
        } catch (_) {
            close.textContent = '×';
        }
        close.addEventListener('click', removeUpdateBanner);

        bar.appendChild(dot);
        bar.appendChild(text);
        bar.appendChild(close);
        document.body.appendChild(bar);
        _updateBanner = bar;
    }

    // Одна проверка. safe=true → тихо, без баннера при ошибке.
    function checkForUpdate(opts) {
        const manual = !!(opts && opts.manual);
        if (_panelOpen) return;   // не мешаем открытой панели

        const meta = loadUpdateMeta();
        const now = Date.now();
        if (!manual && meta.lastCheck && (now - meta.lastCheck) < UPDATE_CHECK_EVERY) return;

        fetchLatestVersion((latest) => {
            // Метку времени пишем и на неудачу: не долбим сервер при сбоях.
            const m = loadUpdateMeta();
            m.lastCheck = Date.now();

            if (!latest) { saveUpdateMeta(m); if (manual) announce('Не удалось проверить обновления'); return; }

            const cmp = compareVersions(latest, SCRIPT_VERSION);
            if (cmp > 0) {
                if (manual || m.notified !== latest) {
                    m.notified = latest;
                    saveUpdateMeta(m);
                    showUpdateBanner(latest);
                } else {
                    saveUpdateMeta(m);
                }
                if (manual) announce('Доступна версия ' + latest);
            } else {
                saveUpdateMeta(m);
                if (manual) announce('Установлена последняя версия ' + SCRIPT_VERSION);
            }
        });
    }

    // Ежедневная фоновая проверка после загрузки страницы, в простое.
    function scheduleUpdateCheck() {
        const run = () => {
            try { checkForUpdate({ manual: false }); } catch (_) {}
        };
        try {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(run, { timeout: 5000 });
            } else {
                setTimeout(run, 4000);
            }
        } catch (_) {
            setTimeout(run, 4000);
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       14. ИНИЦИАЛИЗАЦИЯ, SPA-ПОДДЕРЖКА, НАБЛЮДАТЕЛЬ
       ═══════════════════════════════════════════════════════════════════════ */

    let _disabled = false;
    let _applyTimer = null;
    let _observer = null;
    let _observerArmed = false;   // защита от цикла observer → change → observer
    let _observedUrl = location.href;

    function scheduleApply(delay) {
        if (_disabled) return;
        clearTimeout(_applyTimer);
        _applyTimer = setTimeout(() => {
            if (_disabled) return;
            applyConfig();
        }, typeof delay === 'number' ? delay : 300);
    }

    function nodeHasNavLink(node) {
        if (!node || node.nodeType !== 1) return false;
        if (isOwnEl(node)) return false;
        if (node.matches && node.matches('a[href]')) return !!classifyEl(node);
        if (!node.querySelectorAll) return false;
        for (const a of node.querySelectorAll('a[href]')) {
            if (classifyEl(a)) return true;
        }
        return false;
    }

    /* Колбэк наблюдателя максимально дешёвый: только обход addedNodes и
       проверка пары атрибутов. Никаких querySelectorAll по документу.

       Защита от петли «наблюдатель → наше изменение → наблюдатель» —
       «тихое окно»: после каждого прохода applyConfig наблюдатель на 400 мс
       игнорирует всё, что мы сами натворили. Плюс _observerArmed на время
       обработки пачки. */
    let _quietUntil = 0;

    function onMutations(muts) {
        if (_disabled) return;
        if (_observerArmed) { scheduleApply(500); return; }
        if (Date.now() < _quietUntil) return;

        if (location.href !== _observedUrl) {
            _observedUrl = location.href;
            scheduleApply(420);
            return;
        }

        let missingGear = false;
        let navChanged = false;

        for (let i = 0; i < muts.length; i++) {
            const m = muts[i];

            for (let j = 0; j < m.removedNodes.length; j++) {
                const node = m.removedNodes[j];
                if (node.nodeType !== 1) continue;
                // Обёртку и поддерево тоже считаем пропажей кнопки: страницы
                // перерисовывают строку вкладок целиком, а не по одному узлу.
                // Обёртки кастомных кнопок кнопку не содержат — их удаление
                // (в том числе наше собственное) сюда не попадает.
                if (node.id === 'usc-gear-btn'
                    || (node.getAttribute && node.getAttribute('data-usc-hook') === 'trigger')
                    || (node.querySelector && node.querySelector('#usc-gear-btn'))) {
                    missingGear = true;
                    break;
                }
            }
            if (missingGear) break;

            // Наши собственные контейнеры игнорируем по атрибуту, без closest().
            const tgt = m.target;
            if (tgt && tgt.nodeType === 1) {
                if (tgt.id === 'usc-gear-btn' || tgt.id === 'usc-ui-host') continue;
                if (tgt.getAttribute && (tgt.getAttribute('data-usc-hook')
                    || tgt.getAttribute('data-usc-inject-wrap')
                    || tgt.getAttribute('data-usc-custom'))) continue;
            }

            for (let j = 0; j < m.addedNodes.length; j++) {
                const node = m.addedNodes[j];
                if (node.nodeType !== 1) continue;
                if (node.id === 'usc-gear-btn' || node.id === 'usc-ui-host') continue;
                if (node.getAttribute && node.getAttribute('data-usc-inject-wrap')) continue;
                if (nodeHasNavLink(node)) { navChanged = true; break; }
            }
            if (navChanged) break;
        }

        if (missingGear || navChanged) scheduleApply(360);
    }

    // Пауза для наблюдателя после наших собственных записей в DOM.
    function markQuiet() { _quietUntil = Date.now() + 400; }

    function startObserver() {
        if (_disabled || _observer) return;
        if (!document.body) return;
        _observer = new MutationObserver(muts => {
            if (_observerArmed) return;
            _observerArmed = true;
            try { onMutations(muts); } finally {
                // Снимаем флаг в следующем микротаске: наши изменения DOM,
                // вызванные этим проходом, не должны снова нас будить.
                setTimeout(() => { _observerArmed = false; }, 0);
            }
        });
        try {
            _observer.observe(document.body, { childList: true, subtree: true });
        } catch (_) {}
    }

    function removeInjected() {
        _disabled = true;
        if (_observer) { try { _observer.disconnect(); } catch (_) {} _observer = null; }
        clearTimeout(_applyTimer);
        clearTimeout(_trayHideTimer);
        const tray = document.querySelector('[data-usc-hook="tray"]');
        if (tray) tray.remove();
        document.querySelectorAll('[data-usc-custom]').forEach(el => {
            const wrap = el.closest('[data-usc-inject-wrap]');
            (wrap || el).remove();
        });
        const gear = document.getElementById('usc-gear-btn');
        if (gear) {
            const unit = gear.closest('[data-usc-hook="trigger"]');
            const wrap = gear.closest('[data-usc-inject-wrap]');
            (wrap || unit || gear).remove();
        }
        const host = document.getElementById('usc-ui-host');
        if (host) host.remove();
        const panel = document.getElementById('usc-panel');
        if (panel) panel.remove();
        if (_liveRegion) { _liveRegion.remove(); _liveRegion = null; }
        uiRoot = null;
        _panelOpen = false;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       15. СТАРТ
       ═══════════════════════════════════════════════════════════════════════ */

    GM_addStyle(navCss());

    if (typeof GM_registerMenuCommand === 'function') {
        try {
            GM_registerMenuCommand(t('gearTitle'), openPanel);
            GM_registerMenuCommand('Проверить обновления', function () { checkForUpdate({ manual: true }); });
            GM_registerMenuCommand('Диагностика', function () {
                try {
                    const text = diagnosticsText();
                    // Никакого innerHTML: только textContent в созданном узле.
                    let box = document.getElementById('usc-diag');
                    if (box) box.remove();
                    box = document.createElement('pre');
                    box.id = 'usc-diag';
                    box.textContent = text;
                    box.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;max-height:60vh;overflow:auto;'
                        + 'z-index:2147483647;margin:0;padding:12px;border-radius:8px;'
                        + 'font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;'
                        + 'background:#16181d;color:#e8e8e8;border:1px solid ' + accentRgba(0.5);
                    box.addEventListener('click', () => box.remove());
                    box.title = 'Клик — закрыть';
                    document.body.appendChild(box);
                } catch (_) {}
            });
            GM_registerMenuCommand(t('removeButton'), removeInjected);
        } catch (_) {}
    }

    function init() {
        applyConfig();
        startObserver();
        scheduleUpdateCheck();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

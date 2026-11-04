// ==UserScript==
// @name         Custom Search System Tabs
// @namespace    https://github.com/diple-df/CSST-tampermonkey-script
// @version      1.2.0
// @description  Скрывай, переименовывай, перенаправляй и добавляй кнопки-вкладки поиска. Работает в Google, Яндекс, Bing и DuckDuckGo. Поддержка {query} для подстановки запроса.
// @author       diple_df x claude
// @match        *://duckduckgo.com/*
// @match        *://*.duckduckgo.com/*
// @match        *://www.google.com/*
// @match        *://www.google.ru/*
// @match        *://*.bing.com/*
// @match        *://yandex.ru/*
// @match        *://*.yandex.ru/*
// @match        *://yandex.com/*
// @match        *://*.yandex.com/*
// @match        *://ya.ru/*
// @match        *://*.ya.ru/*
// @include      /^https?:\/\/(www\.)?google\.[a-z.]+\//
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/diple-df/CSST-tampermonkey-script/main/csst_tmprmnk.user.js
// @updateURL    https://raw.githubusercontent.com/diple-df/CSST-tampermonkey-script/main/csst_tmprmnk.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ─── ОПРЕДЕЛЕНИЕ ПОИСКОВОЙ СИСТЕМЫ ───────────────────────────────────────

    function urlOf(a) {
        const href = a.getAttribute('href') || '';
        if (!href) return null;
        try { return new URL(href, location.origin); } catch (_) { return null; }
    }

    const ENGINES = {
        duckduckgo: {
            name: 'DuckDuckGo',
            accent: '#de5833',
            queryParam: 'q',
            storageKey: 'usc_cfg_ddg',
            test: h => /(^|\.)duckduckgo\.com$/i.test(h),
            nav: {
                container: () => document.querySelector('#react-duckbar nav ul'),
                wrap: 'li',
                linkClass: 'kFFXe30DOpq5j1hbWU1q wZ4JdaHxSAhGy1HoNVja d26Geqs1C__RaCO7MUs2',
            },
            classify(a) {
                const url = urlOf(a);
                if (!url) return null;
                const p = url.searchParams;
                const ia = p.get('ia'), iax = p.get('iax'), iaxm = p.get('iaxm');
                if (iaxm === 'maps' || ia === 'maps') return 'maps';
                if (iax === 'images' || ia === 'images') return 'images';
                if (iax === 'videos' || ia === 'videos') return 'videos';
                if (ia === 'news') return 'news';
                if (ia === 'shopping') return 'shopping';
                if (ia === 'web') return 'web';
                if (p.has('q') && !ia && !iax && !iaxm) return 'web';
                return null;
            },
        },

        google: {
            name: 'Google',
            accent: '#4285f4',
            queryParam: 'q',
            storageKey: 'usc_cfg_google',
            test: h => /(^|\.)google\.[a-z.]+$/i.test(h),
            nav: {
                container: () => document.querySelector('div.beZ0tf[role="list"]'),
                wrap: 'div',
                wrapRole: 'listitem',
                linkClass: 'C6AK7c',
            },
            classify(a) {
                const url = urlOf(a);
                if (!url) return null;
                if (/maps\.google\./i.test(url.hostname) || /^\/maps(\/|$)/.test(url.pathname))
                    return 'maps';
                if (!/^\/search/.test(url.pathname) && url.pathname !== '/') return null;
                const p = url.searchParams;
                const tbm = p.get('tbm'), udm = p.get('udm');
                if (tbm === 'isch' || udm === '2') return 'images';
                if (tbm === 'vid' || udm === '7') return 'videos';
                if (tbm === 'nws' || udm === '12') return 'news';
                if (tbm === 'shop' || udm === '28') return 'shopping';
                if (p.has('q') && !tbm && !udm) return 'web';
                return null;
            },
        },

        bing: {
            name: 'Bing',
            accent: '#008373',
            queryParam: 'q',
            storageKey: 'usc_cfg_bing',
            test: h => /(^|\.)bing\.com$/i.test(h),
            nav: {
                container: () => document.querySelector('nav.b_scopebar > ul'),
                wrap: 'li',
                linkClass: '',
            },
            classify(a) {
                const li = a.closest && a.closest('li[id^="b-scopeListItem-"]');
                if (li) {
                    const id = li.id;
                    if (/-web$/.test(id))    return 'web';
                    if (/-images$/.test(id)) return 'images';
                    if (/-video/.test(id))   return 'videos';
                    if (/-local$/.test(id))  return 'maps';
                    if (/-news$/.test(id))   return 'news';
                    if (/-shop/.test(id))    return 'shopping';
                    return null;
                }
                const url = urlOf(a);
                if (!url) return null;
                const path = url.pathname;
                if (/^\/images\/search/i.test(path)) return 'images';
                if (/^\/videos\/search/i.test(path)) return 'videos';
                if (/^\/maps/i.test(path)) return 'maps';
                if (/^\/news\/search/i.test(path)) return 'news';
                if (/^\/shop/i.test(path)) return 'shopping';
                if (/^\/search/i.test(path) && url.searchParams.has('q')) return 'web';
                return null;
            },
        },

        yandex: {
            name: 'Яндекс',
            accent: '#fc3f1d',
            queryParam: 'text',
            storageKey: 'usc_cfg_yandex',
            test: h => /(^|\.)yandex\.(ru|com|by|kz|ua|com\.tr)$/i.test(h) || /(^|\.)ya\.ru$/i.test(h),
            nav: {
                container: () => document.querySelector('nav.HeaderNav'),
                wrap: null,
                linkClass: 'HeaderNav-Tab HeaderNav-Item',
            },
            classify(a) {
                const url = urlOf(a);
                if (!url) return null;
                const host = url.hostname, path = url.pathname, p = url.searchParams;
                if (/(^|\.)market\.yandex\./i.test(host) || /^\/market/.test(path)) return 'shopping';
                if (p.get('products_mode') === '1' || /^\/products/.test(path)) return 'shopping';
                if (/^\/images/i.test(path)) return 'images';
                if (/^\/video/i.test(path)) return 'videos';
                if (/^\/maps/i.test(path)) return 'maps';
                if (/(^|\.)dzen\.ru$/i.test(host) || /^\/news/i.test(path)) return 'news';
                if (/(^|\.)ya\.ru$/i.test(host) && p.has('source')) return 'web';
                if (/^\/search/i.test(path) && p.has('text')) return 'web';
                return null;
            },
        },
    };

    const ENGINE = (() => {
        const h = location.hostname;
        for (const key of Object.keys(ENGINES)) {
            if (ENGINES[key].test(h)) return ENGINES[key];
        }
        return null;
    })();

    if (!ENGINE) return;

    // ─── ЛОКАЛИЗАЦИЯ ──────────────────────────────────────────────────────────

    function detectLang() {
        const raw = document.documentElement.getAttribute('lang')
                 || document.documentElement.getAttribute('xml:lang')
                 || (navigator.language || navigator.userLanguage)
                 || 'en';
        return String(raw).toLowerCase().split('-')[0];
    }

    const I18N = {
        en: { title:'Tab Customizer', standard:'Standard tabs', custom:'Custom buttons',
              queryHint:'· {query} inserts query', add:'+ Add button', reset:'Reset',
              cancel:'Cancel', save:'Save', hide:'Hide', labelField:'Label',
              presetField:'Preset service', presetPlaceholder:'— select preset —',
              original:'↩ Original tab', redirectField:'Redirect URL', redirectHint:'· empty = original',
              namePlaceholder:'Name', urlPlaceholder:'https://…?q={query}',
              empty:'No navigation tabs found on this page.',
              resetConfirm:'Reset all settings to defaults?', gearTitle:'Customize search tabs', del:'Delete',
              tabs:{web:'Web',images:'Images',videos:'Videos',maps:'Maps',news:'News',shopping:'Shopping'} },
        ru: { title:'Настройка вкладок', standard:'Стандартные вкладки', custom:'Кастомные кнопки',
              queryHint:'· {query} подставляет запрос', add:'+ Добавить кнопку', reset:'Сбросить',
              cancel:'Отмена', save:'Сохранить', hide:'Скрыть', labelField:'Подпись',
              presetField:'Быстрый выбор сервиса', presetPlaceholder:'— выберите пресет —',
              original:'↩ Оригинальная вкладка', redirectField:'URL редиректа', redirectHint:'· пусто = оригинал',
              namePlaceholder:'Название', urlPlaceholder:'https://…?q={query}',
              empty:'Вкладки навигации на этой странице не найдены.',
              resetConfirm:'Сбросить все настройки к значениям по умолчанию?', gearTitle:'Настроить вкладки поиска', del:'Удалить',
              tabs:{web:'Веб',images:'Изображения',videos:'Видео',maps:'Карты',news:'Новости',shopping:'Товары'} },
        uk: { title:'Налаштування вкладок', standard:'Стандартні вкладки', custom:'Власні кнопки',
              queryHint:'· {query} підставляє запит', add:'+ Додати кнопку', reset:'Скинути',
              cancel:'Скасувати', save:'Зберегти', hide:'Сховати', labelField:'Підпис',
              presetField:'Швидкий вибір сервісу', presetPlaceholder:'— виберіть пресет —',
              original:'↩ Оригінальна вкладка', redirectField:'URL переходу', redirectHint:'· порожньо = оригінал',
              namePlaceholder:'Назва', urlPlaceholder:'https://…?q={query}',
              empty:'Вкладки навігації на цій сторінці не знайдено.',
              resetConfirm:'Скинути всі налаштування до типових?', gearTitle:'Налаштувати вкладки пошуку', del:'Видалити',
              tabs:{web:'Веб',images:'Зображення',videos:'Відео',maps:'Карти',news:'Новини',shopping:'Покупки'} },
        de: { title:'Tabs anpassen', standard:'Standard-Tabs', custom:'Eigene Schaltflächen',
              queryHint:'· {query} fügt Suchanfrage ein', add:'+ Hinzufügen', reset:'Zurücksetzen',
              cancel:'Abbrechen', save:'Speichern', hide:'Ausblenden', labelField:'Beschriftung',
              presetField:'Schnellauswahl Dienst', presetPlaceholder:'— Vorlage wählen —',
              original:'↩ Original-Tab', redirectField:'Weiterleitung', redirectHint:'· leer = Original',
              namePlaceholder:'Name', urlPlaceholder:'https://…?q={query}',
              empty:'Keine Navigations-Tabs gefunden.',
              resetConfirm:'Alle Einstellungen zurücksetzen?', gearTitle:'Such-Tabs anpassen', del:'Löschen',
              tabs:{web:'Web',images:'Bilder',videos:'Videos',maps:'Karten',news:'News',shopping:'Shopping'} },
        fr: { title:'Personnaliser', standard:'Onglets standard', custom:'Boutons personnalisés',
              queryHint:'· {query} insère la requête', add:'+ Ajouter', reset:'Réinitialiser',
              cancel:'Annuler', save:'Enregistrer', hide:'Masquer', labelField:'Libellé',
              presetField:'Service rapide', presetPlaceholder:'— préréglage —',
              original:'↩ Original', redirectField:'Redirection URL', redirectHint:'· vide = original',
              namePlaceholder:'Nom', urlPlaceholder:'https://…?q={query}',
              empty:'Aucun onglet trouvé.',
              resetConfirm:'Réinitialiser tous les réglages ?', gearTitle:'Personnaliser les onglets', del:'Supprimer',
              tabs:{web:'Web',images:'Images',videos:'Vidéos',maps:'Cartes',news:'Actualités',shopping:'Shopping'} },
        es: { title:'Personalizar', standard:'Pestañas estándar', custom:'Botones personalizados',
              queryHint:'· {query} inserta consulta', add:'+ Añadir', reset:'Restablecer',
              cancel:'Cancelar', save:'Guardar', hide:'Ocultar', labelField:'Etiqueta',
              presetField:'Servicio rápido', presetPlaceholder:'— preajuste —',
              original:'↩ Original', redirectField:'Redirección URL', redirectHint:'· vacío = original',
              namePlaceholder:'Nombre', urlPlaceholder:'https://…?q={query}',
              empty:'No se encontraron pestañas.',
              resetConfirm:'¿Restablecer configuración?', gearTitle:'Personalizar pestañas', del:'Eliminar',
              tabs:{web:'Web',images:'Imágenes',videos:'Vídeos',maps:'Mapas',news:'Noticias',shopping:'Compras'} },
        pt: { title:'Personalizar', standard:'Abas padrão', custom:'Botões personalizados',
              queryHint:'· {query} insere consulta', add:'+ Adicionar', reset:'Redefinir',
              cancel:'Cancelar', save:'Salvar', hide:'Ocultar', labelField:'Rótulo',
              presetField:'Serviço rápido', presetPlaceholder:'— predefinição —',
              original:'↩ Original', redirectField:'Redirecionamento', redirectHint:'· vazio = original',
              namePlaceholder:'Nome', urlPlaceholder:'https://…?q={query}',
              empty:'Nenhuma aba encontrada.',
              resetConfirm:'Redefinir configurações?', gearTitle:'Personalizar abas', del:'Excluir',
              tabs:{web:'Web',images:'Imagens',videos:'Vídeos',maps:'Mapas',news:'Notícias',shopping:'Compras'} },
        tr: { title:'Özelleştir', standard:'Standart sekmeler', custom:'Özel düğmeler',
              queryHint:'· {query} sorguyu ekler', add:'+ Ekle', reset:'Sıfırla',
              cancel:'İptal', save:'Kaydet', hide:'Gizle', labelField:'Etiket',
              presetField:'Hızlı servis', presetPlaceholder:'— seçin —',
              original:'↩ Orijinal', redirectField:'Yönlendirme URL', redirectHint:'· boş = orijinal',
              namePlaceholder:'Ad', urlPlaceholder:'https://…?q={query}',
              empty:'Sekme bulunamadı.',
              resetConfirm:'Ayarlar sıfırlansın mı?', gearTitle:'Sekmeleri özelleştir', del:'Sil',
              tabs:{web:'Web',images:'Görseller',videos:'Videolar',maps:'Haritalar',news:'Haberler',shopping:'Alışveriş'} },
        it: { title:'Personalizza', standard:'Schede standard', custom:'Pulsanti personalizzati',
              queryHint:'· {query} inserisce query', add:'+ Aggiungi', reset:'Reimposta',
              cancel:'Annulla', save:'Salva', hide:'Nascondi', labelField:'Etichetta',
              presetField:'Servizio rapido', presetPlaceholder:'— preset —',
              original:'↩ Originale', redirectField:'URL reindirizzamento', redirectHint:'· vuoto = originale',
              namePlaceholder:'Nome', urlPlaceholder:'https://…?q={query}',
              empty:'Nessuna scheda trovata.',
              resetConfirm:'Reimpostare tutto?', gearTitle:'Personalizza schede', del:'Elimina',
              tabs:{web:'Web',images:'Immagini',videos:'Video',maps:'Mappe',news:'Notizie',shopping:'Shopping'} },
        pl: { title:'Dostosuj', standard:'Karty standardowe', custom:'Własne przyciski',
              queryHint:'· {query} wstawia zapytanie', add:'+ Dodaj', reset:'Resetuj',
              cancel:'Anuluj', save:'Zapisz', hide:'Ukryj', labelField:'Etykieta',
              presetField:'Szybka usługa', presetPlaceholder:'— wybierz —',
              original:'↩ Oryginał', redirectField:'URL przekierowania', redirectHint:'· puste = oryginał',
              namePlaceholder:'Nazwa', urlPlaceholder:'https://…?q={query}',
              empty:'Nie znaleziono kart.',
              resetConfirm:'Zresetować ustawienia?', gearTitle:'Dostosuj karty', del:'Usuń',
              tabs:{web:'Sieć',images:'Grafika',videos:'Wideo',maps:'Mapy',news:'Wiadomości',shopping:'Zakupy'} },
    };

    const CLOSE = { en:'Close', ru:'Закрыть', uk:'Закрити', de:'Schließen', fr:'Fermer', es:'Cerrar', pt:'Fechar', tr:'Kapat', it:'Chiudi', pl:'Zamknij' };
    Object.keys(I18N).forEach(k => { I18N[k].close = CLOSE[k] || 'Close'; });

    const USER_LANG = I18N[detectLang()] ? detectLang() : 'en';
    function L() { return I18N[USER_LANG] || I18N.en; }
    function t(key) { const v = L()[key]; return v != null ? v : I18N.en[key]; }

    // ─── КОНФИГУРАЦИЯ ПО УМОЛЧАНИЮ ────────────────────────────────────────────

    const DEFAULT_CONFIG = (() => {
        const TL = L().tabs;
        return {
            tabs: {
                web:      { hidden: false, label: TL.web,      redirectUrl: null },
                images:   { hidden: false, label: TL.images,   redirectUrl: null },
                videos:   { hidden: false, label: TL.videos,   redirectUrl: null },
                maps:     { hidden: false, label: TL.maps,      redirectUrl: null },
                news:     { hidden: false, label: TL.news,      redirectUrl: null },
                shopping: { hidden: false, label: TL.shopping,  redirectUrl: null },
            },
            customTabs: [],
        };
    })();

    // ─── ПРЕСЕТЫ СЕРВИСОВ ─────────────────────────────────────────────────────

    const PRESETS_COMMON = {
        web: [
            { name: 'Google',     url: 'https://www.google.com/search?q={query}' },
            { name: 'Bing',       url: 'https://www.bing.com/search?q={query}' },
            { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
            { name: 'Startpage',  url: 'https://www.startpage.com/sp/search?query={query}' },
            { name: 'Brave',      url: 'https://search.brave.com/search?q={query}' },
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
    };

    function buildPresets(lang) {
        const cats = ['web', 'images', 'videos', 'maps', 'news', 'shopping'];
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

    const PRESETS = buildPresets(USER_LANG);

    // ─── ХРАНИЛИЩЕ НАСТРОЕК ────────────────────────────────────────────────────

    function loadConfig() {
        try {
            const raw = GM_getValue(ENGINE.storageKey, null);
            if (!raw) return deepClone(DEFAULT_CONFIG);
            const parsed = JSON.parse(raw);
            if (!parsed.customTabs) parsed.customTabs = [];
            if (!parsed.tabs) parsed.tabs = {};
            Object.keys(DEFAULT_CONFIG.tabs).forEach(k => {
                if (!parsed.tabs[k]) parsed.tabs[k] = deepClone(DEFAULT_CONFIG.tabs[k]);
            });
            return parsed;
        } catch (e) {
            return deepClone(DEFAULT_CONFIG);
        }
    }

    function saveConfig(cfg) { GM_setValue(ENGINE.storageKey, JSON.stringify(cfg)); }
    function deepClone(obj)  { return JSON.parse(JSON.stringify(obj)); }

    // ─── ТЁМНАЯ ТЕМА ──────────────────────────────────────────────────────────

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

    // ─── ЗАПРОС И НАВИГАЦИЯ ───────────────────────────────────────────────────

    function getQuery() {
        return new URLSearchParams(window.location.search).get(ENGINE.queryParam) || '';
    }

    function isOwnEl(el) {
        return el.id === 'usc-gear-btn' || el.hasAttribute('data-usc-custom')
            || el.hasAttribute('data-usc-inject-wrap') || !!el.closest('#usc-panel');
    }

    function classifyEl(el) {
        if (isOwnEl(el)) return null;
        return el.getAttribute('data-usc-key') || ENGINE.classify(el);
    }

    function isVisible(el) {
        return !!(el.getClientRects && el.getClientRects().length);
    }

    function classifiedLinks(visibleOnly) {
        const out = [];
        document.querySelectorAll('a[href], [data-usc-key]').forEach(el => {
            if (!classifyEl(el)) return;
            if (visibleOnly && !isVisible(el)) return;
            out.push(el);
        });
        return out;
    }

    function findNavContainerFrom(links) {
        if (!links.length) return null;
        const keysByEl = new Map();
        links.forEach(link => {
            const key = classifyEl(link);
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

    function findNavContainer() {
        return findNavContainerFrom(classifiedLinks(true))
            || findNavContainerFrom(classifiedLinks(false));
    }

    function navContainer() {
        if (ENGINE.nav && ENGINE.nav.container) {
            const c = ENGINE.nav.container();
            if (c) return c;
        }
        return findNavContainer();
    }

    function cleanLabel(el) {
        const spans = [...el.querySelectorAll('span')]
            .filter(s => s.children.length === 0 && s.textContent.trim());
        let t = spans.length ? spans[spans.length - 1].textContent : el.textContent;
        t = (t || '').replace(/\s+/g, ' ').trim();
        return t.length > 40 ? t.slice(0, 40).trim() : t;
    }

    function syntheticKey(a) {
        const li = a.closest('li[id]');
        if (li && li.id) return 'x:' + li.id.toLowerCase();
        const u = urlOf(a);
        if (u) {
            const interesting = ['udm', 'tbm', 'ia', 'iax', 'iaxm', 'products_mode', 'scope', 'mode', 'm', 'lr'];
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
        const c = ENGINE.classify(a);
        if (c) return c;
        return syntheticKey(a);
    }

    function tabEls(container) {
        return [...container.querySelectorAll('a')].filter(a => {
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
            found.push({ key, label: cleanLabel(el) });
        });
        return found;
    }

    // ─── ПРИМЕНЕНИЕ КОНФИГУРАЦИИ ──────────────────────────────────────────────

    let isApplying = false;

    function applyConfig() {
        if (isApplying) return;
        isApplying = true;
        try { _applyConfig(); } finally { isApplying = false; }
    }

    function _applyConfig() {
        const cfg = loadConfig();
        const container = navContainer();
        if (!container) return;

        const seen = new Set();
        tabEls(container).forEach(link => {
            const key = keyOf(link);
            if (!key || seen.has(key)) return;
            seen.add(key);

            const tabCfg = cfg.tabs[key];
            if (!tabCfg) { showTab(link); return; }

            if (tabCfg.hidden) { hideTab(link, container); return; }
            showTab(link);

            const canonical = DEFAULT_CONFIG.tabs[key] ? DEFAULT_CONFIG.tabs[key].label : key;
            if (tabCfg.label && tabCfg.label !== canonical) setLinkText(link, tabCfg.label);

            if (tabCfg.redirectUrl) applyRedirect(link, key, tabCfg.redirectUrl);
            else if (link.hasAttribute('data-usc-redirect')) clearRedirect(link);
        });

        injectItems(cfg, container);
    }

    function hideTab(link, container) {
        link.style.setProperty('display', 'none', 'important');
        link.setAttribute('data-usc-hidden', '1');
        const p = link.parentElement;
        if (p && p !== container && p !== document.body && p !== document.documentElement) {
            const sib = [...p.querySelectorAll('a')].filter(a => !isOwnEl(a) && cleanLabel(a));
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
            link.setAttribute('data-usc-orig', link.getAttribute('href') || '');
        }
        const resolved = redirectUrl.replace(/\{query\}/g, encodeURIComponent(getQuery()));
        link.setAttribute('data-usc-key', key);
        link.setAttribute('data-usc-redirect', redirectUrl);
        link.setAttribute('data-usc-target', resolved);
        link.href = resolved;
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
        if (link.hasAttribute('data-usc-orig')) {
            const orig = link.getAttribute('data-usc-orig');
            if (orig) link.href = orig; else link.removeAttribute('href');
            link.removeAttribute('data-usc-orig');
        }
        link.removeAttribute('data-usc-redirect');
        link.removeAttribute('data-usc-target');
        link.removeAttribute('data-usc-key');
    }

    function setLinkText(link, text) {
        const leaves = [...link.querySelectorAll('span, div')]
            .filter(e => e.children.length === 0 && e.textContent.trim());
        if (leaves.length) { leaves.forEach(e => { e.textContent = text; }); return; }
        const node = [...link.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        if (node) node.textContent = text;
        else link.textContent = text;
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

    function wrapInjected(inner) {
        const nav = ENGINE.nav || {};
        if (!nav.wrap) return inner;
        const w = document.createElement(nav.wrap);
        if (nav.itemClass) w.className = nav.itemClass;
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

    function buildGearButton() {
        const btn = document.createElement('button');
        btn.id    = 'usc-gear-btn';
        btn.type  = 'button';
        btn.title = t('gearTitle') + ' (' + ENGINE.name + ')';
        btn.innerHTML = `<span class="usc-ham"><span></span><span></span><span></span></span>`;
        btn.onclick = openPanel;
        return btn;
    }

    function injectItems(cfg, container) {
        if (!container) container = navContainer();
        if (!container) return;

        document.querySelectorAll('[data-usc-custom]').forEach(el => {
            const wrap = el.closest('[data-usc-inject-wrap]');
            (wrap || el).remove();
        });

        const q = getQuery();
        (cfg.customTabs || []).forEach(tab => {
            container.appendChild(wrapInjected(buildCustomAnchor(tab, q)));
        });

        let gear = document.getElementById('usc-gear-btn');
        if (!gear) {
            container.appendChild(wrapInjected(buildGearButton()));
        } else {
            const node = gear.closest('[data-usc-inject-wrap]') || gear;
            if (node.parentElement !== container || node !== container.lastElementChild) {
                container.appendChild(node);
            }
        }
    }

    // ─── ПАНЕЛЬ НАСТРОЕК ──────────────────────────────────────────────────────

    function openPanel() {
        if (document.getElementById('usc-panel')) return;

        const cfg = loadConfig();

        const panel = document.createElement('div');
        panel.id = 'usc-panel';
        if (isDarkTheme()) panel.classList.add('usc-dark');
        panel.innerHTML = buildPanelHTML();
        document.body.appendChild(panel);

        renderTabRows(cfg, detectTabs());
        renderCustomRows(cfg);
        bindPanelEvents(cfg);
    }

    function buildPanelHTML() {
        return `
        <div class="usc-backdrop"></div>
        <div class="usc-modal">
            <div class="usc-head">
                <div class="usc-head-inner">
                    <span class="usc-head-icon"><span></span><span></span><span></span></span>
                    <span class="usc-title">${escHtml(t('title'))}</span>
                </div>
                <button class="usc-close" id="usc-close">✕</button>
            </div>
            <div class="usc-body">
                <div class="usc-section-title">${escHtml(t('standard'))}</div>
                <div id="usc-tab-rows"></div>
                <div class="usc-section-title" style="margin-top:12px">
                    <span>${escHtml(t('custom'))}</span>
                    <span class="usc-hint">${escHtml(t('queryHint'))}</span>
                </div>
                <div id="usc-custom-rows"></div>
                <button class="usc-btn usc-btn-add" id="usc-add-custom">${escHtml(t('add'))}</button>
            </div>
            <div class="usc-foot">
                <button class="usc-btn usc-btn-reset" id="usc-reset">${escHtml(t('reset'))}</button>
                <button class="usc-btn usc-btn-save" id="usc-close-2">${escHtml(t('close'))}</button>
            </div>
        </div>`;
    }

    function renderTabRows(cfg, detected) {
        const container = document.getElementById('usc-tab-rows');
        container.innerHTML = '';

        let list = (detected && detected.length)
            ? detected
            : Object.keys(cfg.tabs).map(key => ({ key, label: '' }));

        if (!list.length) {
            container.innerHTML = `<div class="usc-empty">${escHtml(t('empty'))}</div>`;
            return;
        }

        list.forEach(({ key, label: nativeLabel }) => {
            if (!cfg.tabs[key]) cfg.tabs[key] = deepClone(DEFAULT_CONFIG.tabs[key] || { hidden: false, label: key, redirectUrl: null });
            const tab = cfg.tabs[key];

            const canonical = DEFAULT_CONFIG.tabs[key] ? DEFAULT_CONFIG.tabs[key].label : key;
            const customized = tab.label && tab.label !== canonical;
            const display = customized ? tab.label : (nativeLabel || canonical);
            const presets = PRESETS[key] || [];

            const presetsEl = presets.length ? `
                <div class="usc-field">
                    <label>${escHtml(t('presetField'))}</label>
                    <select class="usc-preset" data-key="${key}">
                        <option value="">${escHtml(t('presetPlaceholder'))}</option>
                        ${presets.map(p => `<option value="${escHtml(p.url)}">${escHtml(p.name)}</option>`).join('')}
                        <option value="__default__">${escHtml(t('original'))}</option>
                    </select>
                </div>` : '';

            const row = document.createElement('div');
            row.className = 'usc-tab-row' + (tab.hidden ? ' usc-hidden-row' : '');
            row.dataset.key    = key;
            row.dataset.native = nativeLabel || '';
            row.innerHTML = `
                <div class="usc-tab-header">
                    <span class="usc-tab-name">${escHtml(display)}</span>
                    <label class="usc-hide-label" title="${escHtml(t('hide'))}">
                        <span class="usc-hide-text">${escHtml(t('hide'))}</span>
                        <span class="usc-switch">
                            <input type="checkbox" class="usc-hide-cb" data-key="${key}" ${tab.hidden ? 'checked' : ''}>
                            <span class="usc-switch-sl"></span>
                        </span>
                    </label>
                </div>
                <div class="usc-tab-fields">
                    <div class="usc-field">
                        <label>${escHtml(t('labelField'))}</label>
                        <input type="text" class="usc-label-inp" data-key="${key}" value="${escHtml(display)}" placeholder="${escHtml(t('namePlaceholder'))}">
                    </div>
                    ${presetsEl}
                    <div class="usc-field">
                        <label>${escHtml(t('redirectField'))} <span class="usc-hint">${escHtml(t('redirectHint'))}</span></label>
                        <input type="text" class="usc-url-inp" data-key="${key}" value="${escHtml(tab.redirectUrl || '')}" placeholder="${escHtml(t('urlPlaceholder'))}">
                    </div>
                </div>`;
            container.appendChild(row);

            const cb = row.querySelector('.usc-hide-cb');
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    row.classList.add('usc-hidden-row');
                } else {
                    row.classList.remove('usc-hidden-row');
                }
            });
        });

        container.querySelectorAll('.usc-preset').forEach(sel => {
            sel.addEventListener('change', () => {
                const inp = container.querySelector(`.usc-url-inp[data-key="${sel.dataset.key}"]`);
                if (sel.value === '__default__') inp.value = '';
                else if (sel.value)              inp.value = sel.value;
                sel.value = '';
            });
        });
    }

    let _customCounter = 1;

    function renderCustomRows(cfg) {
        const container = document.getElementById('usc-custom-rows');
        container.innerHTML = '';
        (cfg.customTabs || []).forEach(ct => appendCustomRow(ct.label, ct.url, ct.id));
    }

    function appendCustomRow(label = '', url = '', id = null) {
        const container = document.getElementById('usc-custom-rows');
        const rowId = id || ('custom_' + (typeof performance !== 'undefined' ? Math.floor(performance.now()) : _customCounter) + '_' + (_customCounter++));

        const row = document.createElement('div');
        row.className = 'usc-custom-row';
        row.dataset.id = rowId;
        row.innerHTML = `
            <div class="usc-custom-inputs">
                <input type="text" class="usc-ci-label" placeholder="${escHtml(t('namePlaceholder'))}" value="${escHtml(label)}">
                <input type="text" class="usc-ci-url"   placeholder="${escHtml(t('urlPlaceholder'))}" value="${escHtml(url)}">
            </div>
            <button class="usc-btn usc-btn-del usc-del-custom" title="${escHtml(t('del'))}">✕</button>`;

        row.querySelector('.usc-del-custom').onclick = () => {
            row.style.transform = 'scale(0.95)';
            row.style.opacity = '0';
            setTimeout(() => {
                row.remove();
                const cfg = loadConfig();
                collectAndSave(cfg);
                applyConfig();
            }, 150);
        };
        container.appendChild(row);
    }

    let _liveTimer = null;
    function liveSave(cfg) {
        clearTimeout(_liveTimer);
        _liveTimer = setTimeout(() => { collectAndSave(cfg); applyConfig(); }, 180);
    }

    function bindPanelEvents(cfg) {
        const panel = document.getElementById('usc-panel');
        const close = () => {
            panel.classList.add('usc-closing');
            setTimeout(() => panel.remove(), 180);
        };

        panel.querySelector('.usc-backdrop').onclick = close;
        document.getElementById('usc-close').onclick   = close;
        document.getElementById('usc-close-2').onclick = close;
        document.getElementById('usc-add-custom').onclick = () => {
            appendCustomRow();
            const rows = panel.querySelectorAll('.usc-custom-row');
            if (rows.length) {
                const lastInp = rows[rows.length - 1].querySelector('.usc-ci-label');
                if (lastInp) lastInp.focus();
            }
        };

        document.getElementById('usc-reset').onclick = () => {
            if (confirm(t('resetConfirm'))) {
                saveConfig(deepClone(DEFAULT_CONFIG));
                location.reload();
            }
        };

        const body = panel.querySelector('.usc-body');
        body.addEventListener('input',  () => liveSave(cfg));
        body.addEventListener('change', () => liveSave(cfg));
        body.addEventListener('click',  e => { if (e.target.closest('.usc-del-custom')) liveSave(cfg); });
    }

    function collectAndSave(cfg) {
        document.querySelectorAll('.usc-tab-row').forEach(row => {
            const key = row.dataset.key;
            if (!key) return;
            if (!cfg.tabs[key]) cfg.tabs[key] = { hidden: false, label: key, redirectUrl: null };
            const canonical = DEFAULT_CONFIG.tabs[key] ? DEFAULT_CONFIG.tabs[key].label : key;
            const native    = row.dataset.native || '';
            const val       = row.querySelector('.usc-label-inp').value.trim();

            cfg.tabs[key].hidden = row.querySelector('.usc-hide-cb').checked;
            cfg.tabs[key].label = (val && val !== native) ? val : canonical;
            cfg.tabs[key].redirectUrl = row.querySelector('.usc-url-inp').value.trim() || null;
        });
        cfg.customTabs = [];
        document.querySelectorAll('.usc-custom-row').forEach(row => {
            const label = row.querySelector('.usc-ci-label').value.trim();
            const url   = row.querySelector('.usc-ci-url').value.trim();
            if (label && url) cfg.customTabs.push({ id: row.dataset.id, label, url });
        });
        saveConfig(cfg);
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── СТИЛИ ────────────────────────────────────────────────────────────────

    const ACCENT = ENGINE.accent;
    function accentRgba(alpha) {
        const m = ACCENT.replace('#', '').match(/.{2}/g);
        const r = parseInt(m[0], 16), g = parseInt(m[1], 16), b = parseInt(m[2], 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    GM_addStyle(`
        /* ── Кнопка в навигационной строке ── */
        #usc-gear-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 4px 8px;
            margin: 0 2px;
            transition: background .12s;
            vertical-align: middle;
            flex-shrink: 0;
            border-radius: 6px;
        }
        #usc-gear-btn:hover { background: ${accentRgba(0.12)}; }
        [data-usc-inject-wrap] { list-style: none; display: inline-flex; align-items: center; }
        .usc-ham { display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
        .usc-ham span {
            display: block; width: 15px; height: 2px;
            background: ${ACCENT}; border-radius: 2px; transition: .15s;
        }
        #usc-gear-btn:hover .usc-ham span:nth-child(1) { width: 15px; }
        #usc-gear-btn:hover .usc-ham span:nth-child(2) { width: 10px; }
        #usc-gear-btn:hover .usc-ham span:nth-child(3) { width: 13px; }

        /* ── Оверлей ── */
        #usc-panel {
            position: fixed; inset: 0; z-index: 2147483646;
            font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
            font-size: 12px;
        }
        .usc-backdrop {
            position: absolute; inset: 0;
            background: rgba(0,0,0,.35);
            backdrop-filter: blur(1px);
        }

        /* ── Боковая панель (очень компактная и удобная) ── */
        .usc-modal {
            position: absolute; right: 0; top: 0; bottom: 0;
            width: 310px; max-width: 92vw;
            background: #ffffff;
            display: flex; flex-direction: column;
            box-shadow: -6px 0 25px rgba(0,0,0,.15);
            animation: usc-slide-in .15s cubic-bezier(.4,0,.2,1);
        }
        #usc-panel.usc-closing .usc-modal {
            animation: usc-slide-out .13s cubic-bezier(.4,0,.2,1) forwards;
        }
        #usc-panel.usc-closing .usc-backdrop {
            animation: usc-fade-out .13s ease forwards;
        }
        @keyframes usc-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes usc-slide-out { to { transform: translateX(100%); } }
        @keyframes usc-fade-out  { to { opacity: 0; } }

        /* ── Шапка ── */
        .usc-head {
            padding: 8px 12px;
            background: #fff;
            border-bottom: 2px solid ${ACCENT};
            display: flex; align-items: center; justify-content: space-between;
            flex-shrink: 0;
        }
        .usc-head-inner { display: flex; align-items: center; gap: 7px; }
        .usc-head-icon  { display: flex; flex-direction: column; gap: 2px; }
        .usc-head-icon span { display: block; width: 12px; height: 2px; background: ${ACCENT}; border-radius: 2px; }
        .usc-title { font-size: 12.5px; font-weight: 600; color: #222; }
        .usc-close {
            background: none; border: none; font-size: 15px; line-height: 1;
            cursor: pointer; color: #767676; padding: 3px 5px;
            border-radius: 4px; transition: color .12s, background .12s;
        }
        .usc-close:hover { background: #f0f0f0; color: #222; }

        /* ── Тело ── */
        .usc-body { padding: 8px 10px; overflow-y: auto; flex: 1; background: #fafafa; }

        .usc-section-title {
            font-size: 9.5px; font-weight: 700; text-transform: uppercase;
            letter-spacing: .06em; color: #777; margin-bottom: 5px;
            display: flex; align-items: center; justify-content: space-between;
        }
        .usc-hint { font-size: 9.5px; color: #999; font-weight: 400; text-transform: none; letter-spacing: 0; }
        .usc-empty { font-size: 12px; color: #888; padding: 6px 2px; }

        /* ── Строка вкладки ── */
        .usc-tab-row {
            background: #fff; border: 1px solid #e0e0e0;
            border-radius: 5px; padding: 5px 8px; margin-bottom: 4px;
            transition: all .12s ease;
        }
        .usc-tab-header { display: flex; align-items: center; justify-content: space-between; }
        .usc-tab-name { font-weight: 600; font-size: 12px; color: #222; }
        .usc-hide-label {
            display: flex; align-items: center; gap: 5px;
            font-size: 10.5px; color: #777; cursor: pointer; user-select: none;
        }
        .usc-hide-text { text-transform: uppercase; letter-spacing: .03em; font-weight: 600; font-size: 9.5px; }
        
        /* Скрытая вкладка: минимум информации (поля скрыты) */
        .usc-tab-row.usc-hidden-row {
            padding: 4px 8px;
            background: #f2f2f2;
            border-color: #d8d8d8;
        }
        .usc-tab-row.usc-hidden-row .usc-tab-fields {
            display: none !important;
        }
        .usc-tab-row.usc-hidden-row .usc-tab-name {
            color: #888;
            text-decoration: line-through;
        }

        /* Переключатель-тумблер */
        .usc-switch { position: relative; display: inline-block; width: 26px; height: 15px; flex-shrink: 0; }
        .usc-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
        .usc-switch-sl {
            position: absolute; inset: 0; background: #ccc; border-radius: 999px;
            transition: background .15s;
        }
        .usc-switch-sl::before {
            content: ''; position: absolute; left: 2px; top: 2px;
            width: 11px; height: 11px; background: #fff; border-radius: 50%;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform .15s;
        }
        .usc-switch input:checked + .usc-switch-sl { background: ${ACCENT}; }
        .usc-switch input:checked + .usc-switch-sl::before { transform: translateX(11px); }

        .usc-tab-fields { display: flex; flex-direction: column; gap: 4px; margin-top: 5px; padding-top: 5px; border-top: 1px solid #f2f2f2; }
        .usc-field { display: flex; flex-direction: column; gap: 1.5px; }
        .usc-field > label { font-size: 9px; font-weight: 600; color: #777; text-transform: uppercase; letter-spacing: .03em; }
        .usc-field input[type="text"], .usc-field select {
            padding: 3.5px 6px; border: 1px solid #d5d5d5; border-radius: 4px;
            font-size: 11.5px; background: #fff; outline: none; color: #222;
            transition: border-color .12s, box-shadow .12s;
        }
        .usc-field input[type="text"]:focus, .usc-field select:focus {
            border-color: ${ACCENT}; box-shadow: 0 0 0 2px ${accentRgba(0.15)};
        }

        /* ── Кастомная строка ── */
        .usc-custom-row {
            display: flex; gap: 4px; margin-bottom: 4px; align-items: center;
            background: #fff; border: 1px solid #e0e0e0; border-radius: 5px;
            padding: 4px 6px; transition: all .12s ease;
        }
        .usc-custom-inputs { display: flex; flex-direction: column; gap: 3px; flex: 1; }
        .usc-custom-row input {
            width: 100%; padding: 3.5px 6px; border: 1px solid #d5d5d5; border-radius: 4px;
            font-size: 11.5px; outline: none; background: #fff; color: #222;
            transition: border-color .12s, box-shadow .12s;
        }
        .usc-custom-row input:focus {
            border-color: ${ACCENT}; box-shadow: 0 0 0 2px ${accentRgba(0.15)};
        }

        /* ── Подвал ── */
        .usc-foot {
            padding: 7px 10px; border-top: 1px solid #e0e0e0;
            display: flex; gap: 5px; justify-content: space-between;
            background: #fff; flex-shrink: 0;
        }

        /* ── Кнопки ── */
        .usc-btn {
            padding: 5px 10px; border-radius: 4px; border: 1px solid #d5d5d5;
            font-size: 11.5px; font-weight: 500; cursor: pointer;
            background: #f0f0f0; color: #444;
            transition: background .12s, border-color .12s; line-height: 1;
        }
        .usc-btn:hover { background: #e5e5e5; border-color: #bcbcbc; }
        .usc-btn-save { background: ${ACCENT}; color: #fff; border-color: ${ACCENT}; }
        .usc-btn-save:hover { filter: brightness(.92); }
        .usc-btn-add {
            display: block; width: 100%; margin-top: 4px;
            background: #fff; color: ${ACCENT}; border-color: ${ACCENT};
        }
        .usc-btn-add:hover { background: ${accentRgba(0.06)}; }
        .usc-btn-del {
            background: #fff; color: #d9534f; border-color: #e8c6c6;
            flex-shrink: 0; padding: 5px 8px; border-radius: 4px; font-size: 11.5px;
        }
        .usc-btn-del:hover { background: #fff5f5; border-color: #d9534f; }
        .usc-btn-reset { background: #f0f0f0; color: #767676; border-color: #d5d5d5; }
        .usc-btn-reset:hover { background: #e5e5e5; }

        /* ════════ ТЁМНАЯ ТЕМА ════════ */
        #usc-panel.usc-dark .usc-backdrop { background: rgba(0,0,0,.55); }
        #usc-panel.usc-dark .usc-modal { background: #161616; box-shadow: -6px 0 25px rgba(0,0,0,.6); }
        #usc-panel.usc-dark .usc-head { background: #161616; border-bottom-color: ${ACCENT}; }
        #usc-panel.usc-dark .usc-title { color: #f0f0f0; }
        #usc-panel.usc-dark .usc-close { color: #888; }
        #usc-panel.usc-dark .usc-close:hover { background: #242424; color: #f0f0f0; }
        #usc-panel.usc-dark .usc-body { background: #101010; }
        #usc-panel.usc-dark .usc-section-title { color: #888; }
        #usc-panel.usc-dark .usc-hint { color: #555; }
        #usc-panel.usc-dark .usc-tab-row { background: #1a1a1a; border-color: #282828; }
        #usc-panel.usc-dark .usc-tab-row.usc-hidden-row { background: #141414; border-color: #202020; }
        #usc-panel.usc-dark .usc-tab-row.usc-hidden-row .usc-tab-name { color: #777; }
        #usc-panel.usc-dark .usc-tab-name { color: #f0f0f0; }
        #usc-panel.usc-dark .usc-hide-label { color: #777; }
        #usc-panel.usc-dark .usc-switch-sl { background: #333; }
        #usc-panel.usc-dark .usc-tab-fields { border-top-color: #242424; }
        #usc-panel.usc-dark .usc-field > label { color: #777; }
        #usc-panel.usc-dark .usc-field input[type="text"],
        #usc-panel.usc-dark .usc-field select {
            background: #222222; border-color: #313131; color: #e8e8e8;
        }
        #usc-panel.usc-dark .usc-field input[type="text"]:focus,
        #usc-panel.usc-dark .usc-field select:focus {
            border-color: ${ACCENT}; box-shadow: 0 0 0 2px ${accentRgba(0.2)};
        }
        #usc-panel.usc-dark .usc-custom-row { background: #1a1a1a; border-color: #282828; }
        #usc-panel.usc-dark .usc-custom-row input { background: #222222; border-color: #313131; color: #e8e8e8; }
        #usc-panel.usc-dark .usc-custom-row input:focus {
            border-color: ${ACCENT}; box-shadow: 0 0 0 2px ${accentRgba(0.2)};
        }
        #usc-panel.usc-dark .usc-foot { background: #161616; border-color: #282828; }
        #usc-panel.usc-dark .usc-btn { background: #222; border-color: #313131; color: #ccc; }
        #usc-panel.usc-dark .usc-btn:hover { background: #2a2a2a; border-color: #444; }
        #usc-panel.usc-dark .usc-btn-save { background: ${ACCENT}; color: #fff; border-color: ${ACCENT}; }
        #usc-panel.usc-dark .usc-btn-add { background: #1a1a1a; color: ${ACCENT}; border-color: ${ACCENT}; }
        #usc-panel.usc-dark .usc-btn-add:hover { background: #2a1a14; }
        #usc-panel.usc-dark .usc-btn-del { background: #1a1a1a; color: #e07070; border-color: #5a2020; }
        #usc-panel.usc-dark .usc-btn-del:hover { background: #2e1a1a; border-color: #9b3030; }
        #usc-panel.usc-dark .usc-btn-reset { background: #222; color: #888; border-color: #313131; }
        #usc-panel.usc-dark .usc-btn-reset:hover { background: #2a2a2a; }
    `);

    // ─── ИНИЦИАЛИЗАЦИЯ И SPA-ПОДДЕРЖКА ───────────────────────────────────────

    let _applyTimer = null;
    function scheduleApply() {
        clearTimeout(_applyTimer);
        _applyTimer = setTimeout(applyConfig, 350);
    }

    function nodeHasNavLink(node) {
        if (isOwnEl(node)) return false;
        if (node.matches && node.matches('a[href]')) return !!classifyEl(node);
        if (!node.querySelectorAll) return false;
        for (const a of node.querySelectorAll('a[href]')) {
            if (classifyEl(a)) return true;
        }
        return false;
    }

    const observer = new MutationObserver(muts => {
        for (const m of muts) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (nodeHasNavLink(node)) { scheduleApply(); return; }
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

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('⚙ ' + t('gearTitle'), openPanel);
    }

    function init() {
        applyConfig();
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

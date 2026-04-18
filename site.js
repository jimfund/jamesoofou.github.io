const overlaySelector = '.article-overlay';

function updateBodyState(hasOverlay) {
    document.body.classList.toggle('has-overlay', hasOverlay);
}

function clearActiveArticles() {
    document
        .querySelectorAll(`${overlaySelector}.active`)
        .forEach((element) => element.classList.remove('active'));
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-mode');
    }
}

function toggleSeries(id) {
    const element = document.getElementById(id);

    if (!element) {
        return;
    }

    const button = element.querySelector('.series-toggle');
    const isOpen = element.classList.contains('open');

    element.classList.toggle('open', !isOpen);
    button?.setAttribute('aria-expanded', String(!isOpen));
}

function showArticle(id, options = {}) {
    const article = document.getElementById(id);

    if (!article) {
        return;
    }

    clearActiveArticles();
    article.classList.add('active');
    updateBodyState(true);
    article.scrollTop = 0;

    if (!options.skipHistory) {
        history.pushState(null, '', `#${id}`);
    }
}

function showHome(options = {}) {
    clearActiveArticles();
    updateBodyState(false);

    if (!options.skipHistory) {
        history.pushState(null, '', window.location.pathname);
    }
}

function handleHash() {
    const hash = window.location.hash.slice(1);

    if (hash && document.getElementById(hash)) {
        showArticle(hash, { skipHistory: true });
        return;
    }

    showHome({ skipHistory: true });
}

function handleDocumentClick(event) {
    const actionTarget = event.target.closest('[data-action]');

    if (!actionTarget) {
        return;
    }

    const { action, articleId, seriesId } = actionTarget.dataset;

    switch (action) {
        case 'go-home':
            event.preventDefault();
            showHome();
            break;
        case 'toggle-theme':
            event.preventDefault();
            toggleTheme();
            break;
        case 'toggle-series':
            event.preventDefault();
            toggleSeries(seriesId);
            break;
        case 'show-article':
            event.preventDefault();
            showArticle(articleId);
            break;
        default:
            break;
    }
}

function handleKeydown(event) {
    if (event.key === 'Escape' && document.querySelector(`${overlaySelector}.active`)) {
        showHome();
    }
}

initTheme();
document.addEventListener('click', handleDocumentClick);
window.addEventListener('hashchange', handleHash);
window.addEventListener('keydown', handleKeydown);
window.addEventListener('load', handleHash);

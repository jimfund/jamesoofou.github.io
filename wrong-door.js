(function () {
    function isLocalArticleTarget(value) {
        return typeof value === "string" && /^[a-z0-9][a-z0-9_-]*\.html$/i.test(value);
    }

    const now = new Date();
    const utcMonthOrdinal = now.getUTCFullYear() * 12 + now.getUTCMonth();

    document.querySelectorAll("[data-wrong-door]").forEach((link) => {
        let targets;
        try {
            targets = JSON.parse(link.dataset.wrongDoorTargets || "[]");
        } catch (_error) {
            return;
        }

        if (!Array.isArray(targets) || !targets.length) {
            return;
        }

        const routeIndex = utcMonthOrdinal % targets.length;
        const target = targets[routeIndex];
        if (isLocalArticleTarget(target)) {
            link.href = target;
            link.dataset.wrongDoorRoute = String(routeIndex);
        }
    });
})();

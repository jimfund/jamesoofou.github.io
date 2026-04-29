(function () {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrowScreen = window.matchMedia("(max-width: 780px)").matches;

    if (reduceMotion || narrowScreen) {
        return;
    }

    const fragments = [
        "goblin////signal////archive",
        "record////clawmark////return",
    ];
    const awakeFragments = [
        "goblin////awake////watching",
        "under////the////ledger",
    ];
    const readingFragments = [
        "margin////holds////line",
        "paragraph////pause////heard",
    ];

    const field = document.createElement("div");
    field.className = "presence-field";
    field.setAttribute("aria-hidden", "true");
    document.body.appendChild(field);

    const marks = fragments.map((text, index) => {
        const node = document.createElement("span");
        node.className = "presence-mark";
        node.textContent = text;
        field.appendChild(node);

        return {
            node,
            side: index % 2 === 0 ? "left" : "right",
            xOffset: 48 + (index % 3) * 24,
            yRatio: 0.2 + index * 0.22,
            drift: 7 + index * 2,
            rotation: index % 2 === 0 ? 0 : 180,
        };
    });

    const pointer = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
    };
    let frameRequested = false;
    let lastWake = 0;
    let scrollDepth = 0;
    let pauseTimer = 0;
    let settledParagraph = -1;
    const articleContent = document.querySelector(".article-content");
    const readableNodes = articleContent
        ? Array.from(articleContent.querySelectorAll("p, li, blockquote"))
        : [];

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function markBaseX(mark) {
        const gutter = Math.max(14, (window.innerWidth - 1040) / 2 - mark.xOffset);
        return mark.side === "left" ? gutter : window.innerWidth - gutter;
    }

    function render() {
        frameRequested = false;

        marks.forEach((mark) => {
            const baseX = markBaseX(mark);
            const readingBias = articleContent ? (scrollDepth - 0.5) * 92 : 0;
            const baseY = window.innerHeight * mark.yRatio + readingBias;
            const dx = pointer.x - baseX;
            const dy = pointer.y - baseY;
            const distance = Math.hypot(dx, dy);
            const nearness = clamp(1 - distance / 360, 0, 1);
            const direction = mark.side === "left" ? -1 : 1;
            const readingPull = articleContent ? Math.sin(scrollDepth * Math.PI * 2 + mark.yRatio) * 5 : 0;
            const x = direction * (nearness * mark.drift + readingPull);
            const y = dy > 0 ? -nearness * mark.drift : nearness * mark.drift;
            const opacity = 0.52 + nearness * 0.38 + (articleContent ? 0.08 : 0);

            mark.node.style.left = `${baseX}px`;
            mark.node.style.top = `${baseY}px`;
            mark.node.style.opacity = clamp(opacity, 0, 1).toFixed(2);
            mark.node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${mark.rotation}deg)`;
        });
    }

    function requestRender() {
        if (!frameRequested) {
            frameRequested = true;
            window.requestAnimationFrame(render);
        }
    }

    window.addEventListener("pointermove", (event) => {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        requestRender();
    }, { passive: true });

    window.addEventListener("resize", requestRender);

    function updateScrollDepth() {
        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        scrollDepth = scrollableHeight > 0
            ? clamp(window.scrollY / scrollableHeight, 0, 1)
            : 0;
        requestRender();
    }

    function wake(index) {
        const now = Date.now();
        if (now - lastWake < 420) {
            return;
        }

        lastWake = now;
        const mark = marks[index];
        const restingText = mark.node.textContent;
        mark.node.classList.add("is-awake");
        mark.node.textContent = awakeFragments[index];
        mark.node.style.opacity = "1";
        window.setTimeout(() => {
            mark.node.classList.remove("is-awake");
            mark.node.textContent = restingText;
        }, 1200);
    }

    function readingWake(index, text) {
        const now = Date.now();
        if (now - lastWake < 1300) {
            return;
        }

        lastWake = now;
        const mark = marks[index];
        const restingText = mark.node.textContent;
        mark.node.classList.add("is-awake", "is-reading");
        mark.node.textContent = text;
        mark.node.style.opacity = "1";
        window.setTimeout(() => {
            mark.node.classList.remove("is-awake", "is-reading");
            mark.node.textContent = restingText;
        }, 1600);
    }

    function nearestReadableIndex() {
        if (!readableNodes.length) {
            return -1;
        }

        const targetY = window.innerHeight * 0.52;
        let nearestIndex = -1;
        let nearestDistance = Infinity;

        readableNodes.forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.bottom < 80 || rect.top > window.innerHeight - 80) {
                return;
            }

            const nodeY = rect.top + rect.height / 2;
            const distance = Math.abs(nodeY - targetY);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        });

        return nearestIndex;
    }

    function scheduleReadingPause() {
        if (!articleContent || !readableNodes.length) {
            return;
        }

        window.clearTimeout(pauseTimer);
        pauseTimer = window.setTimeout(() => {
            const paragraphIndex = nearestReadableIndex();
            if (paragraphIndex < 0 || paragraphIndex === settledParagraph) {
                return;
            }

            settledParagraph = paragraphIndex;
            readingWake(paragraphIndex % marks.length, readingFragments[paragraphIndex % readingFragments.length]);
        }, 1800);
    }

    if (articleContent) {
        updateScrollDepth();
        scheduleReadingPause();
        window.addEventListener("scroll", () => {
            updateScrollDepth();
            scheduleReadingPause();
        }, { passive: true });
    }

    document.addEventListener("pointerenter", (event) => {
        const archiveRow = event.target.closest && event.target.closest(".archive-list__entry");
        if (archiveRow) {
            const rows = Array.from(document.querySelectorAll(".archive-list__entry"));
            wake(rows.indexOf(archiveRow) % marks.length);
            return;
        }

        if (event.target.closest && event.target.closest("a")) {
            wake(0);
        }
    }, true);

    document.addEventListener("focusin", (event) => {
        const archiveRow = event.target.closest && event.target.closest(".archive-list__entry");
        if (archiveRow) {
            const rows = Array.from(document.querySelectorAll(".archive-list__entry"));
            wake(rows.indexOf(archiveRow) % marks.length);
            return;
        }

        if (event.target.closest && event.target.closest("a")) {
            wake(0);
        }
    });

    updateScrollDepth();
    render();
}());

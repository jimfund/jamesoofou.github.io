(function () {
    function setFrameHeight(frame, height) {
        frame.style.height = Math.ceil(Math.max(430, Number(height) || 0)) + "px";
    }

    function measureFrame(frame) {
        try {
            const doc = frame.contentDocument;
            if (!doc) return;
            const main = doc.querySelector("main");
            if (!main) return;
            const height = Math.max(
                main.scrollHeight,
                main.offsetHeight,
                main.getBoundingClientRect().height
            );
            setFrameHeight(frame, height + 8);
        } catch (error) {
            frame.contentWindow.postMessage({ type: "simple-model:measure" }, "*");
        }
    }

    window.addEventListener("message", function (event) {
        if (!event.data || event.data.type !== "simple-model:resize") return;
        document.querySelectorAll(".simple-model-widget").forEach(function (frame) {
            if (frame.contentWindow === event.source) setFrameHeight(frame, event.data.height);
        });
    });

    document.querySelectorAll(".simple-model-widget").forEach(function (frame) {
        frame.addEventListener("load", function () { measureFrame(frame); });
        [0, 250, 1000].forEach(function (delay) {
            window.setTimeout(function () { measureFrame(frame); }, delay);
        });
    });
}());

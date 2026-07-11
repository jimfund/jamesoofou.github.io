(function () {
    function resizeFrame(frame) {
        try {
            var doc = frame.contentDocument || frame.contentWindow.document;
            var root = doc.documentElement;
            var body = doc.body;
            var height = Math.max(
                root ? root.scrollHeight : 0,
                body ? body.scrollHeight : 0,
                760
            );
            frame.style.height = Math.ceil(height + 4) + "px";
        } catch (error) {
            frame.style.height = "920px";
        }
    }

    function attachFrame(frame) {
        frame.addEventListener("load", function () {
            resizeFrame(frame);
        });
        resizeFrame(frame);
    }

    document.querySelectorAll(".timehorizon-model-widget").forEach(attachFrame);
    window.addEventListener("resize", function () {
        document.querySelectorAll(".timehorizon-model-widget").forEach(resizeFrame);
    });
})();

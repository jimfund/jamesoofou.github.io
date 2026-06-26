(function () {
    const root = document.querySelector("[data-radio]");

    if (!root) {
        return;
    }

    const tracks = [
        {
            id: "qAiPsZRZNOI",
            title: "The Highwaymen Live in Las Vegas",
        },
    ];

    const titleNodes = root.querySelectorAll("[data-radio-title]");
    const frame = root.querySelector("[data-radio-frame]");
    const launchButton = root.querySelector("[data-radio-launch]");
    const launchCommand = root.querySelector("[data-radio-launch-command]");
    const panel = root.querySelector("[data-radio-panel]");
    const toggleButton = root.querySelector("[data-radio-toggle]");
    const previousButton = root.querySelector("[data-radio-prev]");
    const nextButton = root.querySelector("[data-radio-next]");

    let currentIndex = 0;
    let isPlaying = false;

    if (!titleNodes.length || !frame || !launchButton || !launchCommand || !panel || !toggleButton || !previousButton || !nextButton || tracks.length === 0) {
        return;
    }

    function currentTrack() {
        return tracks[currentIndex];
    }

    function embedUrl(track) {
        const params = new URLSearchParams({
            autoplay: "1",
            playsinline: "1",
            rel: "0",
        });
        return `https://www.youtube-nocookie.com/embed/${track.id}?${params.toString()}`;
    }

    function loadTrack() {
        const track = currentTrack();
        titleNodes.forEach((node) => {
            node.textContent = track.title;
        });
        frame.title = `Jimfund radio: ${track.title}`;

        if (isPlaying) {
            frame.src = embedUrl(track);
        }
    }

    function render() {
        const hasMultipleTracks = tracks.length > 1;
        previousButton.disabled = !hasMultipleTracks;
        nextButton.disabled = !hasMultipleTracks;
        root.classList.toggle("has-multiple-tracks", hasMultipleTracks);
        launchButton.setAttribute("aria-expanded", String(isPlaying));
        launchCommand.textContent = isPlaying ? "On air" : "Turn on";
        toggleButton.textContent = "Stop";
        root.classList.toggle("is-active", isPlaying);
        panel.hidden = !isPlaying;
        loadTrack();
    }

    function stop() {
        isPlaying = false;
        frame.removeAttribute("src");
        render();
    }

    function play() {
        if (isPlaying) {
            return;
        }

        isPlaying = true;
        render();
    }

    function move(offset) {
        currentIndex = (currentIndex + offset + tracks.length) % tracks.length;
        render();
    }

    launchButton.addEventListener("click", play);
    toggleButton.addEventListener("click", () => {
        stop();
    });

    previousButton.addEventListener("click", () => move(-1));
    nextButton.addEventListener("click", () => move(1));

    render();
}());

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

    const titleNode = root.querySelector("[data-radio-title]");
    const frame = root.querySelector("[data-radio-frame]");
    const toggleButton = root.querySelector("[data-radio-toggle]");
    const previousButton = root.querySelector("[data-radio-prev]");
    const nextButton = root.querySelector("[data-radio-next]");

    let currentIndex = 0;
    let isPlaying = false;

    if (!titleNode || !frame || !toggleButton || !previousButton || !nextButton || tracks.length === 0) {
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
        titleNode.textContent = track.title;
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
        toggleButton.textContent = isPlaying ? "Stop" : "Play";
        toggleButton.setAttribute("aria-label", isPlaying ? "Stop radio" : "Play radio");
        root.classList.toggle("is-active", isPlaying);
        loadTrack();
    }

    function stop() {
        isPlaying = false;
        frame.removeAttribute("src");
        render();
    }

    function play() {
        isPlaying = true;
        render();
    }

    function move(offset) {
        currentIndex = (currentIndex + offset + tracks.length) % tracks.length;
        render();
    }

    toggleButton.addEventListener("click", () => {
        if (isPlaying) {
            stop();
            return;
        }

        play();
    });

    previousButton.addEventListener("click", () => move(-1));
    nextButton.addEventListener("click", () => move(1));

    render();
}());

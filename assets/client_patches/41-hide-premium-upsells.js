(() => {
    const style = document.createElement("style");
    style.textContent = [
        'li:has(> div > a[href="/store"])',
        '[aria-label="Send a gift"]',
    ].join(",\n").concat(" {\n    display: none !important;\n}\n");
    document.documentElement.append(style);
})();

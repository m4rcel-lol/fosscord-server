(() => {
    const style = document.createElement("style");
    style.textContent = [
        'li:has(> div > a[href="/store"])',
        'li:has(> div > a[href="/shop"])',
        'button[aria-label="Send a gift"]',
    ].join(",\n").concat(" {\n    display: none !important;\n}\n");
    document.documentElement.append(style);
})();

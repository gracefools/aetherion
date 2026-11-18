// Background clock: a timer in a worker keeps ticking when the page is hidden or not painted,
// so the game (and auto hunting) keeps running while the player is in another application.
setInterval(function () { postMessage(0); }, 50);

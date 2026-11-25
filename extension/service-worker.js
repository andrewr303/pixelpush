// Service worker entry. background.js is the compiled worker (side panel,
// audit relay, AI router); capture/worker.js adds quick capture (popup,
// shortcuts, context menu, screenshots and the capture composer's requests).
importScripts("background.js", "capture/worker.js")

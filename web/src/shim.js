// The desktop's window code asks its host for a few things through window.stet. The browser has no
// host, so those requests are answered here and the shared code runs unchanged. First import of app.js.

window.stet = { invoke: async () => null, on() {}, platform: 'web' };

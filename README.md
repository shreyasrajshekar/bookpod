# BookPod

Turn any book into a podcast. Upload an EPUB, PDF or plain-text file; BookPod splits it into chapters (episodes) and reads it aloud with a narrator voice, while a "host" voice introduces each episode, all in the browser. No account, no API key, and your books never leave your device (the library is stored in IndexedDB).

- **Episodes** from chapter detection (EPUB spine, `Chapter`/`Book`/`Stave` headings, or even parts for headingless text)
- **Full reading** or **Highlights** (lead sentence of each paragraph)
- Speed, voice choice, sleep timer, click any paragraph to listen from there, resume where you left off
- Keyboard: `Space` play/pause, `←`/`→` paragraph

## Develop
```
npm install
npm run dev
npm test      # chapter-detection tests against the bundled samples
```
Samples in `public/samples` are public-domain texts from Project Gutenberg.

## Voices
BookPod reads with [Piper](https://github.com/rhasspy/piper) neural voices that run **on the listener's device** — no API keys, no accounts, no server, nothing uploaded.

- 16 English voices (American, British, Scottish, Northern English), chosen in **Voices**: one narrator for the book, one host for the episode intros. Each has a preview button.
- Each voice downloads once (~60 MB, "HD" voices ~120 MB) from Hugging Face and is cached by the browser. Opening a book starts the download in the background, so Play is instant.
- Synthesis runs in Web Workers (one per voice), a few sentences ahead of playback. The page stays smooth, and speech is generated roughly 10× faster than it plays.
- Multi-threaded WASM needs cross-origin isolation; `vercel.json` and `vite.config.js` send `COOP: same-origin` and `COEP: credentialless`. Browsers without it (e.g. Safari) fall back to one thread.

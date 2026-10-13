# BookPod

Turn any book into a podcast. Upload an EPUB, PDF or plain-text file; BookPod splits it into chapters (episodes) and reads it aloud with a narrator voice, while a "host" voice introduces each episode, all in the browser using the Web Speech API. No account, no API key, and your books never leave your device (the library is stored in IndexedDB).

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
| Engine | Quality | Cost | Where it runs |
|---|---|---|---|
| **Device** | depends on browser/OS (Edge "Natural" voices are best) | free | your browser |
| **Studio (AI)** | Kokoro-82M neural voices, ~90 MB one-time download | free | your browser (WASM) |
| **Premium (Google)** | Chirp 3 HD / Studio / Neural2 | Google Cloud pricing, free monthly tier | Google, via your key or the site's |

Premium audio is cached on the device, so re-listening never re-bills.

### Premium voices on your deployment
1. In Google Cloud, enable **Cloud Text-to-Speech API** and create an API key.
2. *Own key:* each listener pastes a key in Voices → Premium. It stays in their browser.
3. *Included:* set `GOOGLE_TTS_API_KEY` in Vercel (Project → Settings → Environment Variables) and redeploy. `api/tts.js` proxies requests, validates voice/length, rejects cross-site calls and applies soft per-visitor and per-instance limits. Add `TTS_ACCESS_CODE` to keep it private.
4. The in-memory limits are approximate. For a hard spending cap, set a **quota** on the API in Google Cloud Console.

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

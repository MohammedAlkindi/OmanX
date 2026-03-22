# OmanX MVP

OmanX is a polished, deployable MVP for an AI-powered student guidance platform. The product includes a premium landing page, a local-first chat workspace with persistent history, a collaboration concept page, a vision and roadmap page, and workspace settings for light personalization.

## Product overview

### Pages
- `public/index.html` — investor-ready landing page and product story
- `public/chat.html` — core guidance workspace with persistent chat history
- `public/collaboration.html` — shared workspace and workflow concepts
- `public/vision.html` — mission, roadmap, trust, and product pillars
- `public/settings.html` — local workspace preferences and mock account state

### MVP capabilities
- Multi-page navigation with a shared design system
- Responsive layouts for desktop and mobile
- Theme toggle with persistent preference
- Persistent chat history in `localStorage`
- New, rename, delete, pin, search, copy, and export chat sessions
- Keyboard-friendly composer with `Enter` to send
- Local-first assistant replies with optional `/api/chat` fallback when available
- Modular JavaScript architecture for maintainability

## Project structure

```text
.
├── api/                      # Optional backend/serverless handlers
├── auth/                     # Authentication utilities from the original backend
├── config/                   # Environment configuration for the Node server
├── data/                     # Structured knowledge content
├── docs/                     # Supporting documentation
├── public/
│   ├── assets/               # Favicons and static assets
│   ├── js/
│   │   ├── core.js           # Shared UI helpers and app shell behavior
│   │   ├── chat-store.js     # Local persistence for chats and settings
│   │   ├── chat-page.js      # Chat page interactions and fallback assistant logic
│   │   ├── landing-page.js   # Landing page boot logic
│   │   ├── collaboration-page.js
│   │   ├── vision-page.js
│   │   └── settings-page.js
│   ├── index.html
│   ├── chat.html
│   ├── collaboration.html
│   ├── vision.html
│   ├── settings.html
│   └── styles.css           # Shared design system and responsive UI styles
├── server.js                 # Express server for local development / Node deployment
├── package.json
└── vercel.json
```

## Running locally

### Option 1: Node / Express
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000`.

### Option 2: Static hosting
The frontend is fully functional without a backend thanks to local-first persistence. You can deploy the contents of `public/` to Netlify, Vercel static hosting, GitHub Pages, or any static host.

## Deployment notes

### Vercel
- Current `vercel.json` routes all non-API traffic to `public/`.
- The frontend works immediately as static files.
- If you configure backend environment variables later, `/api/chat` can provide server responses.

### Netlify
- Publish directory: `public`
- Optional Node functions are not required for the current MVP experience.

## Chat storage behavior
- OmanX stores conversations in browser `localStorage`.
- Chats persist across refreshes on the same browser profile.
- The active conversation, pinned state, and user settings are also stored locally.

## Future expansion ideas
- Replace local-only settings with authenticated profiles
- Connect collaboration rooms to a real backend
- Introduce formal markdown rendering, citations, and live knowledge sources
- Add richer analytics and advisor workflows

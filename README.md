# OmanX

Implemented architecture:

```
/src
  /api
    routes.js
    controllers.js

  /core
    engine.js
    policy.js
    validator.js
    riskLabeler.js

  /ai
    prompts.js
    responders
      localResponder.js
      llmResponder.js

  /data
    knowledge.json
    sources.json
    disclaimers.json

  /middleware
    auth.js
    rateLimit.js
    logging.js

  /frontend
    index.html
    admin.html
    feedback.html
    kb.html
    styles.css

  /config
    env.js
    vercel.js

  /tests
    policy.test.js
    validator.test.js
    engine.test.js

server.js
app.js
package.json
README.md
```

## Run

```bash
npm install
npm test
npm start
```

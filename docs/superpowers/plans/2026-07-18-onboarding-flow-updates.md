# Onboarding Flow Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish wiring the dormant Google-auth onboarding step, add a major/field-of-study question, and add a "Skip for now" control to the onboarding questionnaire.

**Architecture:** All changes are localized to three existing files (`public/chat.html`, `public/js/chat-page.js`, `public/js/chat-store.js`) — no new files, no new dependencies, no build step. The onboarding overlay's step-switching logic (`showOnboarding()` / `showOnboardingStep()` in `chat-page.js`) is extended incrementally: first to read/write a new `major` setting, then to pick a dynamic starting step and wire the existing dead auth markup, then to add one shared "skip" control across steps.

**Tech Stack:** Vanilla JS ES modules (no framework, no bundler), served directly by Express/Vercel. No test runner exists in this repo (`package.json` has no `test` script) — verification throughout this plan is manual, via `npm run dev` and driving the actual page in a browser.

## Global Constraints

- No build step: edits to `public/**` take effect on browser refresh, nothing to compile.
- No automated test suite exists in this repo — do not add a test framework as part of this feature. Verify each task by running `npm run dev` and exercising the UI in a browser, per this project's `CLAUDE.md` ("For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete").
- `data-*` attributes are the JS selector convention here — never target new elements by class name from JS.
- CSS variables live in `:root` in `public/styles.css` — reuse existing classes (`.onboarding-name-input`, `.onboarding-skip`, `.settings-field`/`.settings-input`) rather than hand-rolling new styles.
- Guest quota is 3 questions/day (`ANONYMOUS_RATE_LIMIT_MAX`, `api/rate-limit.js:9`); signed-in quota is 50/day (`AUTHENTICATED_RATE_LIMIT_MAX`, `api/rate-limit.js:10`). Use these exact numbers in any copy that references quota.
- `ONBOARDED_KEY = 'omanx.onboarded.v1'` (`chat-page.js:33`) gates whether onboarding shows. To re-trigger onboarding manually during testing: open the browser devtools console on the running app and run `localStorage.removeItem('omanx.onboarded.v1')`, then reload the page.
- Settings are persisted under the `omanx.settings.v1` localStorage key via `chat-store.js`'s `loadSettings()`/`saveSettings()` — new settings keys must be added to `SETTINGS_DEFAULTS` so `loadSettings()` merges in a default for existing users who never set them.

---

### Task 1: Add `major` to settings storage

**Files:**
- Modify: `public/js/chat-store.js:103-116`

**Interfaces:**
- Produces: `SETTINGS_DEFAULTS.major` (string, default `''`), which `loadSettings()` merges into every settings object going forward (used by Tasks 2 and 3).

- [ ] **Step 1: Add the `major` key to `SETTINGS_DEFAULTS`**

In `public/js/chat-store.js`, the current block is:

```js
const SETTINGS_DEFAULTS = {
  studentName: 'Student',
  homeCampus: 'University partner',
  priority: 'Arrival readiness',
  notifications: true,
  conciseMode: false,
  userContext: '',
  situation: '',
  scholarshipStatus: '',
  language: 'auto',
  destination: 'auto',
  dataConsent: false,
  webSearch: true,
};
```

Change it to:

```js
const SETTINGS_DEFAULTS = {
  studentName: 'Student',
  homeCampus: 'University partner',
  major: '',
  priority: 'Arrival readiness',
  notifications: true,
  conciseMode: false,
  userContext: '',
  situation: '',
  scholarshipStatus: '',
  language: 'auto',
  destination: 'auto',
  dataConsent: false,
  webSearch: true,
};
```

- [ ] **Step 2: Verify in the browser console**

Run: `npm run dev`

Open `http://localhost:3000/chat.html` in a browser, open devtools console, and run:

```js
import('/js/chat-store.js').then(m => console.log(m.loadSettings()))
```

Expected: the logged object includes `major: ''` (or a previously-set value, but the key must be present — not `undefined`).

- [ ] **Step 3: Commit**

```bash
git add public/js/chat-store.js
git commit -m "feat(settings): add major/field-of-study setting key"
```

---

### Task 2: Add "Major or field of study" to Settings → Profile

**Files:**
- Modify: `public/chat.html:110-113`
- Modify: `public/js/chat-page.js:642-645` (change handler)
- Modify: `public/js/chat-page.js:739-746` (`populateSettingsPanel`)

**Interfaces:**
- Consumes: `state.settings.major` (from Task 1).
- Produces: `data-setting-major` input wired to `state.settings.major`, readable/writable the same way `data-setting-campus` is — later tasks don't depend on this, but it gives the user a persistent place to edit what onboarding (Task 3) will collect.

- [ ] **Step 1: Add the settings field markup**

In `public/chat.html`, the current campus field block is:

```html
                <div class="settings-field">
                  <label for="settings-campus">University or campus</label>
                  <input id="settings-campus" class="settings-input" type="text" data-setting-campus placeholder="Your university or campus" autocomplete="organization" />
                </div>
                <div class="settings-field">
                  <label for="settings-destination">Study destination</label>
```

Insert a new field between the campus field and the destination field:

```html
                <div class="settings-field">
                  <label for="settings-campus">University or campus</label>
                  <input id="settings-campus" class="settings-input" type="text" data-setting-campus placeholder="Your university or campus" autocomplete="organization" />
                </div>
                <div class="settings-field">
                  <label for="settings-major">Major or field of study</label>
                  <input id="settings-major" class="settings-input" type="text" data-setting-major placeholder="Your major or field of study" autocomplete="off" />
                </div>
                <div class="settings-field">
                  <label for="settings-destination">Study destination</label>
```

- [ ] **Step 2: Wire the change handler**

In `public/js/chat-page.js`, the current campus handler is:

```js
  qs('[data-setting-campus]')?.addEventListener('change', (e) => {
    state.settings.homeCampus = e.target.value.trim();
    persistSettings();
  });
```

Add a matching handler immediately after it:

```js
  qs('[data-setting-campus]')?.addEventListener('change', (e) => {
    state.settings.homeCampus = e.target.value.trim();
    persistSettings();
  });

  qs('[data-setting-major]')?.addEventListener('change', (e) => {
    state.settings.major = e.target.value.trim();
    persistSettings();
  });
```

- [ ] **Step 3: Populate the field when the settings panel renders**

In `public/js/chat-page.js`, `populateSettingsPanel()` currently starts:

```js
function populateSettingsPanel() {
  const { studentName, homeCampus, userContext, conciseMode, language, destination, situation, scholarshipStatus, dataConsent, webSearch } = state.settings;

  const nameEl = qs('[data-setting-name]');
  if (nameEl) nameEl.value = studentName === 'Student' ? '' : studentName;

  const campusEl = qs('[data-setting-campus]');
  if (campusEl) campusEl.value = homeCampus === 'University partner' ? '' : homeCampus || '';

  const ctxEl = qs('[data-setting-context]');
```

Change it to destructure `major` and populate the new input:

```js
function populateSettingsPanel() {
  const { studentName, homeCampus, major, userContext, conciseMode, language, destination, situation, scholarshipStatus, dataConsent, webSearch } = state.settings;

  const nameEl = qs('[data-setting-name]');
  if (nameEl) nameEl.value = studentName === 'Student' ? '' : studentName;

  const campusEl = qs('[data-setting-campus]');
  if (campusEl) campusEl.value = homeCampus === 'University partner' ? '' : homeCampus || '';

  const majorEl = qs('[data-setting-major]');
  if (majorEl) majorEl.value = major || '';

  const ctxEl = qs('[data-setting-context]');
```

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open `http://localhost:3000/chat.html`.

1. Open Settings, go to the Profile tab.
2. Confirm a "Major or field of study" field appears directly under "University or campus".
3. Type `Computer Science`, click away (blur) to fire the `change` event.
4. Reload the page, reopen Settings → Profile.
5. Expected: the field still shows `Computer Science` (confirms it round-trips through `localStorage`).

- [ ] **Step 5: Commit**

```bash
git add public/chat.html public/js/chat-page.js
git commit -m "feat(settings): add major/field-of-study field to Profile tab"
```

---

### Task 3: Add the major question to onboarding step 3

**Files:**
- Modify: `public/chat.html:401-407`
- Modify: `public/js/chat-page.js:1146-1168` (`completeOnboarding` and its Enter-key bindings, inside `showOnboarding()`)

**Interfaces:**
- Consumes: `state.settings.major` (Task 1), `qsa` (already imported in `chat-page.js` from `./core.js`).
- Produces: onboarding step 3 writes `state.settings.major` on submit, same convention as `studentName`/`homeCampus`.

- [ ] **Step 1: Add the major input to onboarding step 3 markup**

In `public/chat.html`, the current step 3 block is:

```html
        <div class="onboarding-step" data-ob-step="3" hidden>
          <p class="onboarding-title">Set up your scholar profile</p>
          <p class="onboarding-hint">Optional, but it helps OmanX check the right university and sponsor context.</p>
          <input class="onboarding-name-input" data-onboarding-name type="text" placeholder="Your name" autocomplete="given-name" />
          <input class="onboarding-name-input" data-onboarding-campus type="text" placeholder="University or campus" autocomplete="organization" />
          <button class="btn onboarding-submit" data-onboarding-submit type="button">Start asking &rarr;</button>
        </div>
```

Change it to:

```html
        <div class="onboarding-step" data-ob-step="3" hidden>
          <p class="onboarding-title">Set up your scholar profile</p>
          <p class="onboarding-hint">Optional, but it helps OmanX check the right university and sponsor context.</p>
          <input class="onboarding-name-input" data-onboarding-name type="text" placeholder="Your name" autocomplete="given-name" />
          <input class="onboarding-name-input" data-onboarding-campus type="text" placeholder="University or campus" autocomplete="organization" />
          <input class="onboarding-name-input" data-onboarding-major type="text" placeholder="Major or field of study" autocomplete="off" />
          <button class="btn onboarding-submit" data-onboarding-submit type="button">Start asking &rarr;</button>
        </div>
```

- [ ] **Step 2: Read the major field in `completeOnboarding()`**

In `public/js/chat-page.js`, the current function is:

```js
  function completeOnboarding() {
    const name = (qs('[data-onboarding-name]', overlay)?.value || '').trim();
    const campus = (qs('[data-onboarding-campus]', overlay)?.value || '').trim();
    if (name) {
      state.settings.studentName = name;
    }
    if (campus) {
      state.settings.homeCampus = campus;
    }
    state.settings.destination = selectedDest;
    state.settings.situation = selectedSituation;
    persistSettings();
    markOnboarded();
    overlay.hidden = true;
    updateUserChip();
    populateSettingsPanel();
    render();
  }
```

Change it to:

```js
  function completeOnboarding() {
    const name = (qs('[data-onboarding-name]', overlay)?.value || '').trim();
    const campus = (qs('[data-onboarding-campus]', overlay)?.value || '').trim();
    const major = (qs('[data-onboarding-major]', overlay)?.value || '').trim();
    if (name) {
      state.settings.studentName = name;
    }
    if (campus) {
      state.settings.homeCampus = campus;
    }
    if (major) {
      state.settings.major = major;
    }
    state.settings.destination = selectedDest;
    state.settings.situation = selectedSituation;
    persistSettings();
    markOnboarded();
    overlay.hidden = true;
    updateUserChip();
    populateSettingsPanel();
    render();
  }
```

- [ ] **Step 3: Extend the Enter-key-submits behavior to all three step-3 inputs**

Immediately below `completeOnboarding()`, the current bindings are:

```js
  qs('[data-onboarding-submit]', overlay)?.addEventListener('click', completeOnboarding);
  qs('[data-onboarding-name]', overlay)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') completeOnboarding();
  });
```

Change to:

```js
  qs('[data-onboarding-submit]', overlay)?.addEventListener('click', completeOnboarding);
  qsa('[data-onboarding-name], [data-onboarding-campus], [data-onboarding-major]', overlay).forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') completeOnboarding();
    });
  });
```

- [ ] **Step 4: Feed major into the AI's profile context**

In `public/js/chat-page.js`, `buildProfileContext()` currently is:

```js
function buildProfileContext(userContext = '') {
  const parts = [];
  if (state.settings.homeCampus && state.settings.homeCampus !== 'University partner') {
    parts.push(`University or campus: ${state.settings.homeCampus}.`);
  }
  if (state.settings.situation) parts.push(`Student situation: ${state.settings.situation}.`);
  if (state.settings.scholarshipStatus) parts.push(`Scholarship status: ${state.settings.scholarshipStatus}.`);
  if (state.settings.destination && state.settings.destination !== 'auto') {
    parts.push(`Study destination: ${DEST_FULL_LABEL[state.settings.destination] || state.settings.destination}.`);
  }
  if (userContext) parts.push(userContext);
  return parts.join('\n');
}
```

Add a `major` line after the campus check:

```js
function buildProfileContext(userContext = '') {
  const parts = [];
  if (state.settings.homeCampus && state.settings.homeCampus !== 'University partner') {
    parts.push(`University or campus: ${state.settings.homeCampus}.`);
  }
  if (state.settings.major) parts.push(`Major or field of study: ${state.settings.major}.`);
  if (state.settings.situation) parts.push(`Student situation: ${state.settings.situation}.`);
  if (state.settings.scholarshipStatus) parts.push(`Scholarship status: ${state.settings.scholarshipStatus}.`);
  if (state.settings.destination && state.settings.destination !== 'auto') {
    parts.push(`Study destination: ${DEST_FULL_LABEL[state.settings.destination] || state.settings.destination}.`);
  }
  if (userContext) parts.push(userContext);
  return parts.join('\n');
}
```

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, open `http://localhost:3000/chat.html`, open devtools console and run `localStorage.removeItem('omanx.onboarded.v1')`, then reload.

1. Click through to onboarding step 3 (pick any destination, then any situation).
2. Confirm three inputs appear in order: Name, University or campus, Major or field of study.
3. Type a name, campus, and major (e.g. `Amal`, `NYU`, `Computer Science`), press Enter in the major field.
4. Expected: onboarding closes (Enter submits from the major field, same as from the name field).
5. Open Settings → Profile and confirm "Major or field of study" shows `Computer Science`.

- [ ] **Step 6: Commit**

```bash
git add public/chat.html public/js/chat-page.js
git commit -m "feat(onboarding): ask for major/field of study in profile step"
```

---

### Task 4: Wire the dormant Google auth step into onboarding

**Files:**
- Modify: `public/chat.html:365` (copy)
- Modify: `public/js/chat-page.js:1118-1124` (`showOnboarding()`)

**Interfaces:**
- Consumes: `state.auth.enabled`, `state.auth.signedIn` (already populated on `state.auth` before `maybeShowOnboarding()` runs — see `chat-page.js:53-58`), `signInWithGoogle` (already imported at `chat-page.js:3`), `showToast` (already imported from `./core.js`).
- Produces: onboarding now opens on the `auth` step for signed-out users on auth-enabled deployments, and on step `1` otherwise. Task 5 relies on this same starting-step logic being in place (so its skip control is hidden correctly on first paint).

- [ ] **Step 1: Update the auth step's hint copy**

In `public/chat.html`, the current line is:

```html
          <p class="onboarding-hint">You can ask 3 questions first. Sign in to keep chats across devices, attach screenshots, and continue longer conversations.</p>
```

Change it to:

```html
          <p class="onboarding-hint">Sign in with Google for 50 questions a day instead of 3, plus synced history across devices.</p>
```

- [ ] **Step 2: Pick a dynamic starting step and wire the auth buttons**

In `public/js/chat-page.js`, the current start of `showOnboarding()` is:

```js
function showOnboarding() {
  const overlay = qs('[data-onboarding]');
  if (!overlay) return;
  overlay.hidden = false;
  showOnboardingStep(overlay, '1');

  let selectedDest = 'auto';
  let selectedSituation = state.settings.situation || 'Current student';
```

Change it to:

```js
function showOnboarding() {
  const overlay = qs('[data-onboarding]');
  if (!overlay) return;
  overlay.hidden = false;
  const startStep = (state.auth.enabled && !state.auth.signedIn) ? 'auth' : '1';
  showOnboardingStep(overlay, startStep);

  let selectedDest = 'auto';
  let selectedSituation = state.settings.situation || 'Current student';

  qs('[data-onboarding-auth]', overlay)?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showToast(error.message || 'Google sign-in is not available yet.');
    }
  });

  qs('[data-onboarding-skip-auth]', overlay)?.addEventListener('click', () => {
    showOnboardingStep(overlay, '1');
  });
```

(Leave the rest of the function — the `[data-dest]` and `[data-situation]` listeners and `completeOnboarding()` — unchanged; they follow immediately after this block.)

- [ ] **Step 3: Manually verify — signed-out path**

Run: `npm run dev`, open `http://localhost:3000/chat.html` in a private/incognito window (so there's no existing Supabase session), open devtools console and run `localStorage.removeItem('omanx.onboarded.v1')`, then reload.

1. If this deployment has `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` configured (check `.env`): expected the onboarding overlay opens on "Keep this history across devices?" with the updated copy ("50 questions a day instead of 3"). Click "Continue as guest" — expected it advances to "Where are you studying?" (step 1).
2. If Supabase is not configured locally: `state.auth.enabled` will be `false`, so onboarding should open directly on step 1 (destination) — confirm the auth step never appears in that case.
3. Re-run `localStorage.removeItem('omanx.onboarded.v1')` and reload again; this time click "Continue with Google" (only if Supabase is configured) and confirm it either redirects to Google's OAuth screen or, if misconfigured, shows a toast ("Google sign-in is not available yet.") rather than throwing an unhandled error.

- [ ] **Step 4: Manually verify — signed-in path**

With an active signed-in session (or immediately after completing the Google redirect from Step 3), run `localStorage.removeItem('omanx.onboarded.v1')` in the console and reload.

Expected: onboarding opens directly on step 1 ("Where are you studying?") — the auth step is skipped entirely because `state.auth.signedIn` is `true`.

- [ ] **Step 5: Commit**

```bash
git add public/chat.html public/js/chat-page.js
git commit -m "feat(onboarding): wire up the Google sign-in step"
```

---

### Task 5: Add a "Skip for now" control to steps 1–3

**Files:**
- Modify: `public/chat.html:407-408`
- Modify: `public/js/chat-page.js:1112-1116` (`showOnboardingStep`)
- Modify: `public/js/chat-page.js` (inside `showOnboarding()`, after Task 4's changes)

**Interfaces:**
- Consumes: `completeOnboarding` (defined later in the same function but hoisted as a function declaration, so it's callable from earlier in `showOnboarding()`), `showOnboardingStep` (Task 4's dynamic-start version).
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Add the skip control markup**

In `public/chat.html`, the current end of the onboarding card is:

```html
          <input class="onboarding-name-input" data-onboarding-major type="text" placeholder="Major or field of study" autocomplete="off" />
          <button class="btn onboarding-submit" data-onboarding-submit type="button">Start asking &rarr;</button>
        </div>
      </div>
    </div>
```

Change it to add a skip button as a sibling of the step divs, after the closing `</div>` of step 3:

```html
          <input class="onboarding-name-input" data-onboarding-major type="text" placeholder="Major or field of study" autocomplete="off" />
          <button class="btn onboarding-submit" data-onboarding-submit type="button">Start asking &rarr;</button>
        </div>

        <button class="onboarding-skip" data-onboarding-skip-setup type="button" hidden>Skip for now</button>
      </div>
    </div>
```

- [ ] **Step 2: Toggle its visibility alongside step changes**

In `public/js/chat-page.js`, the current function is:

```js
function showOnboardingStep(overlay, step) {
  qsa('[data-ob-step]', overlay).forEach((el) => {
    el.hidden = el.dataset.obStep !== step;
  });
}
```

Change it to:

```js
function showOnboardingStep(overlay, step) {
  qsa('[data-ob-step]', overlay).forEach((el) => {
    el.hidden = el.dataset.obStep !== step;
  });
  const skipSetup = qs('[data-onboarding-skip-setup]', overlay);
  if (skipSetup) skipSetup.hidden = step === 'auth';
}
```

- [ ] **Step 3: Wire the click handler**

In `public/js/chat-page.js`, inside `showOnboarding()`, the auth handlers added in Task 4 are:

```js
  qs('[data-onboarding-auth]', overlay)?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showToast(error.message || 'Google sign-in is not available yet.');
    }
  });

  qs('[data-onboarding-skip-auth]', overlay)?.addEventListener('click', () => {
    showOnboardingStep(overlay, '1');
  });
```

Add the skip-setup handler immediately after them:

```js
  qs('[data-onboarding-auth]', overlay)?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showToast(error.message || 'Google sign-in is not available yet.');
    }
  });

  qs('[data-onboarding-skip-auth]', overlay)?.addEventListener('click', () => {
    showOnboardingStep(overlay, '1');
  });

  qs('[data-onboarding-skip-setup]', overlay)?.addEventListener('click', completeOnboarding);
```

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open `http://localhost:3000/chat.html`, open devtools console and run `localStorage.removeItem('omanx.onboarded.v1')`, then reload.

1. If the flow opens on the auth step, confirm "Skip for now" is NOT visible there (only "Continue with Google" / "Continue as guest" are). Click "Continue as guest" to advance to step 1.
2. On step 1 (destination), confirm "Skip for now" is visible at the bottom of the card. Click it.
3. Expected: the overlay closes immediately, `localStorage.getItem('omanx.onboarded.v1')` is `'1'`, and Settings → Profile shows the destination as auto-detect (or whatever was picked before skipping), situation blank/"Current student" default, and name/campus/major blank.
4. Repeat: reset onboarding, this time click a destination card (advances to step 2), then click "Skip for now" there. Confirm the destination you picked is preserved in Settings → Profile → Study destination, while situation/name/campus/major stay at defaults.
5. Repeat once more: reset onboarding, click through destination and situation to reach step 3, type a name, then click "Skip for now" instead of "Start asking". Confirm the name you typed was saved (skip reuses the same completion path, so any step-3 input already filled in is honored) and onboarding still closes.

- [ ] **Step 5: Commit**

```bash
git add public/chat.html public/js/chat-page.js
git commit -m "feat(onboarding): add skip-for-now control to questionnaire steps"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (auth step wiring, starting-step logic, redirect-return behavior, copy) → Task 4. Section 2 (major field in onboarding + Settings + AI context) → Tasks 1, 2, 3. Section 3 (skip control, single shared element, reuses `completeOnboarding`) → Task 5. All three spec sections are covered.
- **Ordering rationale:** Task 1 (storage key) precedes Tasks 2–3 which read/write it. Task 4 (starting-step logic) precedes Task 5 (skip-visibility logic) because Task 5's `showOnboardingStep` change assumes the `auth` step already exists in rotation.
- **Type/name consistency checked:** `data-onboarding-major` / `state.settings.major` / `data-setting-major` used consistently across Tasks 1–3; `data-onboarding-skip-setup` used consistently between markup (Task 5 Step 1), `showOnboardingStep` (Task 5 Step 2), and the click handler (Task 5 Step 3).

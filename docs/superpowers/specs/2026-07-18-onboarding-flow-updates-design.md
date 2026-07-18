# Onboarding flow updates — design

## Context

`public/chat.html` already contains a fully-styled but unwired "auth" onboarding step (`data-ob-step="auth"`): a "Continue with Google" button and a "Continue as guest" skip link. Neither has a click handler in `public/js/chat-page.js`, and `showOnboarding()` starts unconditionally at step `1` (destination), so this step has never been shown to a user. This design finishes wiring it up and adds two more changes to the same flow: a major/field-of-study question, and a "Skip for now" control on the remaining steps.

Current step order: `1` (destination) → `2` (situation) → `3` (name/campus, submit).
New step order: `auth` (conditional) → `1` → `2` → `3` (name/campus/major, submit).

## 1. Wire up the Google auth step

**Starting step.** `showOnboarding()` picks the first step to display instead of hardcoding `'1'`:
- If `state.auth.enabled` is true and `state.auth.signedIn` is false → start at `'auth'`.
- Otherwise (already signed in, or this deployment has no Supabase configured) → start at `'1'`.

This must run after `state.auth` is populated. `maybeShowOnboarding()` is already only called from inside `initAuth().then(...)` and from `onAuthChange`, so `state.auth` is populated by the time it runs — no new sequencing needed.

**Google sign-in is a full-page redirect** (`supabase.auth.signInWithOAuth` with `redirectTo`). Clicking "Continue with Google" navigates away; the app reloads on return. `maybeShowOnboarding()` fires again on that reload. Because `state.auth.signedIn` is now true, the starting-step logic above sends the user straight to step `1` instead of re-showing the auth step — no special-case handling needed beyond the starting-step logic itself.

**Handlers:**
- `data-onboarding-auth` click → `await signInWithGoogle()` in a try/catch, `showToast(error.message || 'Google sign-in is not available yet.')` on failure. Same pattern as the existing `data-auth-gate-google` handler at `chat-page.js:529`.
- `data-onboarding-skip-auth` click → `showOnboardingStep(overlay, '1')`.

**Copy change.** Replace the current hint text with copy that states the concrete incentive using the real quota numbers (`ANONYMOUS_RATE_LIMIT_MAX = 3`, `AUTHENTICATED_RATE_LIMIT_MAX = 50`, from `api/rate-limit.js`):

> "Sign in with Google for 50 questions a day instead of 3, plus synced history across devices."

Title and button label stay as-is ("Keep this history across devices?", "Continue with Google").

## 2. Major / field of study field

**Onboarding step 3** (`data-ob-step="3"`): add a third input directly after `data-onboarding-campus`, before the submit button:
```html
<input class="onboarding-name-input" data-onboarding-major type="text" placeholder="Major or field of study" autocomplete="off" />
```
`completeOnboarding()` reads it the same way name/campus are read: trimmed value, only written to `state.settings.major` if non-empty. The existing Enter-key-submits behavior (currently only bound to `data-onboarding-name`) is extended to this field too, for consistency across all three step-3 inputs.

**Settings → Profile**: add a matching field in `chat.html` immediately after the `settings-campus` field:
```html
<div class="settings-field">
  <label for="settings-major">Major or field of study</label>
  <input id="settings-major" class="settings-input" type="text" data-setting-major placeholder="Your major or field of study" autocomplete="off" />
</div>
```
Wired with a `change` handler mirroring `data-setting-campus` (`chat-page.js:642`), and populated in `populateSettingsPanel()` alongside `campusEl`.

**Storage.** New key `major` in `SETTINGS_DEFAULTS` (`chat-store.js`), default `''`.

**AI context.** `buildProfileContext()` gets a new line so the field is actually used, not just stored:
```js
if (state.settings.major) parts.push(`Major or field of study: ${state.settings.major}.`);
```

## 3. "Skip for now"

One link, reusing the existing `.onboarding-skip` class, placed once as a direct child of `.onboarding-card` (after the three step divs) rather than duplicated per step. Its `hidden` state is toggled by `showOnboardingStep()` alongside the step divs: hidden when the current step is `'auth'` (which already has its own "Continue as guest"), visible for steps `1`, `2`, `3`.

Clicking it calls the same `completeOnboarding()` function the step-3 submit button uses. Because `completeOnboarding()` already reads whatever `selectedDest` / `selectedSituation` the user has picked so far (defaulting to `'auto'` / `state.settings.situation || 'Current student'` if untouched) and whatever step-3 inputs are filled in (blank if step 3 was never reached), no new "skip" logic is needed — it's the existing completion path, just reachable early. This matches the stated rationale: these fields are optional and all remain editable later in Settings.

## Out of scope

- No changes to the rate-limit values themselves, only surfacing the existing numbers in copy.
- No changes to the magic-link sign-in path or the post-3-questions auth gate (`AUTH_GATE_MESSAGE` / `data-auth-gate-*`) — those are separate flows from onboarding.
- No new onboarding step is added for major; it slots into existing step 3.

# UX Principles for Matrx Local

> **Every developer must read this before touching the UI.**
>
> These are not suggestions. They are the bar we hold every screen, every message, and every interaction to.

---

## Who We Are Building For

Our users are smart, curious people — but they are not engineers. They are researchers, students, creators, and professionals who want AI tools to work *for* them. They did not sign up for error codes, token prefixes, or HTTP status numbers. They signed up because AI Matrx promised to make powerful technology simple.

When a user encounters a problem, they ask: *"Did I break something? Is it broken? What do I do?"*

Our job is to answer those three questions immediately, calmly, and helpfully — every single time.

---

## The Rules

### 1. Never Punish the User for Something the System Could Have Done First

If the system can attempt an operation and fail gracefully, it must do that before asking the user for anything.

**Wrong:** Show a "You must enter a token before downloading" gate before attempting the download.

**Right:** Attempt the download. If it fails because a token is needed, *then* explain that — calmly, and only for that specific model.

The user should never be blocked by a form they didn't need to fill out.

---

### 2. Every Error Is a Conversation, Not a Crash Report

An error message is the moment the user is most likely to give up and leave. Treat it like a conversation, not a log dump.

**Wrong:**
```
XET_TOKEN_REQUIRED: This model is hosted on HuggingFace's XET storage system.
A free HuggingFace access token is required to download it.
```

**Right:**
> "One small step before downloading. This model requires a free Hugging Face account and access token — it takes 2 minutes and you only need to do it once."

Rules:
- No internal error codes visible to users (no `XET_TOKEN_REQUIRED`, no `HTTP 403`, no `PGRST204`)
- No stack traces
- No jargon unless the user has opted into technical detail
- Use plain, warm language. Assume your user's grandparent might be reading it.
- Start with what happened, then what they can do about it

---

### 3. Unexpected Does Not Mean Broken

Many outcomes are *expected* — a file that needs a token, a server that isn't running yet, a feature that requires setup. These are not errors. They are states.

Do not use:
- Red banners
- Warning icons
- The word "Error" or "Failed"

...for an expected condition. Use neutral or positive framing:
- "One more thing needed"
- "Just one step first"
- "This model needs a free account"

Reserve destructive styling (red, alert icons) for things that are genuinely broken: network failures, corrupted files, unrecoverable states.

---

### 4. Guide, Don't Gate

When a user needs to do something external (create an account, generate an API key, install a dependency), give them the exact steps and take them as far as the system possibly can.

Required elements:
- Step-by-step instructions in plain English (numbered list)
- A direct link to the exact page they need — not the homepage
- If the user might not have an account: ask first, then branch into the right path
- A place to complete the action without leaving the app if possible
- A clear "what happens next" so they know the loop closes

Optional but excellent:
- Open the browser for them (`openUrl()`)
- Pre-fill forms if possible
- Confirm when the action is complete and automatically continue

---

### 5. One Problem = One Modal

When something blocks progress, show exactly one clear, focused intervention. Do not:
- Show a banner *and* a modal
- Interrupt the user twice for the same issue
- Show the same information in multiple places

The intervention should:
1. Appear only once
2. Contain everything the user needs
3. Go away cleanly when resolved
4. Allow the user to "skip for now" if they choose

---

### 6. State Is Not the User's Problem

The user does not need to manage our state. If the system needs a piece of information (a token, a file path, a setting), it should:
1. Check if it already has it
2. If not, ask once — not every time
3. Remember what it was told

Never ask the user for something the system previously stored. Never forget what the user already gave us.

---

### 7. The Happy Path Must Be Frictionless

For the most common action a user takes, there should be zero unnecessary steps. If 95% of models can be downloaded without a token, the 5% case must not add friction to the 95%.

Audit every flow: what does the user have to do to accomplish the most common thing? Every step that isn't necessary is a step that should be removed.

---

### 8. Recover Automatically When Possible

After resolving an issue (entering a token, completing setup), the system should pick up exactly where it left off. The user should not have to click "retry" or re-initiate the action they already asked for.

If the user gave us a token in response to a blocked download, that download should start automatically.

---

## Checklist Before Shipping Any UI Change

Before merging UI changes, verify each item:

- [ ] Does any new flow ask the user for something before trying it first?
- [ ] Does any error message contain a raw code, a status number, or technical jargon?
- [ ] Is any expected state (setup required, token needed, feature optional) using error/warning styling?
- [ ] Are all external actions (links, signups, token creation) guided with step-by-step instructions?
- [ ] Does the system automatically continue after the user resolves a blocking condition?
- [ ] Is there a clean way to dismiss or skip any blocking UI?
- [ ] Is the same issue shown in more than one place?

If you answer "yes" to any of the first two, or "no" to any of the last five, revise before merging.

---

## The Standard

When in doubt, ask: *"Would this confuse or worry someone who has never used a developer tool in their life?"*

If yes — rewrite it.

That is the bar.

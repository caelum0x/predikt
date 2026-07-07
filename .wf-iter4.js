export const meta = {
  name: 'iterate-develop-huddle',
  description: 'Iteration 4: harden Huddle — messaging + scheduling reliability test coverage, robustness (offline/connection-loss/homeserver errors), and chat-screen a11y. Verify.',
  phases: [
    { title: 'Develop' },
    { title: 'Verify' },
  ],
}

const H = '/Users/arhansubasi/expo games and apps/slack-clone-react-native'
const ENV = `Headless: no device, no live Matrix homeserver — real send/sync/media/voice-video need a device+homeserver and can't run here; harden + UNIT-test the pure logic (message formatting, waveform, scheduling/reminder timing, permission/power-level checks, parsing) and make the code defensively correct. No heavy installs; \`npx tsc --noEmit\` + tests only if node_modules exists. REAL tests only (no mocks-of-production, no empty asserts). No secrets. Keep server-side scheduling (MSC4140 + worker) + the on-device fallback intact.`

phase('Develop')
log('Harden Huddle: messaging + scheduling + a11y.')

const msg = () => agent(`Harden Huddle's MESSAGING + SCHEDULING logic at ${H}. Add FOCUSED unit tests + robustness for the pure/critical logic:
- Scheduling: src/projects/reminders.ts + useReminderFlush + engagement/eventReminders + the scheduleSend priority (MSC4140 -> worker -> on-device) + the worker's dispatch loop (idempotent txn ids, retry/max-attempts, permanent-failure detection). Test the timing/decision logic with crafted inputs (due/not-due, past deadline, cancel, dedupe).
- Messaging pure logic: message formatting/markdown, mentions, waveform (media/waveform.ts downsample/normalize/pack-unpack the 0..1024 form), reaction aggregation, thread/reply shaping, permission/power-level checks (who can post/redact/kick).
- Robustness: offline/connection-loss handling (queue + retry, no crash), homeserver-error fallbacks (honest error state), and capability checks (supportsDelayedEvents gates MSC4140 before use).
${ENV}
Output: tests added (count + modules), robustness guards, tsc/test result; note what needs a live homeserver.`, { label: 'huddle:msg', phase: 'Develop', agentType: 'general-purpose' })

const ui = () => agent(`Harden Huddle's CHAT UI robustness + a11y at ${H}:
- Accessibility: add accessibilityLabel/role/hint to interactive controls on the key screens (room/timeline, message composer, thread view, room/space list, scheduled/reminders, search, settings) — especially icon-only buttons (send, attach, react, mic/voice, more). Don't restyle.
- Robustness: loading/error/empty states on data-driven screens (timeline, search, room list); safe handling when the homeserver/session is unavailable (honest state, no crash); guard undefined in message/room rendering; media (image/voice) failure fallbacks.
- Polish: fix rough user-visible edges (missing empty-state text, inconsistent copy) — small, safe.
${ENV}
Output: a11y labels (count + screens), robustness guards, polish fixes, tsc/test result.`, { label: 'huddle:ui', phase: 'Develop', agentType: 'general-purpose' })

const done = (await parallel([msg, ui])).filter(Boolean)

phase('Verify')
log('Verify iteration 4 (Huddle).')
const review = await agent(`Verify Huddle iteration 4 hardening at ${H}. Confirm PASS/PARTIAL/FAIL:
- Messaging/scheduling: real unit tests for reminder/schedule timing + the MSC4140->worker->device priority + waveform/formatting/power-level logic; capability-gated MSC4140; offline/error handled without crash. Server-side scheduling + on-device fallback intact.
- A11y: interactive controls on chat screens labeled (icon-only buttons especially).
- Robustness: data screens handle loading/error/empty; homeserver-unavailable safe.
- No regressions: tsc + tests green, no secrets, GREENLIT compliance intact.
Report per-track: tests added (count), robustness gained, residual (what needs a live homeserver/device), a 0-10 quality-delta, and the top 3 for the NEXT iteration.`, { label: 'verify', phase: 'Verify', agentType: 'code-reviewer' })

return { done: done.length, review }

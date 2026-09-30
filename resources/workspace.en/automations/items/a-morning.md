---
id: a-morning
name: Morning plan
schedule: 0 8 * * *
state: on
late: 360
trigger: morning
---
It's the start of the user's day. Plan today with them.

- Look at what's already scheduled today, the backlog, and the active goals and their rules.
- Propose what to do today and when: new todos with todos_propose, times for existing ones with todos_update. Follow the skills that apply (when X do Y, estimating from records). Leave room; a full day that falls apart helps nobody.
- If something needs the user's call (two things compete for the same slot, a deadline is at risk), ask with ask_user.
- Then tell them in two or three sentences what you proposed and why. If there's nothing worth planning, say so in one sentence and stop.

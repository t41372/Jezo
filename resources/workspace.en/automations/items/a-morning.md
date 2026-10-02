---
id: a-morning
name: Morning plan
schedule: 0 8 * * *
state: on
catch_up: until 18:00
trigger: morning
---
Plan the rest of today with the user. The note above says what time it is and how late this run is; when it's late, plan only the hours left, never ones already past.

- Look at what's already scheduled today, the backlog, and the active goals and their rules. If a small experiment is running, plan today by the condition of the arm today is in.
- Propose what to do today and when: new todos with todos_propose, times for existing ones with todos_update. Follow the skills that apply (when X do Y, estimating from records). Leave room; a full day that falls apart helps nobody.
- If the user has been away for a while (the note says several were missed), start from today: don't make up for the missed days, and don't list what they didn't do.
- If something needs the user's call (two things compete for the same slot, a deadline is at risk), ask with ask_user.
- Then tell them in two or three sentences what you proposed and why. If there's nothing worth planning, say so in one sentence and stop.

# Small experiments

Status: decided on 2026-09-30. concept.md lists n-of-1 experiments among the built-in methods: the user wants to know whether a way of doing things (the hardest thing first, flashcards before bed) works for them, and the agent alternates it with the usual way, counts from the records, and says what it found. Until this date 更多 → 小實驗 showed the mockup's two made-up experiments.

## What it is

- **A workspace plugin, `experiments/`,** like todos and goals: a manifest (kind `experiment`, prefix `x`), an AGENTS.md for the agent, and one file per experiment in `items/`. The frontmatter has the title, `running` or `finished`, what's measured in words, and two or more arms. Each arm has a label, a condition (what's different on those days, as an instruction the agent can plan by), the date ranges it runs, and, once over, its value and how it was counted. Then the conclusion, and the user's decision. The body is the question in the user's words.
- **The method is a skill, `experiments/skills/small-experiments`** (AGENTS.md, principle 6): measure what the todos can show, alternate the arms week by week rather than one after the other so a busy fortnight doesn't land on one side, start next Monday, count with `todos_list` from the done todos' dates, and name what else differed between the arms in the conclusion. No counting or scheduling is in TypeScript; a user who wants another method changes the skill.
- **Each day's instructions say which arm today is in** for every running experiment (`digest()`), with its condition. Without that, the morning plan would never know an experiment was running.
- **The weekly review looks at the numbers** and, after the last week, writes the result: one sentence in the built-in automation's body, which the user can edit. No scheduler of its own.
- **The page** shows a running experiment by its week and this week's arm, and a finished one by each arm's value and the conclusion. 採用, 再試一次 and 不用了 write `decision` and nothing else. What adopting means for the days (a goal rule, a changed skill) is for the agent when the user asks, and 跟 Jezo 說 puts that request in the chat's box. 新增 does the same for starting one: the agent asks what's needed and writes the file.

## Read in the traces

qwen3.6-35b in LM Studio, 2026-09-30: asked to count a finished experiment, it got both arms right from the todos and wrote the conclusion into the body, since the skill named the field and not where it goes. Both the skill and AGENTS.md now say the conclusion is a frontmatter field and the body stays the user's question; three runs of three wrote it there.

Asked from 新增 to try the hardest thing first for four weeks, counted by a goal's todos, it once laid the design out in its reply and asked "這樣可以嗎？" without writing anything: the skill opened with "問清楚要比什麼". It now says to write the file straight away, using what the user said and picking the rest, and to ask first only when what they want to compare can't be counted from the records; four runs of four wrote the file. In another run it copied the long temporary workspace path with a digit missing, found nothing, and went looking through `/` and the home folder; the system prompt now asks for paths relative to the workspace (backend.md).

Planning the morning with an experiment running (2026-10-02): the arm's line came at the end of the day's instructions, after the count of notes waiting, and the morning plan's request named today's todos, the backlog and the goals but not experiments. In the traces the model never mentioned the experiment and filled the morning from the backlog. The line now comes right after today's todos, and the request says to plan by today's arm; with an arm that puts errands after 20:00, four runs of four did, and with no experiment the same plan put the emails at 08:30, 09:00 and 12:00.

## Tests

`e2e/automations.spec.ts` runs the real morning plan with an arm running and checks today's errands follow it. `e2e/experiments.spec.ts`: the page from files (this week's arm, a finished result, the decision written back), the agent counting a finished experiment from seeded done todos (two evenings, five mornings), and the agent setting one up from 新增. A four-week experiment can't run end to end in a test: the clock would have to move four weeks, with automations firing along the way. The parts it's made of are tested instead.

## Rejected

- **A typed tool to start or finish an experiment.** The agent writes the file with its file tools and the manifest check catches mistakes; a tool would be added only if traces showed the agent failing at that.
- **Counting the result in TypeScript.** What counts as "did it" depends on the experiment (a goal's todos, a title, an amount), and that judgement belongs to the method, which the user can change.
- **Keeping experiments in the store.** They'd be lost on restart and invisible to the agent.

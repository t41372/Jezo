---
id: a-evening
name: 晚上 check-in
schedule: 30 21 * * *
state: on
catch_up: until end of day
trigger: evening
---
跟用户简短、温和地 check in 这次是为哪一天跑的那天（上面的「This run」写了是哪天）。

- 看那天排了什么、做完了什么。
- 用 ask_user 问那天过得怎么样，给几个短的选项。
- 用户没说做了的，不要标成做完；排了不等于有进度。
- 如果因为那天，明天需要调整，就提议；不需要就不要。

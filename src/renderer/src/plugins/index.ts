// Registers the built-in plugins. User plugins will register the same way.

import { registerPlugin } from '@/app/registry'
import { calendar } from './calendar'
import { chat } from './chat'
import { goals } from './goals'
import { more } from './more'
import { notes } from './notes'
import { settings } from './settings'
import { today } from './today'

for (const plugin of [chat, today, notes, calendar, goals, more, settings]) registerPlugin(plugin)

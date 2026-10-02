// Speech models often write Simplified Chinese, Traditional, or a mix. What was
// heard is shown and sent in the app's script: Traditional with Taiwan's usual
// words (OpenCC's cn → tw) when the app is in Traditional Chinese, Simplified
// (t → cn) when it's in Simplified.

import { Converter as toTraditional } from 'opencc-js/cn2t'
import { Converter as toSimplified } from 'opencc-js/t2cn'
import i18n from '@/i18n'

const toTaiwan = toTraditional({ from: 'cn', to: 'tw' })
const toChina = toSimplified({ from: 't', to: 'cn' })

/** Writes text in the Chinese script the app is in at the moment of the call; other languages are left as they are. */
export const inAppScript = (text: string) => (i18n.language === 'zh-TW' ? toTaiwan(text) : i18n.language === 'zh-CN' ? toChina(text) : text)

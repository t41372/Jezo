// Speech models often write Simplified Chinese, or a mix. When the app is in
// Traditional Chinese, what was heard is shown and sent in Traditional, with
// Taiwan's usual words (OpenCC's cn → tw).

import { Converter } from 'opencc-js/cn2t'
import i18n from '@/i18n'

const toTaiwan = Converter({ from: 'cn', to: 'tw' })

/** Converts to Traditional Chinese when the app's language is Traditional Chinese at the moment of the call. */
export const traditional = (text: string) => (i18n.language === 'zh-TW' ? toTaiwan(text) : text)

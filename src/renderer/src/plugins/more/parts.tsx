import { useTranslation } from 'react-i18next'
import { useStore } from '@/data/store'

export function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useTranslation('more')
  const navigate = useStore((s) => s.navigate)
  return (
    <>
      <button onClick={() => navigate('more')} className="self-start text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-150">
        {t('back')}
      </button>
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {children && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</p>}
      </div>
    </>
  )
}

import { ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/**
 * Detail folded away until asked for (AGENTS.md, principle 4): a quiet trigger
 * with a chevron, and content that opens below it.
 */
export function Disclosure({
  label,
  children,
  defaultOpen,
  className,
  triggerClassName,
}: {
  label: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
  triggerClassName?: string
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      <CollapsibleTrigger
        className={cn('group flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground', triggerClassName)}
      >
        <ChevronRight className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-data-panel-open:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

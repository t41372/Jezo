import { cn } from 'cn'
import type { DiffLine } from '@/data/types'

const MARK = { add: '+', remove: '−', context: ' ' } as const

/** Lines of a change to a file: added in green, removed in red. */
export function Diff({ lines, className }: { lines: DiffLine[]; className?: string }) {
  return (
    <pre className={cn('overflow-x-auto rounded-[9px] bg-muted py-2 font-mono text-[11.5px] leading-[1.7]', className)} data-selectable>
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex gap-2 px-3',
            line.kind === 'add' && 'bg-ok/10 text-ok',
            line.kind === 'remove' && 'bg-destructive/10 text-destructive',
            line.kind === 'context' && 'text-muted-foreground',
          )}
        >
          <span aria-hidden className="w-2 shrink-0 select-none">
            {MARK[line.kind]}
          </span>
          <span className="whitespace-pre-wrap">{line.text}</span>
        </div>
      ))}
    </pre>
  )
}

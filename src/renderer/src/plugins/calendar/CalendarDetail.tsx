import { useEffect } from 'react'
import { DetailPanel, EventDetail, TodoDetail } from '@/components/todo/TodoDetail'
import { useStore } from '@/data/store'

export function CalendarDetail() {
  const id = useStore((s) => s.calendarDetail)
  const todo = useStore((s) => s.todos.find((t) => t.id === id))
  const event = useStore((s) => s.events.find((e) => e.id === id))
  const zone = useStore((s) => s.calendarZone ?? s.zone)
  const close = () => useStore.getState().setCalendarDetail(null)
  const open = !!(todo || event)
  // Escape closes the drawer, unless something inside it (a field, a menu) takes the key first.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <DetailPanel open={open} overlay>
      {todo && <TodoDetail key={todo.id} todo={todo} onClose={close} zone={zone} />}
      {event && <EventDetail key={event.id} event={event} onClose={close} />}
    </DetailPanel>
  )
}

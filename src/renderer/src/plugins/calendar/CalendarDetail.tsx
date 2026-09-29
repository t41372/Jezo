import { DetailPanel, EventDetail, TodoDetail } from '@/components/todo/TodoDetail'
import { useStore } from '@/data/store'

export function CalendarDetail() {
  const id = useStore((s) => s.calendarDetail)
  const todo = useStore((s) => s.todos.find((t) => t.id === id))
  const event = useStore((s) => s.events.find((e) => e.id === id))
  const close = () => useStore.getState().setCalendarDetail(null)
  return (
    <DetailPanel open={!!(todo || event)} overlay>
      {todo && <TodoDetail key={todo.id} todo={todo} onClose={close} />}
      {event && <EventDetail key={event.id} event={event} onClose={close} />}
    </DetailPanel>
  )
}

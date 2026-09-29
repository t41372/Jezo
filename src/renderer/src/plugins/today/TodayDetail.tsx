import { DetailPanel, TodoDetail } from '@/components/todo/TodoDetail'
import { useStore } from '@/data/store'

export function TodayDetail() {
  const todo = useStore((s) => s.todos.find((t) => t.id === s.todayDetail))
  const close = () => useStore.getState().setTodayDetail(null)
  return <DetailPanel open={!!todo}>{todo && <TodoDetail key={todo.id} todo={todo} onClose={close} />}</DetailPanel>
}

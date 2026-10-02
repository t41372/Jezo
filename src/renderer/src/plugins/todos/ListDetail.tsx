import { DetailPanel, TodoDetail } from '@/components/todo/TodoDetail'
import { useStore } from '@/data/store'

export function ListDetail() {
  const todo = useStore((s) => s.todos.find((t) => t.id === s.listDetail))
  const close = () => useStore.getState().setListDetail(null)
  return <DetailPanel open={!!todo}>{todo && <TodoDetail key={todo.id} todo={todo} onClose={close} />}</DetailPanel>
}

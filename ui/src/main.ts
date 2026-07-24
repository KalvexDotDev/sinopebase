import { mount } from 'svelte'
import App from './App.svelte'

declare var document: { getElementById(id: string): HTMLElement | null }

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app

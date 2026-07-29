<script lang="ts">
import Layout from './components/Layout.svelte'
import Login from './pages/Login.svelte'
import Dashboard from './pages/Dashboard.svelte'
import Collections from './pages/Collections.svelte'
import Functions from './pages/Functions.svelte'
import AI from './pages/AI.svelte'
import Settings from './pages/Settings.svelte'
import Logs from './pages/Logs.svelte'
import { getCurrentRoute, onRouteChange } from './lib/router'

let authenticated = $state(false)
let currentRoute = $state(getCurrentRoute())

onRouteChange((route) => {
  currentRoute = route
})

function onLogin() {
  authenticated = true
  window.location.hash = '#/'
}

function onLogout() {
  authenticated = false
  window.location.hash = '#/login'
}
</script>

{#if !authenticated}
  <Login onLogin={onLogin} />
{:else}
  <Layout onLogout={onLogout}>
    {#if currentRoute === '#/'}
      <Dashboard />
    {:else if currentRoute === '#/collections'}
      <Collections />
    {:else if currentRoute === '#/functions'}
      <Functions />
    {:else if currentRoute === '#/ai'}
      <AI />
    {:else if currentRoute === '#/settings'}
      <Settings />
    {:else if currentRoute === '#/logs'}
      <Logs />
    {:else}
      <Dashboard />
    {/if}
  </Layout>
{/if}

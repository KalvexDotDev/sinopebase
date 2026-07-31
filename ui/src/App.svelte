<script lang="ts">
  import Layout from './components/Layout.svelte'
  import Login from './pages/Login.svelte'
  import Dashboard from './pages/Dashboard.svelte'
  import Collections from './pages/Collections.svelte'
  import AuthUsers from './pages/AuthUsers.svelte'
  import Storage from './pages/Storage.svelte'
  import RLSPolicies from './pages/RLSPolicies.svelte'
  import ApiDocs from './pages/ApiDocs.svelte'
  import RealtimeInspector from './pages/RealtimeInspector.svelte'
  import Backups from './pages/Backups.svelte'
  import MetricsPage from './pages/Metrics.svelte'
  import AI from './pages/AI.svelte'
  import Functions from './pages/Functions.svelte'
  import Cron from './pages/Cron.svelte'
  import Settings from './pages/Settings.svelte'
  import Logs from './pages/Logs.svelte'
  import { getCurrentRoute, navigate } from './lib/router'
  import { getServiceRoleKey, clearTokens } from './lib/api'

  let authenticated = $state(getServiceRoleKey() !== null)
  let currentRoute = $state(getCurrentRoute())

  $effect(() => {
    const handler = () => { currentRoute = getCurrentRoute() }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  })

  function onLogin() {
    authenticated = true
    navigate('#/')
  }

  function onLogout() {
    clearTokens()
    authenticated = false
    navigate('#/login')
  }
</script>

{#if !authenticated}
  <Login {onLogin} />
{:else}
  <Layout {onLogout}>
    {#if currentRoute === '#/'}
      <Dashboard />
    {:else if currentRoute === '#/tables'}
      <Collections />
    {:else if currentRoute === '#/auth'}
      <AuthUsers />
    {:else if currentRoute === '#/storage'}
      <Storage />
    {:else if currentRoute === '#/policies'}
      <RLSPolicies />
    {:else if currentRoute === '#/api-docs'}
      <ApiDocs />
    {:else if currentRoute === '#/realtime'}
      <RealtimeInspector />
    {:else if currentRoute === '#/backups'}
      <Backups />
    {:else if currentRoute === '#/metrics'}
      <MetricsPage />
    {:else if currentRoute === '#/ai'}
      <AI />
    {:else if currentRoute === '#/functions'}
      <Functions />
    {:else if currentRoute === '#/cron'}
      <Cron />
    {:else if currentRoute === '#/settings'}
      <Settings />
    {:else if currentRoute === '#/logs'}
      <Logs />
    {:else}
      <Dashboard />
    {/if}
  </Layout>
{/if}

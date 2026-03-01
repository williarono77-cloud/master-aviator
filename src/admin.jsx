import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { supabase } from './supabaseClient.js'
import AdminDashboard from './components/AdminDashboard.jsx'
import Toast from './components/Toast.jsx'
import { getToggle } from './utils/storage.js'
import './styles.css'

// Apply saved theme so admin matches main app
const savedTheme = getToggle('theme')
if (savedTheme === 'light') {
  document.documentElement.classList.add('light-mode')
} else {
  document.documentElement.classList.remove('light-mode')
}

function AdminApp() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div>Loading…</div>
      </div>
    )
  }

  return (
    <div className="app">
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <AdminDashboard user={user} setMessage={setMessage} />
    </div>
  )
}

const adminRoot = document.getElementById('admin-root')
if (adminRoot) {
  ReactDOM.createRoot(adminRoot).render(
    <React.StrictMode>
      <AdminApp />
    </React.StrictMode>,
  )
}

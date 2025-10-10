import { defineEventHandler, setCookie } from 'h3'

export default defineEventHandler(async (event) => {
  const expiryDate = new Date(Date.now() + 7200000) // 2 hours

  setCookie(event, 'XSRF-TOKEN', 'eyJpdiI6IlpDZ2JlTzdIY', {
    expires: expiryDate,
    path: '/',
    domain: 'localhost',
    secure: false,
    sameSite: 'lax',
  })

  setCookie(event, 'app-session', 'eyJpdiI6InpGNmxwR0t', {
    expires: expiryDate,
    path: '/',
    domain: 'localhost',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
  })

  setCookie(event, 'user-pref', 'dark-mode', {
    expires: expiryDate,
    path: '/',
  })

  return { ok: true, cookies: 3 }
})

// @vitest-environment nuxt
import { expect, test } from 'vitest'
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import App from '~/app.vue'

test('my test', async () => {
  await renderSuspended(App)
  expect(screen.getByText('Get started')).toBeDefined()
})

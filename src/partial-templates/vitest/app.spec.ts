// @vitest-environment nuxt
import { expect, test } from 'vitest'
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import App from '~/app.vue'

test('app has getting started section', async () => {
  await renderSuspended(App)
  expect(screen.getByText('Get started')).toBeDefined()
})

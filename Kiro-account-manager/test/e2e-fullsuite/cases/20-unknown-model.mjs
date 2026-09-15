/**
 * CASE 20: 未知模型必须显式失败，不能静默映射到其它模型。
 */
import { postAnthropic } from '../lib/http.mjs'
import { SMALL_MAX_TOKENS } from '../lib/fixtures.mjs'
import { assertTrue } from '../lib/assert.mjs'

export default {
  id: 'CASE-20-unknown-model',
  title: '不存在 model 显式失败',
  tags: ['anthropic', 'model-mapping', 'error'],
  run: async ({ base, token, log }) => {
    const result = await postAnthropic({
      model: 'claude-foo-bar-99-totally-unknown',
      max_tokens: SMALL_MAX_TOKENS,
      stream: false,
      messages: [{ role: 'user', content: '一句话回答即可.' }]
    }, { base, token })
    log(`status=${result.status} kind=${result.kind}`)
    assertTrue(result.status === 400, `未知模型应返回 400，实际 ${result.status}`)
  }
}

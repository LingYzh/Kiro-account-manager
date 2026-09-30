import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// 特征测试（characterization test）：锁定 src/renderer-shared/lib/ 下纯函数模块的
// 现有行为，作为 React -> Vue 迁移期间的安全网。断言值均取自现有实现的真实运行结果，
// 不代表"正确"或"期望"行为——发现的可疑之处见各模块注释与 task-5-report.md。
const tempDir = await mkdtemp(join(tmpdir(), 'kiro-renderer-shared-'))

try {
    // accountHelpers.ts 里 import 了 '@shared/types/account'，需要配置别名指回
    // src/renderer-shared 本身（该目录既是别名目标也是被测源码所在目录）。
    const alias = { '@shared': resolve('src/renderer-shared') }
    const entries = {
        dotVariants: 'src/renderer-shared/lib/dotVariants.ts',
        rateLimiter: 'src/renderer-shared/lib/rateLimiter.ts',
        webhookPayload: 'src/renderer-shared/lib/webhookPayload.ts',
        utils: 'src/renderer-shared/lib/utils.ts',
        accountHelpers: 'src/renderer-shared/lib/accountHelpers.ts'
    }
    const mods = {}
    for (const [name, entry] of Object.entries(entries)) {
        const outfile = join(tempDir, `${name}.mjs`)
        await build({
            entryPoints: [resolve(entry)],
            bundle: true,
            format: 'esm',
            platform: 'node',
            target: 'node22',
            outfile,
            alias
        })
        mods[name] = await import(pathToFileURL(outfile).href)
    }

    // ============ dotVariants ============
    {
        const { splitEmail, normalizeEmail, binomial, totalVariantCount, countSameRootVariants, generateNextDotVariant } = mods.dotVariants

        // splitEmail：合法与各类非法输入
        assert.deepEqual(splitEmail('a.b.c@gmail.com'), ['a.b.c', 'gmail.com'])
        assert.equal(splitEmail('noatsign'), null)
        assert.equal(splitEmail('@gmail.com'), null) // @ 在首位
        assert.equal(splitEmail('foo@'), null) // @ 在末位
        assert.equal(splitEmail('foo@localhost'), null) // domain 不含点号

        // normalizeEmail：去点 + 全小写；非法邮箱原样转小写返回
        assert.equal(normalizeEmail('A.b.C@GMail.Com'), 'abc@gmail.com')
        assert.equal(normalizeEmail('INVALID'), 'invalid')

        // binomial 边界
        assert.equal(binomial(5, 2), 10)
        assert.equal(binomial(5, 0), 1)
        assert.equal(binomial(5, 5), 1)
        assert.equal(binomial(5, 6), 0) // k > n
        assert.equal(binomial(5, -1), 0) // k < 0
        assert.equal(binomial(0, 0), 1)

        // totalVariantCount：含 maxDot 截断
        assert.equal(totalVariantCount(4), 7) // C(3,1)+C(3,2)+C(3,3) = 3+3+1
        assert.equal(totalVariantCount(4, 2), 6) // 只累加 k=1,2 => 3+3
        assert.equal(totalVariantCount(1), 0) // positions=0
        assert.equal(totalVariantCount(0), 0)

        // countSameRootVariants：同母号变体统计 + 非法母邮箱
        assert.equal(
            countSameRootVariants('john.doe@gmail.com', ['johndoe@gmail.com', 'jo.hn.doe@GMAIL.com', 'other@gmail.com', 'invalid']),
            2
        )
        assert.equal(countSameRootVariants('bad-parent', ['a@b.com']), 0)

        // generateNextDotVariant：local 只有 1 个字符 -> positions<=0，直接返回 null
        assert.deepEqual(generateNextDotVariant('a@gmail.com', []), {
            variant: null, dotCount: 0, remainingInBucket: 0, localLength: 1
        })

        // 已用尽：2 字符 local 只有 1 个可插入位置、1 种组合，唯一候选也在黑名单里
        assert.deepEqual(generateNextDotVariant('ab@gmail.com', ['ab@gmail.com', 'a.b@gmail.com']), {
            variant: null, dotCount: 0, remainingInBucket: 0, localLength: 2
        })

        // 黑名单过滤：3 字符 local 的 1-dot 候选共 2 个（a.bc / ab.c），屏蔽其中一个后
        // 唯一候选被强制选中（remainingInBucket=0 说明候选池已被过滤到只剩 1 个，
        // Math.random 无从产生歧义，可稳定断言具体值）
        assert.deepEqual(generateNextDotVariant('abc@gmail.com', ['a.bc@gmail.com']), {
            variant: 'ab.c@gmail.com', dotCount: 1, remainingInBucket: 0, localLength: 3
        })

        // 非法母邮箱：直接返回 null 结果
        assert.deepEqual(generateNextDotVariant('bad-parent', []), {
            variant: null, dotCount: 0, remainingInBucket: 0, localLength: 0
        })

        console.log('renderer-shared: dotVariants passed')
    }

    // ============ rateLimiter ============
    {
        const { createRateLimiter, DEFAULT_RATE_LIMITER_CONFIG } = mods.rateLimiter

        // 无可注入时间源：waitForSlot/reportResult/snapshot 均直接调用 Date.now()。
        // 为把测试总时长控制在 3 秒内，退避相关配置改用极短的毫秒数（100ms 量级），
        // 时间相关字段用范围断言而非精确值，避免因执行耗时导致偶发失败。
        assert.deepEqual(DEFAULT_RATE_LIMITER_CONFIG, {
            maxPerMinute: 10,
            burst: 3,
            windowSec: 120,
            successRateThreshold: 0.5,
            minSamples: 5,
            consecutiveFailureThreshold: 3,
            backoffBaseMs: 8_000,
            backoffMaxMs: 120_000
        })

        const rl = createRateLimiter({ consecutiveFailureThreshold: 2, backoffBaseMs: 100, backoffMaxMs: 1000 })

        // snapshot 初值：令牌桶按 burst 初始化，窗口无事件，成功率兜底为 1
        const initial = rl.snapshot()
        assert.deepEqual(initial, {
            availableTokens: 3,
            windowSuccess: 0,
            windowFailed: 0,
            successRate: 1,
            consecutiveFailures: 0,
            backoffRemainingMs: 0,
            riskWarning: false,
            throughputPerMinute: 0
        })

        // 连续失败第 1 次：未达阈值(2)，不触发退避
        rl.reportResult(false)
        let snap = rl.snapshot()
        assert.equal(snap.consecutiveFailures, 1)
        assert.equal(snap.backoffRemainingMs, 0)
        assert.equal(snap.windowFailed, 1)

        // 连续失败第 2 次：达到阈值，overflow=1，backoffMs = 100 * 2^0 = 100
        rl.reportResult(false)
        snap = rl.snapshot()
        assert.equal(snap.consecutiveFailures, 2)
        assert.ok(snap.backoffRemainingMs > 0 && snap.backoffRemainingMs <= 100, `backoffRemainingMs=${snap.backoffRemainingMs}`)
        assert.equal(snap.windowFailed, 2)

        // 连续失败第 3 次：overflow=2，backoffMs = 100 * 2^1 = 200（指数退避，覆盖上一次的 backoffEndAt）
        rl.reportResult(false)
        snap = rl.snapshot()
        assert.equal(snap.consecutiveFailures, 3)
        assert.ok(snap.backoffRemainingMs > 100 && snap.backoffRemainingMs <= 200, `backoffRemainingMs=${snap.backoffRemainingMs}`)
        assert.equal(snap.windowFailed, 3)

        // 成功一次：consecutiveFailures 清零，但已设定的 backoffEndAt 不受影响（疑似设计如此：
        // 退避一旦触发即倒计时到底，不因中途出现一次成功而提前解除）
        rl.reportResult(true)
        snap = rl.snapshot()
        assert.equal(snap.consecutiveFailures, 0)
        assert.ok(snap.backoffRemainingMs > 0, `backoffRemainingMs=${snap.backoffRemainingMs}`)
        assert.equal(snap.windowSuccess, 1)
        assert.equal(snap.windowFailed, 3)
        assert.equal(snap.successRate, 0.25)

        // reset：清空事件、连续失败与退避，令牌桶按当前 config.burst 复位
        rl.reset()
        assert.deepEqual(rl.snapshot(), {
            availableTokens: 3,
            windowSuccess: 0,
            windowFailed: 0,
            successRate: 1,
            consecutiveFailures: 0,
            backoffRemainingMs: 0,
            riskWarning: false,
            throughputPerMinute: 0
        })

        // updateConfig：合并配置；burst 变化在下一次 reset 时才体现到 tokens
        rl.updateConfig({ burst: 10 })
        assert.equal(rl.snapshot().availableTokens, 3, 'updateConfig 不立即改变当前令牌数')
        rl.reset()
        assert.equal(rl.snapshot().availableTokens, 10, 'reset 后按新的 burst 复位令牌')

        // riskWarning：独立实例验证成功率低于阈值且样本数达标时触发
        const riskRl = createRateLimiter({ successRateThreshold: 0.5, minSamples: 3 })
        riskRl.reportResult(false)
        riskRl.reportResult(false)
        assert.equal(riskRl.snapshot().riskWarning, false, '样本数未达 minSamples 时不触发')
        riskRl.reportResult(false)
        const riskSnap = riskRl.snapshot()
        assert.equal(riskSnap.riskWarning, true)
        assert.equal(riskSnap.successRate, 0)

        console.log('renderer-shared: rateLimiter passed')
    }

    // ============ webhookPayload ============
    {
        const { buildTelegramUrl, buildWebhookBody, escapeJsonString } = mods.webhookPayload

        // buildTelegramUrl：已含 /sendMessage 不重复拼接；末尾斜杠先去除再拼接
        assert.equal(buildTelegramUrl({ url: 'https://api.telegram.org/bot123' }), 'https://api.telegram.org/bot123/sendMessage')
        assert.equal(buildTelegramUrl({ url: 'https://api.telegram.org/bot123/' }), 'https://api.telegram.org/bot123/sendMessage')
        assert.equal(buildTelegramUrl({ url: 'https://api.telegram.org/bot123/sendMessage' }), 'https://api.telegram.org/bot123/sendMessage')

        const payload = { title: 'T', message: 'M', level: 'info', fields: { a: 1, b: 'x' } }

        // WebhookKind 枚举的全部 6 个分支各一例消息体结构
        assert.deepEqual(buildWebhookBody({ kind: 'dingtalk', url: 'https://x' }, payload), {
            msgtype: 'markdown',
            markdown: { title: 'T', text: '### ℹ️ T\n\nM\n**a**: 1\n**b**: x' }
        })
        assert.deepEqual(buildWebhookBody({ kind: 'wechat-work', url: 'https://x' }, payload), {
            msgtype: 'markdown',
            markdown: { content: '## ℹ️ T\n\nM\n**a**: 1\n**b**: x' }
        })
        assert.deepEqual(buildWebhookBody({ kind: 'feishu', url: 'https://x' }, payload), {
            msg_type: 'text',
            content: { text: 'ℹ️ T\n\nM\na: 1\nb: x' }
        })
        assert.deepEqual(buildWebhookBody({ kind: 'telegram', url: 'https://x', telegramChatId: 'chat1' }, payload), {
            chat_id: 'chat1',
            text: 'ℹ️ T\n\nM\na: 1\nb: x',
            parse_mode: 'Markdown'
        })

        const discordBody = buildWebhookBody({ kind: 'discord', url: 'https://x' }, payload)
        assert.equal(discordBody.username, 'Kiro Account Manager')
        assert.equal(discordBody.embeds[0].title, 'ℹ️ T')
        assert.equal(discordBody.embeds[0].description, 'M')
        assert.equal(discordBody.embeds[0].color, 0x4a9eff) // level=info 时的默认色
        assert.deepEqual(discordBody.embeds[0].fields, [
            { name: 'a', value: '1', inline: true },
            { name: 'b', value: 'x', inline: true }
        ])
        assert.equal(typeof discordBody.embeds[0].timestamp, 'string') // 含 Date.now()，只校验类型

        // custom：无模板时的默认结构（timestamp 为动态值，只校验类型与其余字段）
        const customBody = buildWebhookBody({ kind: 'custom', url: 'https://x' }, payload)
        assert.equal(customBody.title, 'T')
        assert.equal(customBody.message, 'M')
        assert.equal(customBody.level, 'info')
        assert.deepEqual(customBody.fields, { a: 1, b: 'x' })
        assert.equal(typeof customBody.timestamp, 'string')

        // custom：模板占位符替换 + JSON.parse 成功
        assert.deepEqual(
            buildWebhookBody(
                { kind: 'custom', url: 'https://x', customTemplate: '{"t":"{{title}}","m":"{{message}}","l":"{{level}}"}' },
                payload
            ),
            { t: 'T', m: 'M', l: 'info' }
        )

        // custom：模板解析失败（非法 JSON）时静默退回默认结构
        const fallbackBody = buildWebhookBody({ kind: 'custom', url: 'https://x', customTemplate: 'not json {{title}}' }, payload)
        assert.equal(fallbackBody.title, 'T')
        assert.equal(fallbackBody.message, 'M')

        // discord 按 level 决定颜色的四个分支
        const colorByLevel = {
            error: 0xff0000,
            warn: 0xffaa00,
            success: 0x00ff00,
            info: 0x4a9eff
        }
        for (const [level, color] of Object.entries(colorByLevel)) {
            const body = buildWebhookBody({ kind: 'discord', url: 'https://x' }, { title: 'T', message: 'M', level })
            assert.equal(body.embeds[0].color, color, level)
        }

        // escapeJsonString：反斜杠、双引号、换行、回车、Tab
        assert.equal(escapeJsonString('a"b\\c\nd\re\tf'), 'a\\"b\\\\c\\nd\\re\\tf')

        console.log('renderer-shared: webhookPayload passed')
    }

    // ============ utils ============
    {
        const { splitCredentialLine, formatBytes, formatPercentage } = mods.utils

        // splitCredentialLine：三种分隔符优先级——先看 ----，再 Tab，最后连续空格
        assert.deepEqual(splitCredentialLine('email----token----secret'), ['email', 'token', 'secret'])
        assert.deepEqual(splitCredentialLine('email\ttoken\tsecret'), ['email', 'token', 'secret'])
        assert.deepEqual(splitCredentialLine('email  token  secret'), ['email', 'token', 'secret'])

        // JWT 尾部连续 '-' 边界：分隔符用 /-{4,}/ 整体匹配，多出的 (N-4) 个 '-' 归还前一字段
        // 5 个连续 '-'（JWT 尾部 1 个 + 分隔符 4 个）-> 归还 1 个 '-' 给前一字段
        assert.deepEqual(splitCredentialLine('email----abc-----provider'), ['email', 'abc-', 'provider'])
        // 6 个连续 '-'（JWT 尾部 2 个 + 分隔符 4 个）-> 归还 2 个 '-'
        assert.deepEqual(splitCredentialLine('email----abc------provider'), ['email', 'abc--', 'provider'])

        // formatBytes：0 值特判 + 跨单位换算
        assert.equal(formatBytes(0), '0 B')
        assert.equal(formatBytes(500), '500 B')
        assert.equal(formatBytes(1024), '1 KB')
        assert.equal(formatBytes(1536), '1.5 KB')
        assert.equal(formatBytes(1048576), '1 MB')

        // formatPercentage：固定 1 位小数
        assert.equal(formatPercentage(0.5), '50.0%')
        assert.equal(formatPercentage(0.1234), '12.3%')
        assert.equal(formatPercentage(1), '100.0%')

        console.log('renderer-shared: utils passed')
    }

    // ============ accountHelpers ============
    {
        const { getDisplayName, isBannedError, formatDateSafe, toRgba } = mods.accountHelpers

        // getDisplayName：优先级 nickname > email > userId > 'Unknown'
        assert.equal(getDisplayName({ nickname: 'Nick', email: 'e@x.com', userId: 'u1' }), 'Nick')
        assert.equal(getDisplayName({ email: 'e@x.com', userId: 'u1' }), 'e@x.com')
        assert.equal(getDisplayName({ userId: 'u1' }), 'u1')
        assert.equal(getDisplayName({}), 'Unknown')

        // isBannedError：各匹配模式 + 无关错误
        assert.equal(isBannedError(undefined), false)
        assert.equal(isBannedError('AccountSuspendedException: xxx'), true)
        assert.equal(isBannedError('TEMPORARILY_SUSPENDED'), true)
        assert.equal(isBannedError('User id is xxx and is suspended now'), true)
        assert.equal(isBannedError('账户已封禁'), true)
        assert.equal(isBannedError('HTTP 423 Locked'), true)
        assert.equal(isBannedError('network error'), false)

        // formatDateSafe：字符串输入不做任何日期校验/解析，直接按 'T' 切分原样返回——
        // 疑似 bug：非法日期字符串（如 'not-a-date'）不会被识别为无效，而是原样通过。
        // 这里照实锁定现有行为，不代表其正确性。
        assert.equal(formatDateSafe('2026-01-15T10:00:00Z'), '2026-01-15')
        assert.equal(formatDateSafe(new Date('2026-02-01T00:00:00Z')), '2026-02-01')
        assert.equal(formatDateSafe(1770000000000), '2026-02-02')
        assert.equal(formatDateSafe('not-a-date'), 'not-a-date') // 锁定：字符串分支不校验合法性
        assert.equal(formatDateSafe(null), '1970-01-01') // 锁定：null 被 new Date(null) 解析为 epoch
        assert.equal(formatDateSafe(undefined), '') // new Date(undefined) 无效，走 catch 分支

        // toRgba：#RRGGBB 与 #AARRGGBB 两种长度
        assert.equal(toRgba('#336699'), 'rgba(51, 102, 153, 1)')
        assert.equal(toRgba('#80336699'), 'rgba(51, 102, 153, 0.5019607843137255)')
        assert.equal(toRgba('#FF336699'), 'rgba(51, 102, 153, 1)')

        console.log('renderer-shared: accountHelpers passed')
    }

    console.log('renderer-shared: all passed')
} finally {
    await rm(tempDir, { recursive: true, force: true })
}

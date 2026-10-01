import { generateNextDotVariant, splitEmail } from '@shared/lib/dotVariants'

export const REGISTER_STORAGE = {
    config: 'kiro-register-config',
    history: 'kiro-register-history',
    blacklist: 'kiro-register-email-blacklist',
    templates: 'kiro-register-templates',
    mixedSources: 'kiro-register-mixed-sources',
    mixedWeights: 'kiro-register-mixed-weights'
}

export const DEFAULT_REGISTER_CONFIG = {
    mode: 'manual',
    outlookData: '',
    fullName: '',
    batchCount: 1,
    batchInterval: 5,
    batchAutoImport: true,
    batchRetries: 1,
    batchConcurrency: 1,
    autoFetchProLink: false,
    proPlanType: 'Q_DEVELOPER_STANDALONE_PRO',
    tempMailEmail: '',
    tempMailEpin: '',
    tempMailDomain: '',
    protonBaseEmail: '',
    gptMailBaseURL: '',
    gptMailInboxEmail: '',
    gptMailDomain: '',
    gptMailPrefix: '',
    gptMailPrivatePassword: '',
    manualParentEmail: '',
    manualAnonymousEmail: false,
    mixedEnabledSources: ['outlook', 'tempmail']
}

export const AUTO_SOURCES = ['outlook', 'tempmail', 'proton', 'gptmail']
export const STEP_LABELS = {
    init: '初始化',
    'proxy-chain-ready': '代理链就绪',
    'tls-ready': 'TLS 就绪',
    'exit-ip': '探出口 IP',
    oidc: 'OIDC',
    device: '设备授权',
    'email-created': '邮箱已创建',
    portal: 'Portal',
    'workflow-init': '工作流',
    'submit-email': '提交邮箱',
    signup: 'Signup',
    'send-otp': '发送验证码',
    'waiting-otp': '等验证码',
    'otp-received': '验证码到',
    'create-identity': '建身份',
    'set-password': '设密码',
    'sso-workflow': 'SSO 工作流',
    'sso-token': '取 Token',
    'verify-alive': '验活',
    done: '完成'
}

export function readJson(key, fallback) {
    try {
        const value = localStorage.getItem(key)
        return value ? JSON.parse(value) : fallback
    } catch {
        return fallback
    }
}

export function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Registration remains usable when storage is unavailable.
    }
}

export function loadRegisterConfig() {
    const loaded = readJson(REGISTER_STORAGE.config, {})
    const sources = readJson(REGISTER_STORAGE.mixedSources, loaded.mixedEnabledSources)
    const mixedEnabledSources = Array.isArray(sources)
        ? sources.filter((source) => AUTO_SOURCES.includes(source))
        : DEFAULT_REGISTER_CONFIG.mixedEnabledSources
    return {
        ...DEFAULT_REGISTER_CONFIG,
        ...loaded,
        mode: loaded.mode === 'moemail' ? 'outlook' : loaded.mode || 'manual',
        mixedEnabledSources: mixedEnabledSources.length
            ? mixedEnabledSources
            : ['outlook', 'tempmail']
    }
}

export function loadBlacklist() {
    const values = readJson(REGISTER_STORAGE.blacklist, [])
    return new Set(Array.isArray(values) ? values.map((email) => String(email).toLowerCase()) : [])
}

export function saveBlacklist(values) {
    writeJson(REGISTER_STORAGE.blacklist, [...values].slice(-5000))
}

export function diagnoseRegError(err) {
    const e = (err || '').toLowerCase()
    if (!e) {
        return {
            category: 'unknown',
            title: '未知错误',
            reasons: ['未捕获到具体错误信息'],
            suggestions: ['查看完整日志']
        }
    }
    // AWS 风控
    if (
        e.includes('aws-risk-control') ||
        e.includes('风控') ||
        e.includes('请稍后再试') ||
        e.includes('try again later')
    ) {
        return {
            category: 'risk_control',
            title: 'AWS 风控触发',
            reasons: [
                '注册请求被 AWS 安全策略拦截',
                '常见诱因：同 IP 短时注册多账号、行为节奏机械化、邮箱域名被关联'
            ],
            suggestions: [
                '启用代理池 + 每号唯一 session（每号一个 IP）',
                '降低速率（限速 10/分钟或更低）',
                '邮箱用多域名轮换',
                '若用 bestproxy 类住宅代理，确保来源 IP 非大陆'
            ]
        }
    }
    // bestproxy 610 / IP 白名单类
    if (
        e.includes('610') ||
        e.includes('whitelist') ||
        (e.includes('connect') && e.includes('http 4'))
    ) {
        return {
            category: 'proxy_whitelist',
            title: '代理认证 / 白名单失败',
            reasons: [
                '目标代理拒绝认证（账密错或来源 IP 不在白名单）',
                'bestproxy 的 610 = 来源 IP 未授权'
            ],
            suggestions: [
                '在代理后台把当前出口 IP 加入白名单',
                '或改用账密直连模式 + 确保来源是允许地区',
                '配合"上游中转代理"用非大陆中转'
            ]
        }
    }
    // 代理链失败
    if (e.includes('proxychain') || e.includes('代理链') || e.includes('上游中转')) {
        return {
            category: 'proxy_chain',
            title: '代理链建立失败',
            reasons: ['"上游中转 → 目标代理"链路握手未通过'],
            suggestions: [
                '到「代理池」页面点「诊断」定位哪一层挂了',
                '确认上游中转端口（如 socks5://127.0.0.1:7890）已在跑',
                '若目标代理要求白名单，确保中转出口 IP 已加白'
            ]
        }
    }
    // 严格代理（无可用代理拒绝裸奔）
    if (e.includes('严格代理') || (e.includes('strict') && e.includes('proxy'))) {
        return {
            category: 'strict_proxy',
            title: '严格代理模式拦截',
            reasons: ['代理池启用了"绝不裸奔直连"，但当前无可用代理'],
            suggestions: [
                '到代理池验活，确认至少 1 条 alive',
                '检查代理是否被自动停用',
                '临时可手动启用所有代理 / 关掉"失败自动停用"'
            ]
        }
    }
    // EOF / status=0 网络抖动
    if (
        e.includes('eof') ||
        (e.includes('status=0') && e.includes('failed to do request')) ||
        e.includes('connection reset')
    ) {
        return {
            category: 'eof',
            title: '网络瞬时断开（EOF）',
            reasons: [
                'TLS 连接在握手或传输中被对端 RST/关闭',
                '常见于代理不稳定 / 高并发挤压 / 中间网络抖动'
            ],
            suggestions: [
                '降低并发数',
                '换代理 / 加上游中转',
                '已内置重试，偶发可忽略；连续大量则更换出口'
            ]
        }
    }
    // OTP 超时
    if (
        (e.includes('timeout') || e.includes('超时')) &&
        (e.includes('otp') || e.includes('验证码') || e.includes('code'))
    ) {
        return {
            category: 'otp_timeout',
            title: '等待验证码超时',
            reasons: [
                '临时邮箱未在期限内收到 AWS 验证邮件',
                '可能 AWS 没发（风控拦截）/ 邮件落到垃圾 / 临时邮箱服务延迟'
            ],
            suggestions: [
                '确认临时邮箱服务可用',
                '该邮箱域名可能被 AWS 标黑，换域名重试',
                '若反复出现，多半是 AWS 静默风控，需换 IP/换节奏'
            ]
        }
    }
    // 一般网络
    if (
        e.includes('timeout') ||
        e.includes('超时') ||
        e.includes('etimedout') ||
        e.includes('fetch failed') ||
        e.includes('econnreset') ||
        e.includes('econnrefused') ||
        e.includes('enotfound') ||
        e.includes('network')
    ) {
        return {
            category: 'network',
            title: '网络错误',
            reasons: ['连接 / DNS / 超时类失败'],
            suggestions: ['检查本机网络与代理可达性', '降低并发再试']
        }
    }
    // 邮箱已被注册
    if (
        e.includes('已注册') ||
        (e.includes('email') &&
            (e.includes('already') ||
                e.includes('exists') ||
                e.includes('used') ||
                e.includes('已存在') ||
                e.includes('已被')))
    ) {
        return {
            category: 'email_used',
            title: '邮箱已被注册',
            reasons: ['该邮箱地址 AWS 侧已存在'],
            suggestions: [
                '前缀生成器近期已增强随机性（中间名/双姓），再跑一次几乎不会撞',
                '使用多域名进一步降低冲突'
            ]
        }
    }
    // 限流
    if (
        e.includes('rate') ||
        e.includes('limit') ||
        e.includes('too many') ||
        e.includes('限流') ||
        e.includes('429')
    ) {
        return {
            category: 'rate_limit',
            title: '触发限流',
            reasons: ['短时请求次数超出 AWS 接受范围'],
            suggestions: ['降低 maxPerMinute 与并发', '启用风控自动暂停']
        }
    }
    // suspended
    if (e.includes('suspended')) {
        return {
            category: 'suspended',
            title: '账号已被停用',
            reasons: [
                '注册流程跑完但 AWS 在最后一步把账号标为 suspended',
                '通常是风控级判定（域名/IP/指纹综合）'
            ],
            suggestions: ['换出口 IP / 换邮箱域名 / 降低速率', '可看作"软风控"信号，应立刻放慢']
        }
    }
    // 鉴权
    if (e.includes('unauthorized') || e.includes('401') || e.includes('403')) {
        return {
            category: 'auth',
            title: '鉴权失败',
            reasons: ['上游接口返回 401/403'],
            suggestions: ['检查凭据 / 看接口侧响应体']
        }
    }
    return {
        category: 'unknown',
        title: '其他错误',
        reasons: [err || ''],
        suggestions: ['查看完整日志定位']
    }
}

/** 旧 API 兼容：现有 retryFailed 等用 classifyError 做筛选 */
export function classifyError(err) {
    const cat = diagnoseRegError(err).category
    if (cat === 'risk_control') return 'risk_control'
    if (cat === 'otp_timeout') return 'otp_timeout'
    if (cat === 'email_used') return 'email_used'
    if (cat === 'rate_limit') return 'rate_limit'
    if (cat === 'auth') return 'auth'
    if (
        cat === 'eof' ||
        cat === 'network' ||
        cat === 'proxy_chain' ||
        cat === 'proxy_whitelist' ||
        cat === 'strict_proxy'
    )
        return 'network'
    return 'unknown'
}

export function injectProxySession(url, random = Math.random) {
    if (!url) return url
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let session = ''
    for (let index = 0; index < 8; index++) session += chars[Math.floor(random() * chars.length)]
    if (url.includes('{session}')) return url.replace(/\{session\}/g, session)
    const match = url.match(/^(\w+:\/\/)([^@/]+)@(.+)$/)
    if (!match) return url
    const [, scheme, userInfo, host] = match
    const separator = userInfo.indexOf(':')
    const username = separator < 0 ? userInfo : userInfo.slice(0, separator)
    if (
        !/_(area|life|city|state|session|region|country)-/i.test(username) ||
        /_session-/i.test(username)
    )
        return url
    return `${scheme}${username}_session-${session}${separator < 0 ? '' : userInfo.slice(separator)}@${host}`
}

export function createSourcePicker(credits = {}) {
    return function pick(candidates, weights) {
        if (!candidates.length) return null
        if (candidates.length === 1) return candidates[0]
        const total = candidates.reduce(
            (sum, source) => sum + Math.max(0, Number(weights[source]) || 0),
            0
        )
        let best = null
        let bestCredit = -Infinity
        for (const source of candidates) {
            credits[source] =
                (credits[source] || 0) + (Math.max(0, Number(weights[source]) || 0) || 1)
            if (credits[source] > bestCredit) {
                best = source
                bestCredit = credits[source]
            }
        }
        credits[best] -= total || candidates.length
        return best
    }
}

export function nextProtonEmail(base, used) {
    if (!base.trim() || !splitEmail(base.trim())) return null
    return generateNextDotVariant(base.trim(), used).variant
}

export function buildManualSteps(hasImport, hasProLink) {
    const steps = ['OIDC', 'Email', 'Verify', 'Password', 'Token']
    if (hasImport) steps.push('Import')
    if (hasProLink) steps.push('ProLink')
    steps.push('Done')
    return steps
}

export function phaseToStep(phase, lastLog, steps) {
    const index = (name) => steps.indexOf(name)
    if (phase === 'idle') return -1
    if (phase === 'initializing') return index('OIDC')
    if (phase === 'email') return index('Email')
    if (phase === 'otp') return index('Verify')
    if (phase === 'done' || phase === 'finalized') return index('Done')
    if (phase === 'importing') return index('Import') < 0 ? index('Done') : index('Import')
    if (phase === 'fetching-link') return index('ProLink') < 0 ? index('Done') : index('ProLink')
    const log = String(lastLog || '').toLowerCase()
    if (/(sso|token|验活|complete|end-of-workflow)/.test(log)) return index('Token')
    if (/(密码|password|加密公钥)/.test(log)) return index('Password')
    if (/(验证码|otp|verify|signup|profile|注册初始化)/.test(log)) return index('Verify')
    return index('Email')
}

export function shuffleOutlookLines(text, random = Math.random) {
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('----'))
    for (let index = lines.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1))
        ;[lines[index], lines[other]] = [lines[other], lines[index]]
    }
    return lines
}
